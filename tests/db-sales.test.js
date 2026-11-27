// Phase 2, piece 1: the Counter's sales, invoice numbers, review and unknown barcodes, on a local Postgres (PGlite).
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
const save = (db, cid, p) => one(db, 'select sale_save($1, $2::jsonb)', [cid, JSON.stringify(p)]);

test('Counter: price on the server, suspend, send for review, post with invoice numbers', async () => {
  const db = new PGlite(); await db.exec(AUTH); await db.exec(SQL); await db.exec(SQL);
  await as(db, OWNER, 'owner@example.com');
  const cid = (await one(db, 'select create_company($1::jsonb)', [JSON.stringify({ name: 'Knox', home: 'TN' })])).id;
  const brk = [{ min: 5, off: 0.6 }];
  const ff = await one(db, 'select item_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Seneca FF', category: 'cigarettes', break_group: 'Seneca',
    sizes: [{ name: 'Carton', n: 10, upc: '014700319017', prices: { 1: 34.5, 2: 34.2 }, breaks: brk }] })]);
  const me = await one(db, 'select item_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Seneca Menthol', category: 'cigarettes', break_group: 'seneca ',
    sizes: [{ name: 'carton', n: 10, upc: '014700319024', prices: { 1: 34.5, 2: 34.2 }, breaks: brk }] })]);
  const lt = await one(db, 'select item_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Lighter', sizes: [{ name: 'Each', n: 1, prices: { 1: 0.9 } }] })]);
  const cu = await one(db, 'select customer_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Clinton Hwy Market', level: 2, opening: 100 })]);
  const L = (it, ordered, shipped) => ({ size_id: it.sizes[0].id, ordered, shipped });

  // 4 + 1 Seneca cartons count together → both get the 5+ break at level 2.
  const s1 = await save(db, cid, { customer_id: cu.id, action: 'suspend', lines: [L(ff, 4, 4), L(me, 1, 1)], price: 1 });
  assert.equal(s1.status, 'suspended'); assert.equal(Number(s1.total), 168); assert.equal(s1.units, 5);
  assert.deepEqual(s1.lines.map((l) => Number(l.unit_price)), [33.6, 33.6]);
  assert.equal(s1.customer.name, 'Clinton Hwy Market'); assert.equal(s1.number, null);
  assert.equal((await one(db, 'select sales_list($1, $2)', [cid, 'suspended'])).length, 1);

  // No price at the customer's level → refused in plain words. Nothing to ship → can't complete.
  await fails(db, 'select sale_save($1, $2::jsonb)', [cid, JSON.stringify({ id: s1.id, action: 'suspend', lines: [L(lt, 1, 1)] })], /Lighter \(Each\) has no price/);
  await fails(db, 'select sale_save($1, $2::jsonb)', [cid, JSON.stringify({ id: s1.id, action: 'complete', lines: [L(ff, 2, 0)] })], /nothing is shipped/);
  await fails(db, 'select sale_save($1, $2::jsonb)', [cid, JSON.stringify({ customer_id: cu.id, action: 'complete', lines: [] })], /scan at least one/);

  // Complete: invoice 1001, owes = starting balance + invoices.
  const p1 = await save(db, cid, { id: s1.id, action: 'complete', lines: [L(ff, 4, 4), L(me, 1, 1)], lic_reason: 'Copy coming Friday' });
  assert.equal(p1.status, 'posted'); assert.equal(p1.number, 1001); assert.equal(p1.lic_reason, 'Copy coming Friday');
  assert.equal(Number((await one(db, 'select customer_get($1, $2)', [cid, cu.id])).owes), 268);
  await fails(db, 'select sale_save($1, $2::jsonb)', [cid, JSON.stringify({ id: s1.id, action: 'suspend', lines: [L(ff, 1, 1)] })], /already an invoice/);
  const last = await one(db, 'select sale_last($1, $2)', [cid, cu.id]);
  assert.equal(last.number, 1001);

  // Staff send for review (with a reason); only managers see the review list and finish it, dated the day it was sent.
  await one(db, 'select invite_put($1, $2, $3)', [cid, 'staff@example.com', 'staff']);
  await as(db, STAFF, 'staff@example.com'); await one(db, 'select my_companies()');
  await fails(db, 'select sale_save($1, $2::jsonb)', [cid, JSON.stringify({ customer_id: cu.id, action: 'review', lines: [L(ff, 2, 2)] })], /what the manager should check/);
  const r1 = await save(db, cid, { customer_id: cu.id, action: 'review', lines: [L(ff, 2, 2)], why: 'Price check' });
  assert.equal(r1.status, 'review'); assert.equal(r1.by_name, 'staff@example.com');
  await fails(db, 'select sales_list($1, $2)', [cid, 'review'], /only owners and managers/);
  await fails(db, 'select sale_save($1, $2::jsonb)', [cid, JSON.stringify({ id: r1.id, action: 'complete', lines: [L(ff, 2, 2)] })], /owner or manager finishes/);
  await as(db, OWNER, 'owner@example.com');
  assert.equal((await one(db, 'select sales_list($1, $2)', [cid, 'review'])).length, 1);
  await db.query("update sales set sent_at = '2026-11-20 15:00+00' where id = $1", [r1.id]);
  const p2 = await save(db, cid, { id: r1.id, action: 'complete', lines: [L(ff, 3, 3)] });
  assert.equal(p2.number, 1002); assert.equal(p2.invoice_date, '2026-11-20'); assert.equal(Number(p2.total), 102.6);
  assert.equal((await one(db, 'select sales_list($1, $2)', [cid, 'posted'])).length, 2);

  // Cancel a suspended sale; History has it all.
  const s3 = await save(db, cid, { customer_id: cu.id, action: 'suspend', lines: [L(ff, 1, 1)] });
  assert.equal((await save(db, cid, { id: s3.id, action: 'cancel' })).status, 'cancelled');
  const hist = await one(db, 'select change_log_list($1)', [cid]);
  for (const w of ['sale suspended', 'sale sent for review', 'invoice posted', 'sale cancelled']) assert.ok(hist.some((h) => h.what === w), w);
});

test('Counter: unknown barcodes go to the back office; license warning off is for owners', async () => {
  const db = new PGlite(); await db.exec(AUTH); await db.exec(SQL);
  await as(db, OWNER, 'owner@example.com');
  const cid = (await one(db, 'select create_company($1::jsonb)', [JSON.stringify({ name: 'Knox', home: 'TN' })])).id;
  const it = await one(db, 'select item_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Mystery gum', sizes: [{ name: 'Box', n: 12, prices: { 1: 9 } }, { name: 'Each', n: 1, upc: '012345678905', prices: { 1: 1 } }] })]);
  await one(db, 'select invite_put($1, $2, $3)', [cid, 'staff@example.com', 'staff']);
  await as(db, STAFF, 'staff@example.com'); await one(db, 'select my_companies()');
  await one(db, 'select upc_unknown_scan($1, $2, null)', [cid, '0 70000 12345']);
  await one(db, 'select upc_unknown_scan($1, $2, null)', [cid, '07000012345']);
  await one(db, 'select upc_unknown_scan($1, $2, $3)', [cid, '07000012345', it.id]);
  await one(db, 'select upc_unknown_scan($1, $2, null)', [cid, '12']); // too short: ignored
  await fails(db, 'select upc_unknown_list($1)', [cid], /manager or owner/);

  await as(db, OWNER, 'owner@example.com');
  let l = await one(db, 'select upc_unknown_list($1)', [cid]);
  assert.equal(l.length, 1); assert.equal(l[0].times, 2); assert.equal(l[0].sold_as_name, 'Mystery gum');
  await fails(db, 'select upc_unknown_done($1, $2, $3, $4)', [cid, '07000012345', 'add', it.sizes[1].id], /already has a barcode/);
  l = await one(db, 'select upc_unknown_done($1, $2, $3, $4)', [cid, '07000012345', 'add', it.sizes[0].id]);
  assert.equal(l.length, 0);
  const got = (await one(db, 'select items_list($1)', [cid]))[0];
  assert.equal(got.sizes.find((z) => z.name === 'Box').upc, '07000012345');
  await one(db, 'select upc_unknown_scan($1, $2, null)', [cid, '99999999']);
  assert.equal((await one(db, 'select upc_unknown_done($1, $2, $3, null)', [cid, '99999999', 'ignore'])).length, 0);

  // 'off' = don't warn at the Counter: owners only.
  assert.equal((await one(db, 'select company_settings_set($1, $2::jsonb)', [cid, '{"lic_mode":"off"}'])).settings.lic_mode, 'off');
  await one(db, 'select invite_put($1, $2, $3)', [cid, 'mgr@example.com', 'manager']);
  await as(db, MGR, 'mgr@example.com'); await one(db, 'select my_companies()');
  await fails(db, 'select company_settings_set($1, $2::jsonb)', [cid, '{"lic_mode":"off"}'], /only owners can turn off/);
  await one(db, 'select company_settings_set($1, $2::jsonb)', [cid, '{"lic_mode":"warn"}']);
});
