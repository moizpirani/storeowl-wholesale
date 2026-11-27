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
