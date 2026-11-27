// Phase 2, piece 4: returns, credit memos and void invoices — the rules, the database (PGlite) and the EDI file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { priceCredit, creditCheck } from '../src/rules.js';
import { invModel, invoiceHtml, invoicePdf, ediFile, ediSubject, invEmailText } from '../src/invoice.js';

const SQL = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const AUTH = `
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', current_setting('t.email', true)) $$;`;
const OWNER = '00000000-0000-4000-8000-000000000001';
const STAFF = '00000000-0000-4000-8000-000000000004';
async function as(db, uid, email) { await db.query("select set_config('t.uid', $1, false), set_config('t.email', $2, false)", [uid || '', email || '']); }
async function one(db, sql, args) { const r = await db.query(sql, args || []); return Object.values(r.rows[0])[0]; }
async function fails(db, sql, args, re) { await assert.rejects(db.query(sql, args || []), re); }
const save = (db, cid, p) => one(db, 'select sale_save($1, $2::jsonb)', [cid, JSON.stringify(p)]);

test('credit prices: what they last paid, else their level; minus quantities and amounts', () => {
  const items = [{ id: 'i1', name: 'Seneca FF', category: 'cigarettes', unit: 'pack', sizes: [{ id: 'z1', name: 'Carton', n: 10, upc: '014700319017', prices: { 1: 34.5, 2: 34.2 } }] },
    { id: 'i2', name: 'ZYN', category: 'pouches', unit: 'can', sizes: [{ id: 'z2', name: 'Roll', n: 5, upc: '', prices: { 2: 26.25 } }] }];
  const r = priceCredit([{ size_id: 'z1', qty: 2, reason: 'damaged' }, { size_id: 'z2', qty: 1, reason: 'expired' }, { other: true, desc: 'Short on last delivery', amount: '12.5', reason: 'other' }],
    items, 2, { z1: 33.6 });
  assert.deepEqual(r.lines.map((l) => [l.unit_price, l.shipped, l.total, l.from]), [[33.6, -2, -67.2, 'paid'], [26.25, -1, -26.25, 'level'], [12.5, -1, -12.5, 'other']]);
  assert.equal(r.total, -105.95); assert.equal(r.count, 3);
  assert.equal(creditCheck(r), '');
  assert.match(creditCheck(priceCredit([{ size_id: 'z1', qty: 1, reason: '' }], items, 2, {})), /Pick why Seneca FF came back/);
  assert.match(creditCheck(priceCredit([{ other: true, desc: '', amount: 5, reason: 'other' }], items, 2, {})), /Say what the credit/);
  assert.match(creditCheck(priceCredit([{ size_id: 'z1', qty: 0, reason: 'damaged' }], items, 2, {})), /How many came back/);
});

test('credit memo in the database: last price, numbered with invoices, lowers what they owe; staff send for review; void', async () => {
  const db = new PGlite(); await db.exec(AUTH); await db.exec(SQL); await db.exec(SQL);
  await as(db, OWNER, 'owner@example.com');
  const cid = (await one(db, 'select create_company($1::jsonb)', [JSON.stringify({ name: 'Knox', home: 'TN' })])).id;
  const ff = await one(db, 'select item_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Seneca FF', category: 'cigarettes', sizes: [{ name: 'Carton', n: 10, upc: '014700319017', prices: { 1: 34.5 }, breaks: [{ min: 5, off: 0.6 }] }] })]);
  const cu = await one(db, 'select customer_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Clinton Hwy Market', level: 1, opening: 0 })]);
  const z = ff.sizes[0].id;
  const inv = await save(db, cid, { customer_id: cu.id, action: 'complete', lines: [{ size_id: z, ordered: 5, shipped: 5 }] });
  assert.equal(inv.number, 1001); assert.equal(Number(inv.total), 169.5);
  assert.equal(Number((await one(db, 'select credit_prices($1, $2)', [cid, cu.id]))[z]), 33.9);

  // A credit comes back at what they paid (33.90 with the break), not today's 34.50.
  const cr = await save(db, cid, { kind: 'credit', customer_id: cu.id, action: 'complete',
    lines: [{ size_id: z, qty: 2, reason: 'damaged' }, { other: true, desc: 'Short on last delivery', amount: 10, reason: 'other' }] });
  assert.equal(cr.kind, 'credit'); assert.equal(cr.number, 1002); assert.equal(Number(cr.total), -77.8);
  assert.deepEqual(cr.lines.map((l) => [Number(l.unit_price), l.shipped, Number(l.total), l.reason]), [[33.9, -2, -67.8, 'damaged'], [10, -1, -10, 'other']]);
  assert.equal(Number((await one(db, 'select customer_get($1, $2)', [cid, cu.id])).owes), 91.7);
  assert.equal((await one(db, 'select sale_last($1, $2)', [cid, cu.id])).number, 1001, 'repeat last order skips credits');
  await fails(db, 'select sale_save($1, $2::jsonb)', [cid, JSON.stringify({ kind: 'credit', customer_id: cu.id, action: 'complete', lines: [{ size_id: z, qty: 1, reason: 'nope' }] })], /pick why/);
  await fails(db, 'select sale_save($1, $2::jsonb)', [cid, JSON.stringify({ kind: 'credit', customer_id: cu.id, action: 'suspend', lines: [{ size_id: z, qty: 1, reason: 'damaged' }] })], /finished now or sent for review/);

  // Staff can ring up a credit but only send it for review.
  await one(db, 'select invite_put($1, $2, $3)', [cid, 'staff@example.com', 'staff']);
  await as(db, STAFF, 'staff@example.com'); await one(db, 'select my_companies()');
  await fails(db, 'select sale_save($1, $2::jsonb)', [cid, JSON.stringify({ kind: 'credit', customer_id: cu.id, action: 'complete', lines: [{ size_id: z, qty: 1, reason: 'expired' }] })], /send the credit for review/);
  const rv = await save(db, cid, { kind: 'credit', customer_id: cu.id, action: 'review', why: 'Store says expired', lines: [{ size_id: z, qty: 1, reason: 'expired' }] });
  assert.equal(rv.status, 'review'); assert.equal(rv.kind, 'credit');
  await fails(db, 'select sale_void($1, $2, $3)', [cid, inv.id, 'oops'], /owner|manager/i);

  // The owner posts it, then voids the invoice: kept, marked void, no longer counted.
  await as(db, OWNER, 'owner@example.com');
  const p2 = await save(db, cid, { id: rv.id, action: 'complete', lines: [{ size_id: z, qty: 1, reason: 'expired' }] });
  assert.equal(p2.number, 1003); assert.equal(p2.kind, 'credit');
  await fails(db, 'select sale_void($1, $2, $3)', [cid, inv.id, '  '], /say why/);
  const v = await one(db, 'select sale_void($1, $2, $3)', [cid, inv.id, 'Rang up the wrong store']);
  assert.equal(v.status, 'void'); assert.equal(v.void_why, 'Rang up the wrong store');
  await fails(db, 'select sale_void($1, $2, $3)', [cid, inv.id, 'again'], /already void/);
  assert.equal(Number((await one(db, 'select customer_get($1, $2)', [cid, cu.id])).owes), -111.7);
  const list = await one(db, 'select sales_list($1, $2)', [cid, 'posted']);
  assert.deepEqual(list.map((s) => [s.number, s.status, s.kind]).sort((a, b) => a[0] - b[0]), [[1001, 'void', 'invoice'], [1002, 'posted', 'credit'], [1003, 'posted', 'credit']]);
  const d = await one(db, 'select invoice_data($1, $2)', [cid, inv.id]);
  assert.equal(d.sale.status, 'void');
  const log = await db.query("select what from change_log where company_id = $1 order by id", [cid]);
  assert.ok(log.rows.some((r) => r.what === 'credit memo posted') && log.rows.some((r) => r.what === 'invoice voided'));
});

test('a credit memo prints, PDFs and EDIs as a credit (minus cases, minus total)', () => {
  const sale = { number: 1002, kind: 'credit', status: 'posted', invoice_date: '2026-11-27', total: -77.8, posted_by: 'Moiz',
    lines: [{ name: 'Seneca FF', size: 'Carton', n: 10, unit_name: 'pack', upc: '014700319017', single_upc: '014700319003', item_no: '4471', category: 'cigarettes', ordered: -2, shipped: -2, qty: 2, price: 33.9, off: 0, unit_price: 33.9, total: -67.8, reason: 'damaged' },
      { other: true, name: 'Short on last delivery', size: '', n: 1, category: 'credit', ordered: -1, shipped: -1, unit_price: 10, total: -10, reason: 'other' }] };
  const cust = { name: 'Clinton Hwy Market', acct_no: '211', owes: 91.7, terms: 'net7', licenses: [] };
  const M = invModel({ sale, co: { name: 'Knox Wholesale', settings: {} }, cust, fresh: true });
  assert.equal(M.title, 'CREDIT MEMO'); assert.equal(M.sums.units, 2); assert.equal(M.owes.before, 169.5);
  const h = invoiceHtml(M);
  assert.match(h, /CREDIT MEMO<b>#1002/); assert.match(h, /Came back/); assert.match(h, /Damaged/); assert.match(h, /Credit memo total/);
  assert.ok(invoicePdf(M).bytes.length > 500);
  const f = ediFile(sale, cust).split('\r\n');
  assert.match(f[0], /^A0002110000001002112726-000007780000211$/);
  assert.equal(f[1], 'B01470031900' + 'SENECA FF'.padEnd(24) + '0004471' + '003390' + '01' + '000010' + '-0002' + '00000001');
  assert.match(f[2], /^B {11}SHORT ON LAST DELIVERY  \d{7}00100001000001-000100000001$/);
  assert.equal(ediSubject({ name: 'Knox' }, cust, sale), 'Knox Invoices 211 · Credit memo #1002');
  assert.match(invEmailText('email', M, { name: 'Knox' }).subject, /Credit memo #1002/);
  const V = invModel({ sale: Object.assign({}, sale, { kind: 'invoice', status: 'void', void_why: 'Wrong store' }), co: { name: 'K', settings: {} }, cust });
  assert.match(invoiceHtml(V), /VOID · Wrong store/);
});
