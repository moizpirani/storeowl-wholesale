// Runs supabase/schema.sql on a local Postgres (PGlite) with a stand-in for Supabase's auth,
// then checks who can do what. The schema must also be safe to run twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const SQL = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const AUTH = `
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', current_setting('t.email', true)) $$;`;

const OWNER = '00000000-0000-4000-8000-000000000001';
const MGR = '00000000-0000-4000-8000-000000000002';
const OUT = '00000000-0000-4000-8000-000000000003';

async function fresh() {
  const db = new PGlite();
  await db.exec(AUTH);
  await db.exec(SQL);
  await db.exec(SQL); // safe to run again
  return db;
}
async function as(db, uid, email) { await db.query("select set_config('t.uid', $1, false), set_config('t.email', $2, false)", [uid || '', email || '']); }
async function one(db, sql, args) { const r = await db.query(sql, args || []); return Object.values(r.rows[0])[0]; }
async function fails(db, sql, args, re) { await assert.rejects(db.query(sql, args || []), re); }

test('company setup, states, invites and roles', async () => {
  const db = await fresh();

  await as(db, '', '');
  await fails(db, "select create_company('{\"name\":\"X\",\"home\":\"TN\"}')", [], /not signed in/);

  await as(db, OWNER, 'owner@example.com');
  await fails(db, "select create_company('{\"name\":\"X\"}')", [], /pick the state/);
  await fails(db, "select create_company('{\"name\":\" \",\"home\":\"TN\"}')", [], /company name/);
  const c = await one(db, "select create_company($1::jsonb)", [JSON.stringify({ name: ' Knox Wholesale ', home: 'tn', others: ['KY', 'zz', 'TN', 'va'], your_name: 'Sam', email: 'Bills@Knox.com' })]);
  assert.equal(c.name, 'Knox Wholesale'); assert.equal(c.home, 'TN'); assert.deepEqual(c.others, ['KY', 'VA']);
  assert.equal(c.role, 'owner'); assert.equal(c.email, 'bills@knox.com');
  const cid = c.id;

  const list = await one(db, 'select my_companies()');
  assert.equal(list.length, 1);

  // States: change home, drop one, add one; exactly one home always.
  const s = await one(db, 'select company_states_set($1, $2, $3::jsonb)', [cid, 'KY', JSON.stringify(['TN', 'GA'])]);
  assert.equal(s.home, 'KY'); assert.deepEqual(s.others, ['GA', 'TN']);
  assert.equal(await one(db, 'select count(*)::int from company_states where company_id = $1 and is_home', [cid]), 1);
  await fails(db, 'select company_states_set($1, $2, $3::jsonb)', [cid, 'ZZ', '[]'], /pick the state/);

  // Invite a manager; they join on their first sign-in.
  await fails(db, 'select invite_put($1, $2, $3)', [cid, 'not-an-email', 'manager'], /doesn't look right/);
  await one(db, 'select invite_put($1, $2, $3)', [cid, ' Mgr@Example.com ', 'manager']);
  await as(db, MGR, 'mgr@example.com');
  const mine = await one(db, 'select my_companies()');
  assert.equal(mine.length, 1); assert.equal(mine[0].role, 'manager');
  assert.equal(await one(db, 'select count(*)::int from company_invites'), 0);

  // Managers change company details, not states, people or invites.
  const put = await one(db, 'select company_put($1, $2::jsonb)', [cid, '{"phone":"865-555-0100"}']);
  assert.equal(put.phone, '865-555-0100'); assert.equal(put.name, 'Knox Wholesale');
  await fails(db, 'select company_states_set($1, $2, $3::jsonb)', [cid, 'TN', '[]'], /only an owner/);
  await fails(db, 'select invite_put($1, $2, $3)', [cid, 'x@example.com', 'staff'], /only an owner/);
  const hist = await one(db, 'select change_log_list($1)', [cid]);
  assert.ok(hist.some((h) => h.what === 'joined'));
  assert.ok(hist.some((h) => h.what === 'company details changed'));

  // Someone outside sees nothing.
  await as(db, OUT, 'out@example.com');
  assert.deepEqual(await one(db, 'select my_companies()'), []);
  await fails(db, 'select members_list($1)', [cid], /no access/);
  await fails(db, 'select company_put($1, $2::jsonb)', [cid, '{"name":"Mine"}'], /no access/);

  // The last owner can't step down; a second owner can.
  await as(db, OWNER, 'owner@example.com');
  await fails(db, 'select member_set($1, $2, $3)', [cid, OWNER, 'manager'], /at least one owner/);
  await one(db, 'select member_set($1, $2, $3)', [cid, MGR, 'owner']);
  const ppl = await one(db, 'select member_set($1, $2, $3)', [cid, OWNER, 'manager']);
  assert.equal(ppl.members.find((m) => m.user_id === OWNER).role, 'manager');
});

test('signed-in people can only reach the app functions, never the tables', async () => {
  const db = await fresh();
  const r = await db.query(`select has_table_privilege('authenticated', 'companies', 'select') t,
    has_function_privilege('authenticated', 'create_company(jsonb)', 'execute') f,
    has_function_privilege('anon', 'create_company(jsonb)', 'execute') a,
    has_function_privilege('authenticated', '_need(uuid,text)', 'execute') h`);
  assert.deepEqual(r.rows[0], { t: false, f: true, a: false, h: false });
});

test('Phase 1: price levels, items with sizes, customers, licenses, notes', async () => {
  const db = await fresh();
  await as(db, OWNER, 'owner@example.com');
  const c = await one(db, "select create_company($1::jsonb)", [JSON.stringify({ name: 'Knox', home: 'TN' })]);
  const cid = c.id;
  assert.deepEqual(c.levels.map((l) => l.name), ['L1', 'L2', 'L3']);
  assert.equal(c.settings.lic_mode, 'warn'); assert.equal(c.settings.remind_days, 30); assert.equal('tobacco_stop' in c.settings, false);
  // The wholesaler picks the licenses they need, only for their own states; selling is never stopped (warn or ask).
  const ls = await one(db, 'select company_settings_set($1, $2::jsonb)', [cid, JSON.stringify({ lic_mode: 'ask', lic_need: { TN: ['resale', 'location', 'hemp'] } })]);
  assert.equal(ls.settings.lic_mode, 'ask'); assert.deepEqual(ls.settings.lic_need, { TN: ['resale', 'location', 'hemp'] });
  await fails(db, 'select company_settings_set($1, $2::jsonb)', [cid, JSON.stringify({ lic_mode: 'stop' })], /only warn/);
  await fails(db, 'select company_settings_set($1, $2::jsonb)', [cid, JSON.stringify({ lic_need: { KY: ['resale'] } })], /don't sell in KY/);
  await fails(db, 'select company_settings_set($1, $2::jsonb)', [cid, JSON.stringify({ lic_need: { TN: ['passport'] } })], /from the list/);

  // Levels get private names; a new one takes the first free number.
  const lv = await one(db, 'select levels_set($1, $2::jsonb)', [cid, JSON.stringify([{ n: 1, name: 'Route 1' }, { n: 2, name: 'Route 2' }, { name: 'Cash and carry' }])]);
  assert.deepEqual(lv.levels.map((l) => [l.n, l.name]), [[1, 'Route 1'], [2, 'Route 2'], [3, 'Cash and carry']]);
  await fails(db, 'select levels_set($1, $2::jsonb)', [cid, JSON.stringify([{ n: 1, name: 'A' }, { n: 2, name: 'a' }])], /same name/);

  // Items: sizes, UPCs kept unique across the company, costs hidden from staff.
  const it = await one(db, 'select item_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Seneca Full Flavor Box', category: 'cigarettes', unit: 'pack', age: 21,
    sizes: [{ name: 'Carton', n: 10, upc: '0 14700 31901 7', cost: '28.90', prices: { 1: '34.20', 2: 33.9, 3: '' } }, { name: 'Case', n: 500, upc: '10014700319014', cost: 1445 }] })]);
  assert.equal(it.sizes.length, 2); assert.equal(it.sizes[0].upc, '014700319017'); assert.equal(Number(it.sizes[0].prices['1']), 34.2);
  assert.equal(it.sizes[0].prices['3'], undefined);
  await fails(db, 'select item_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Other', sizes: [{ name: 'Box', n: 1, upc: '014700319017' }] })], /already on Seneca/);
  await fails(db, 'select item_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'X', sizes: [{ name: 'Box', n: 0 }] })], /whole number/);
  await fails(db, 'select item_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'X', sizes: [] })], /at least one size/);
  // Two sizes swap UPCs in one save.
  const sw = await one(db, 'select item_put($1, $2::jsonb)', [cid, JSON.stringify(Object.assign({}, it, {
    sizes: [Object.assign({}, it.sizes[0], { upc: it.sizes[1].upc }), Object.assign({}, it.sizes[1], { upc: it.sizes[0].upc })] }))]);
  assert.equal(sw.sizes[0].upc, '10014700319014'); assert.equal(sw.sizes[0].id, it.sizes[0].id);

  // Customers get the default level, and the level can't be taken away while it's in use.
  const cu = await one(db, 'select customer_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Maynardville Fuel Stop', terms: 'net14', credit_limit: '5000', level: 2,
    contacts: [{ name: 'Raj', role: 'Owner', phone: '865' }, { name: '', phone: '' }] })]);
  assert.equal(cu.level, 2); assert.equal(Number(cu.credit_limit), 5000); assert.equal(cu.contacts.length, 1);
  await fails(db, 'select levels_set($1, $2::jsonb)', [cid, JSON.stringify([{ n: 1, name: 'Route 1' }])], /1 customers are on a price level/);
  await fails(db, 'select customer_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Y', level: 6 })], /pick a price level/);
  await fails(db, 'select customer_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Y', email: 'nope' })], /doesn't look right/);

  const l1 = await one(db, 'select license_put($1, $2, $3::jsonb)', [cid, cu.id, JSON.stringify({ kind: 'tobacco', number: '46-331', expires: '2026-12-08', copy: true })]);
  assert.equal(l1.licenses[0].kind, 'tobacco'); assert.equal(l1.licenses[0].expires, '2026-12-08');
  const l2 = await one(db, 'select license_put($1, $2, $3::jsonb)', [cid, cu.id, JSON.stringify({ kind: 'tobacco', number: '' })]);
  assert.equal(l2.licenses.length, 0);
  // License copies: only files under this company and customer, never deleted, only hidden.
  await one(db, 'select license_put($1, $2, $3::jsonb)', [cid, cu.id, JSON.stringify({ kind: 'tobacco', number: '46-331', expires: '2026-12-08' })]);
  const c1 = await one(db, 'select copy_add($1, $2, $3, $4::jsonb)', [cid, cu.id, 'tobacco', JSON.stringify({ path: cid + '/' + cu.id + '/a.jpg', name: 'lic.jpg', type: 'image/jpeg', size: 1000 })]);
  assert.equal(c1.copies.length, 1); assert.equal(c1.copies[0].number, '46-331'); assert.equal(c1.licenses.find((l) => l.kind === 'tobacco').copy, true);
  await fails(db, 'select copy_add($1, $2, $3, $4::jsonb)', [cid, cu.id, 'tobacco', JSON.stringify({ path: 'other/' + cu.id + '/b.jpg', type: 'image/jpeg' })], /right place/);
  await fails(db, 'select copy_add($1, $2, $3, $4::jsonb)', [cid, cu.id, 'tobacco', JSON.stringify({ path: cid + '/' + cu.id + '/b.exe', type: 'application/x-msdownload' })], /photo or a PDF/);
  const c2 = await one(db, 'select copy_add($1, $2, $3, $4::jsonb)', [cid, cu.id, 'tobacco', JSON.stringify({ path: cid + '/' + cu.id + '/b.pdf', name: 'new.pdf', type: 'application/pdf' })]);
  assert.equal(c2.copies.length, 2); assert.equal(c2.copies[0].name, 'new.pdf');
  const c3 = await one(db, 'select copy_remove($1, $2, $3)', [cid, cu.id, c2.copies[0].id]);
  assert.equal(c3.copies.length, 1);
  assert.equal(await one(db, 'select count(*)::int from license_copies'), 2, 'removed copies are kept');
  assert.ok(c3.history.some((h) => h.what === 'license copy removed'));
  assert.equal(await one(db, "select copy_path_ok($1, 'manager')", [cid + '/x/y.jpg']), true);
  assert.equal(await one(db, "select copy_path_ok($1, 'staff')", ['not-a-company/x.jpg']), false);
  const n1 = await one(db, 'select note_add($1, $2, $3)', [cid, cu.id, 'Pays by check on Fridays']);
  assert.equal(n1.notes[0].text, 'Pays by check on Fridays');
  assert.ok(n1.history.some((h) => h.what === 'license changed'));
  assert.ok(n1.history.some((h) => h.what === 'customer added'));

  // Staff see items without costs and can add notes, but can't change customers or items.
  await one(db, 'select invite_put($1, $2, $3)', [cid, 'staff@example.com', 'staff']);
  await as(db, MGR, 'staff@example.com');
  await one(db, 'select my_companies()');
  const list = await one(db, 'select items_list($1)', [cid]);
  assert.equal(list[0].sizes[0].cost, null); assert.equal(list[0].cost_hidden, true);
  await one(db, 'select note_add($1, $2, $3)', [cid, cu.id, 'Called']);
  await fails(db, 'select customer_put($1, $2::jsonb)', [cid, JSON.stringify({ id: cu.id, name: 'Mine' })], /manager or owner/);
  await fails(db, 'select item_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Mine', sizes: [{ name: 'Box', n: 1 }] })], /manager or owner/);

  // Someone outside sees nothing.
  await as(db, OUT, 'out@example.com');
  await fails(db, 'select customers_list($1)', [cid], /no access/);
  await fails(db, 'select customer_get($1, $2)', [cid, cu.id], /no access/);
});

test('Phase 1: bring in items and customers, then take it back', async () => {
  const db = await fresh();
  await as(db, OWNER, 'owner@example.com');
  const c = await one(db, "select create_company($1::jsonb)", [JSON.stringify({ name: 'Knox', home: 'TN' })]);
  const cid = c.id;
  await one(db, 'select item_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Already here', sizes: [{ name: 'Box', n: 1, upc: '028200003843' }] })]);

  const imp = await one(db, 'select import_start($1, $2::jsonb)', [cid, JSON.stringify({ kind: 'items', file: 'items.csv' })]);
  const r = await one(db, 'select import_items($1, $2, $3::jsonb)', [cid, imp, JSON.stringify([
    { name: 'Seneca FF', category: 'cigarettes', unit: 'pack', sizes: [{ name: 'Carton', n: 10, upc: '014700319017', cost: 28.9, prices: { 1: 34.2 } }] },
    { name: 'Marlboro', sizes: [{ name: 'Carton', n: 10, upc: '028200003843' }] },
    { name: 'Lighter', category: 'nonsense', sizes: [{ name: 'Each', n: 1, upc: '' }] }])]);
  assert.deepEqual(r, { added: 2, skipped: 1 });
  const done = await one(db, 'select import_finish($1, $2)', [cid, imp]);
  assert.equal(done.added, 2);
  assert.equal((await one(db, 'select items_list($1)', [cid])).length, 3);

  const ic = await one(db, 'select import_start($1, $2::jsonb)', [cid, JSON.stringify({ kind: 'customers', file: 'c.xlsx', old_total: '1500.25' })]);
  const rc = await one(db, 'select import_customers($1, $2, $3::jsonb)', [cid, ic, JSON.stringify([
    { name: 'Clinton Hwy Market', store_no: '104', terms: 'net7', level: 2, opening: 1200.25, licenses: [{ kind: 'resale', number: '0106' }, { kind: 'tobacco', number: '46-1', expires: '2027-01-31' }] },
    { name: 'Powell Quick Stop', level: 9, opening: 300 }, { name: ' clinton  hwy market ', store_no: '104' }])]);
  assert.deepEqual(rc, { added: 2, skipped: 1, balance: 1500.25 });
  const list = await one(db, 'select customers_list($1)', [cid]);
  const cl = list.find((x) => x.name === 'Clinton Hwy Market');
  assert.equal(Number(cl.owes), 1200.25); assert.equal(cl.level, 2); assert.equal(cl.licenses.length, 2);
  assert.equal(list.find((x) => x.name === 'Powell Quick Stop').level, 1, 'unknown level → the default');
  const hist = await one(db, 'select imports_list($1)', [cid]);
  assert.equal(Number(hist[0].balance), 1500.25); assert.equal(Number(hist[0].old_total), 1500.25);

  // Only an owner changes a starting balance.
  await one(db, 'select invite_put($1, $2, $3)', [cid, 'mgr@example.com', 'manager']);
  await as(db, MGR, 'mgr@example.com'); await one(db, 'select my_companies()');
  await fails(db, 'select customer_put($1, $2::jsonb)', [cid, JSON.stringify({ id: cl.id, opening: 0 })], /only an owner/);
  // Taking an import back removes what it added, once.
  const u = await one(db, 'select import_undo($1, $2)', [cid, ic]);
  assert.equal(u.removed, 2);
  assert.equal((await one(db, 'select customers_list($1)', [cid])).length, 0);
  await fails(db, 'select import_undo($1, $2)', [cid, ic], /already taken back/);
  await fails(db, 'select import_customers($1, $2, $3::jsonb)', [cid, ic, '[]'], /import not found/);
});
