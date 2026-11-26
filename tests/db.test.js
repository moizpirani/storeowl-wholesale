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
