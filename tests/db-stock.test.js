// Phase 4: "You sell it" per size, extra barcodes, and (later in this file) receiving supplier invoices and stock.
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
const STAFF = '00000000-0000-4000-8000-000000000004';

async function as(db, uid, email) { await db.query("select set_config('t.uid', $1, false), set_config('t.email', $2, false)", [uid || '', email || '']); }
async function one(db, sql, args) { const r = await db.query(sql, args || []); return Object.values(r.rows[0])[0]; }
async function fails(db, sql, args, re) { await assert.rejects(db.query(sql, args || []), re); }
const put = (db, cid, p) => one(db, 'select item_put($1, $2::jsonb)', [cid, JSON.stringify(p)]);
const save = (db, cid, p) => one(db, 'select sale_save($1, $2::jsonb)', [cid, JSON.stringify(p)]);

export async function setup() {
  const db = new PGlite(); await db.exec(AUTH); await db.exec(SQL); await db.exec(SQL);
  await as(db, OWNER, 'owner@example.com');
  const cid = (await one(db, 'select create_company($1::jsonb)', [JSON.stringify({ name: 'Knox', home: 'TN' })])).id;
  await one(db, 'select invite_put($1, $2, $3)', [cid, 'staff@example.com', 'staff']);
  await one(db, 'select invite_put($1, $2, $3)', [cid, 'mgr@example.com', 'manager']);
  for (const [u, e] of [[STAFF, 'staff@example.com'], [MGR, 'mgr@example.com']]) { await as(db, u, e); await one(db, 'select my_companies()'); }
  await as(db, OWNER, 'owner@example.com');
  return { db, cid };
}

test('You sell it: a pack kept only for the store’s barcode is never sold; extra barcodes per size', async () => {
  const { db, cid } = await setup();
  const it = await put(db, cid, { name: 'Marlboro Red Box', category: 'cigarettes', unit: 'pack', sizes: [
    { name: 'Carton', n: 10, upc: '028200003843', cost: 71.1, prices: { 1: 79.9 }, upcs: ['028200003850'] },
    { name: 'Pack', n: 1, upc: '028200003842', sells: false }] });
  const [ct, pk] = it.sizes;
  assert.equal(ct.sells, true); assert.equal(pk.sells, false);
  assert.deepEqual(ct.upcs, ['028200003850']); assert.deepEqual(pk.upcs, []);

  // The same barcode can't be on two items, whether it's the main barcode or an extra one.
  await fails(db, 'select item_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Other', sizes: [{ name: 'Box', n: 1, upc: '028200003850' }] })], /already on Marlboro/);
  await fails(db, 'select item_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Other', sizes: [{ name: 'Box', n: 1, upcs: ['028200003842'] }] })], /already on Marlboro/);
  await fails(db, 'select item_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Twice', sizes: [{ name: 'Box', n: 1, upc: '012345678905', upcs: ['012345678905'] }] })], /typed twice/);
  await fails(db, 'select item_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'None sold', sizes: [{ name: 'Pack', n: 1, sells: false }] })], /one you sell/);

  // Saving again keeps the extra barcodes (they're sent with the item) and can take them off.
  const again = await put(db, cid, Object.assign({}, it, { sizes: [Object.assign({}, ct, { upcs: [] }), pk] }));
  assert.deepEqual(again.sizes[0].upcs, []);
  const back = await put(db, cid, Object.assign({}, it, { sizes: [ct, pk] }));
  assert.deepEqual(back.sizes[0].upcs, ['028200003850']);

  // The pack can't be sold; the carton can. The invoice line still carries the pack barcode for the EDI file.
  const cu = await one(db, 'select customer_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Clinton Hwy Market', level: 1 })]);
  await fails(db, 'select sale_save($1, $2::jsonb)', [cid, JSON.stringify({ customer_id: cu.id, action: 'complete', lines: [{ size_id: pk.id, ordered: 1, shipped: 1 }] })], /isn't a size you sell/);
  const s = await save(db, cid, { customer_id: cu.id, action: 'complete', lines: [{ size_id: ct.id, ordered: 2, shipped: 2 }] });
  assert.equal(s.status, 'posted'); assert.equal(s.lines[0].single_upc, '028200003842');
});

const recv = (db, cid, p) => one(db, 'select receiving_save($1, $2::jsonb)', [cid, JSON.stringify(p)]);
const stockOf = async (db, cid, itemId) => (await one(db, 'select stock_list($1)', [cid])).find((x) => x.item_id === itemId);

test('Receiving: anyone receives into stock; totals must match; only an owner changes costs and prices', async () => {
  const { db, cid } = await setup();
  const it = await put(db, cid, { name: 'Marlboro Red Box', category: 'cigarettes', unit: 'pack', sizes: [
    { name: 'Carton', n: 10, upc: '028200003843', cost: 101.08, prices: { 1: 106.5, 2: 105.9 } },
    { name: 'Pack', n: 1, upc: '028200003842', sells: false }] });
  const ct = it.sizes[0], pk = it.sizes[1];

  await as(db, STAFF, 'staff@example.com');
  const sup = await one(db, 'select supplier_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Eastside Tobacco Distributors' })]);
  await fails(db, 'select supplier_put($1, $2::jsonb)', [cid, JSON.stringify({ name: ' eastside tobacco distributors ' })], /already a supplier/);
  await fails(db, 'select supplier_put($1, $2::jsonb)', [cid, JSON.stringify({ id: sup.id, name: 'Renamed' })], /manager or owner/);

  // 10 cases of 10 cartons at $1,021.80 a case (cost up $1.10 a carton). Saved for later first.
  const line = { size_id: ct.id, unit: 'Case', per: 10, qty: 10, cost: 1021.8, their_no: '20114' };
  const d = await recv(db, cid, { supplier_id: sup.id, number: '448355', inv_date: '2026-11-27', inv_total: 10500, lines: [line], action: 'draft' });
  assert.equal(d.status, 'draft'); assert.equal(+d.total, 10218);
  await fails(db, 'select receiving_save($1, $2::jsonb)', [cid, JSON.stringify({ id: d.id, supplier_id: sup.id, number: '448355', inv_total: 10500, lines: [line], action: 'receive' })], /add up to 10,218.00 but the invoice says 10,500.00/);
  await fails(db, 'select receiving_save($1, $2::jsonb)', [cid, JSON.stringify({ id: d.id, supplier_id: sup.id, number: '448355', inv_total: 7.11, lines: [{ size_id: pk.id, qty: 1, cost: 7.11 }], action: 'receive' })], /isn't a size you sell/);
  const r = await recv(db, cid, { id: d.id, supplier_id: sup.id, number: '448355', inv_date: '2026-11-27', inv_total: 10218, lines: [line], action: 'receive', prices: 'same' });
  assert.equal(r.status, 'received'); assert.equal(r.received_by, 'staff@example.com');
  assert.equal(r.costs, 'waiting', 'staff can’t change costs: they wait for an owner');
  assert.equal(r.cost_changes.list[0].after, 102.18);
  assert.equal(+(await stockOf(db, cid, it.id)).on_hand, 1000, '10 cases × 10 cartons × 10 packs');
  // Costs didn't change yet.
  assert.equal((await one(db, 'select items_list($1)', [cid]))[0].sizes[0].cost, null, 'staff don’t see costs');
  await as(db, OWNER, 'owner@example.com');
  assert.equal((await one(db, 'select items_list($1)', [cid]))[0].sizes[0].cost, 101.08);
  // The same invoice can't be received twice.
  await fails(db, 'select receiving_save($1, $2::jsonb)', [cid, JSON.stringify({ supplier_id: sup.id, number: '448355', inv_total: 10218, lines: [line], action: 'receive' })], /already received/);
  // What was learned about the supplier: their item #, their unit.
  const sl = await one(db, 'select suppliers_list($1)', [cid]);
  assert.deepEqual([sl[0].items[0].their_no, sl[0].items[0].unit, sl[0].items[0].per], ['20114', 'Case', 10]);
  assert.equal(sl[0].last.number, '448355');

  // A manager can't check costs; the owner adds the same amount to every price.
  await as(db, MGR, 'mgr@example.com');
  await fails(db, 'select receiving_costs($1, $2, $3)', [cid, r.id, 'same'], /only an owner/);
  await as(db, OWNER, 'owner@example.com');
  const ok = await one(db, 'select receiving_costs($1, $2, $3)', [cid, r.id, 'same']);
  assert.equal(ok.costs, 'done');
  const after = (await one(db, 'select items_list($1)', [cid]))[0].sizes[0];
  assert.equal(after.cost, 102.18); assert.deepEqual(after.prices, { 1: 107.6, 2: 107 });

  // The owner receives the next one and keeps the margin right away.
  const r2 = await recv(db, cid, { supplier_id: sup.id, number: '448400', inv_total: 1043.6, lines: [{ size_id: ct.id, unit: 'Case', per: 10, qty: 1, cost: 1043.6 }], action: 'receive', prices: 'margin' });
  assert.equal(r2.costs, 'done');
  const m = (await one(db, 'select items_list($1)', [cid]))[0].sizes[0];
  assert.equal(m.cost, 104.36); assert.equal(m.prices[1], Math.round(107.6 * 104.36 / 102.18 * 100) / 100);

  // Selling takes stock out; a void puts it back; a credit for a wrong item puts it back, a damaged one doesn't.
  const cu = await one(db, 'select customer_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Clinton Hwy Market', level: 1 })]);
  const s = await save(db, cid, { customer_id: cu.id, action: 'complete', lines: [{ size_id: ct.id, ordered: 3, shipped: 3 }] });
  assert.equal(+(await stockOf(db, cid, it.id)).on_hand, 1100 - 30);
  const held = await save(db, cid, { customer_id: cu.id, action: 'suspend', lines: [{ size_id: ct.id, ordered: 2, shipped: 2 }] });
  let st = await stockOf(db, cid, it.id);
  assert.deepEqual([+st.on_hand, +st.set_aside, +st.can_sell], [1070, 20, 1050]);
  await one(db, 'select sale_void($1, $2, $3)', [cid, s.id, 'typed the wrong store']);
  assert.equal(+(await stockOf(db, cid, it.id)).on_hand, 1100);
  await one(db, 'select sale_save($1, $2::jsonb)', [cid, JSON.stringify({ kind: 'credit', customer_id: cu.id, action: 'complete', lines: [{ size_id: ct.id, qty: 1, reason: 'wrong' }, { size_id: ct.id, qty: 2, reason: 'damaged' }] })]);
  assert.equal(+(await stockOf(db, cid, it.id)).on_hand, 1110);

  // Undo a receiving (managers): stock comes back out.
  await as(db, STAFF, 'staff@example.com');
  await fails(db, 'select receiving_undo($1, $2)', [cid, r2.id], /manager or owner/);
  await as(db, MGR, 'mgr@example.com');
  assert.equal((await one(db, 'select receiving_undo($1, $2)', [cid, r2.id])).status, 'undone');
  assert.equal(+(await stockOf(db, cid, it.id)).on_hand, 1010);
  const hist = await one(db, 'select change_log_list($1)', [cid]);
  for (const w of ['supplier added', 'supplier invoice saved for later', 'supplier invoice received', 'supplier invoice costs checked', 'supplier invoice taken back']) assert.ok(hist.some((h) => h.what === w), w);
  assert.ok(held.id);
});
