// Phase 2, piece 3: the printed invoice, the PDF, the email, and the EDI file in the fixed-width layout the big
// regional wholesalers send (one A line per invoice, one B line per item, the SINGLE pack's barcode).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {
  ediFile, ediProblems, ediBlocked, ediName, ediCsv, upc12, upc11, checkDigit, barcodeSvg, invModel, invoiceHtml, invoicePdf,
  invSettings, sendChoice, ediItemNo
} from '../src/invoice.js';
import { buildMails } from '../api/send.js';
import { itemIssues, priceSale } from '../src/rules.js';

const LINES = [
  { item_id: 'a', name: 'Seneca FF', size: 'Carton', n: 10, unit_name: 'pack', upc: '014700319017', single_upc: '01470031900', item_no: '4471', category: 'cigarettes', ordered: 5, shipped: 4, unit_price: 33.9, price: 34.5, off: 0.6, total: 135.6 },
  { item_id: 'b', name: 'Zyn Cool Mint 6mg', size: 'Can', n: 1, unit_name: 'can', upc: '082316003012', single_upc: '082316003012', item_no: 'ZY-6', category: 'pouches', ordered: 5, shipped: 5, unit_price: 5, total: 25 },
  { item_id: 'c', name: 'Grabba Leaf Small', size: 'Box', n: 25, unit_name: 'each', upc: '', single_upc: '', item_no: '', category: 'otp', ordered: 1, shipped: 1, unit_price: 33, total: 33 }
];
const SALE = { id: 's1', number: 1001, invoice_date: '2026-11-27', total: 193.6, posted_by: 'Sam', lines: LINES };
const CUST = { name: 'Maynardville Fuel Stop', store_no: 'MV-2', acct_no: '211', email: 'mv@example.com', edi_email: 'edi@example.com', terms: 'net7', owes: 243.6,
  addr: '123 Main St', city: 'Maynardville', state: 'TN', zip: '37807', licenses: [{ kind: 'resale', number: 'R-77', expires: '2027-06-30' }, { kind: 'tobacco', number: '' }] };
const CO = { name: 'Knox Wholesale', email: 'office@knox.example', phone: '865-555-0100', home: 'TN', settings: { inv: { lic: 'TN Tobacco Distributor #12345', msa: 'MSA-9' } } };

// The same field positions the store's back office reads (StoreOwl Back Office, parseUcs).
function readBack(txt) {
  const L = txt.split(/\r?\n/).filter(Boolean);
  const isA = (l) => /^A\d{6}\d{10}\d{6}[+-]\d{9}/.test(l);
  const isB = (l) => l.length >= 67 && l[0] === 'B' && /^\d{7}\d{6}\d{2}\d{6}[+-]\d{4}\d{5}/.test(l.slice(36, 67));
  assert.ok(isA(L[0]), 'the first line is the invoice');
  const a = L[0];
  const inv = { acct: a.slice(1, 7), no: a.slice(7, 17).replace(/^0+/, ''), date: a.slice(17, 23), total: Number(a.slice(23, 24) + a.slice(24, 33)) / 100, lines: [] };
  L.slice(1).forEach((l) => {
    assert.ok(isB(l), 'every item line reads: ' + l);
    inv.lines.push({ upc: l.slice(1, 12).trim(), name: l.slice(12, 36).trim(), item: l.slice(36, 43), cost: Number(l.slice(43, 49)) / 100, pack: Number(l.slice(51, 57)), qty: Number(l.slice(57, 58) + l.slice(58, 62)) });
  });
  return inv;
}

test('EDI file: the layout stores already read, with the single pack barcode', () => {
  const f = ediFile(SALE, CUST), r = readBack(f);
  assert.deepEqual({ acct: r.acct, no: r.no, date: r.date, total: r.total }, { acct: '000211', no: '1001', date: '112726', total: 193.6 });
  assert.equal(r.lines.length, 3);
  // A carton line sends the PACK barcode (no check digit), packs in a carton, the carton cost and cartons shipped.
  assert.deepEqual(r.lines[0], { upc: '01470031900', name: 'SENECA FF', item: '0004471', cost: 33.9, pack: 10, qty: 4 });
  assert.deepEqual(r.lines[1], { upc: '08231600301', name: 'ZYN COOL MINT 6MG', item: ediItemNo(LINES[1]), cost: 5, pack: 1, qty: 5 });
  assert.equal(r.lines[2].upc, '', 'no single pack barcode = left blank, never the box barcode');
  assert.equal(r.lines.reduce((s, l) => s + Math.round(l.cost * l.qty * 100), 0) / 100, r.total, 'lines add up to the invoice total');
  assert.ok(f.split('\r\n').every((l) => !l || l.length === 39 || l.length === 70));
  assert.match(ediName(SALE, CUST), /^LOC 000211 112726 1001\.txt$/);
  // Item #s that aren't 1–7 digits get a steady made-up number (never a 99 charge number).
  assert.equal(ediItemNo(LINES[1]), ediItemNo(LINES[1])); assert.ok(!/^99/.test(ediItemNo(LINES[1])));
  assert.equal(ediItemNo({ item_no: '9912345', item_id: 'z' }).slice(0, 2) === '99', false);
});

test('EDI problems in plain words; a missing pack barcode only warns', () => {
  const p = ediProblems(SALE, CUST);
  assert.equal(p.length, 1); assert.equal(p[0].k, 'pack'); assert.ok(p[0].soft); assert.match(p[0].t, /Grabba Leaf Small/);
  assert.equal(ediBlocked(SALE, CUST), false);
  assert.equal(ediBlocked(SALE, Object.assign({}, CUST, { acct_no: '', store_no: 'MV-2' })), true, 'needs a customer #');
  assert.equal(ediBlocked(SALE, Object.assign({}, CUST, { acct_no: '', store_no: '42' })), false, 'a store # of digits is used');
  assert.equal(ediBlocked(SALE, Object.assign({}, CUST, { acct_no: '1234567' })), true);
  assert.match(ediCsv(SALE), /"Pack barcode".*\r\n"1001","2026-11-27","4471","014700319003","Seneca FF","Carton · 10 packs","10","4","33.90","3.3900","135.60"/);
});

test('UPC: check digits, 11 / 12 / 13 digits, a real barcode', () => {
  assert.equal(checkDigit('01200000129'), 1);
  assert.equal(upc12('01200000129'), '012000001291'); assert.equal(upc12('012000001291'), '012000001291');
  assert.equal(upc12('0012000001291'), '012000001291'); assert.equal(upc12('012000001292'), '', 'a wrong check digit is not guessed');
  assert.equal(upc11('012000001291'), '01200000129');
  const svg = barcodeSvg('012000001291');
  assert.match(svg, /^<svg class="iv-bc" viewBox="0 0 95 22"/);
  assert.equal(barcodeSvg('123'), '');
});

test('Printed invoice and PDF: licenses, grouped lines, short, break price, what the store owes', () => {
  const M = invModel({ sale: SALE, co: CO, cust: CUST, fresh: true });
  assert.deepEqual(M.seller.lic, ['TN Tobacco Distributor #12345']); assert.equal(M.seller.msa, 'MSA-9');
  assert.deepEqual(M.buyer.lic.map((l) => l.name), ['Resale certificate'], 'only filled licenses');
  assert.deepEqual(M.groups.map((g) => [g.name, g.sub]), [['Cigarettes', 135.6], ['Nicotine pouches', 25], ['Other tobacco', 33]]);
  assert.deepEqual(M.sums, { cig: 135.6, other: 58, total: 193.6, units: 10 });
  assert.deepEqual(M.owes, { before: 50, now: 243.6 });
  assert.equal(M.tax, 'Tennessee Dept of Revenue Tobacco Tax Paid Invoice');
  const h = invoiceHtml(M);
  assert.match(h, /INVOICE<b>#1001/); assert.match(h, /1 short/); assert.match(h, /class="iv-was">\$34\.50/); assert.match(h, /Carton · 10 packs/);
  assert.match(h, /Net 7<\/b><div>Charged to account/); assert.ok(!/due/i.test(h), 'no due date');
  assert.match(h, /You owed before this invoice/); assert.match(h, /Tobacco Tax Paid/);
  const later = invModel({ sale: SALE, co: CO, cust: CUST, today: '2026-12-02' });
  assert.deepEqual(later.owes, { asOf: '2026-12-02', now: 243.6 }, 'a reprint says what they owe as of today');
  const pdf = invoicePdf(M);
  assert.equal(pdf.pages, 1); assert.equal(String.fromCharCode(...pdf.bytes.slice(0, 8)), '%PDF-1.4');
  const many = invModel({ sale: Object.assign({}, SALE, { lines: Array.from({ length: 80 }, () => LINES[1]) }), co: CO, cust: CUST });
  assert.equal(invoicePdf(many).pages, 3, 'long invoices go onto more pages');
  const off = invModel({ sale: SALE, co: Object.assign({}, CO, { settings: { inv: { owes: false, tax_line: false } } }), cust: CUST });
  assert.equal(off.owes, null); assert.equal(off.tax, '');
});

test('What a store gets after a sale: its own choice, else the company’s', () => {
  assert.deepEqual(sendChoice(CO, CUST), { print: true, email: false, edi: false });
  assert.deepEqual(sendChoice(CO, Object.assign({}, CUST, { gets: { email: true, edi: true, print: false } })), { print: false, email: true, edi: true });
  assert.equal(sendChoice(CO, Object.assign({}, CUST, { email: '', gets: { email: true } })).email, false, 'no email = can’t');
  assert.equal(invSettings({ settings: { inv: { copies: 9 } } }).copies, 5);
});

test('The emails: PDF to the invoice email, EDI file to the EDI email, replies to the wholesaler', () => {
  const m = buildMails({ sale: SALE, customer: CUST, company: CO }, { email: true, edi: true });
  assert.equal(m.length, 2);
  assert.equal(m[0].mail.to, 'mv@example.com'); assert.equal(m[0].mail.replyTo, 'office@knox.example');
  assert.match(m[0].mail.from, /^"Knox Wholesale" <invoices@storeowl\.app>$/);
  assert.match(m[0].mail.attachments[0].filename, /^Invoice-1001-Maynardville-Fuel-Stop\.pdf$/);
  assert.equal(m[1].mail.to, 'edi@example.com'); assert.match(m[1].mail.attachments[0].filename, /\.txt$/);
  assert.match(m[1].mail.subject, /Knox Wholesale Invoices 211/);
  const none = buildMails({ sale: SALE, customer: Object.assign({}, CUST, { email: '', edi_email: '' }), company: CO }, { email: true, edi: true });
  assert.deepEqual(none.map((x) => !!x.err), [true, true]);
});

test('Items: a missing single-pack barcode is Needs you', () => {
  const it = { sizes: [{ name: 'Carton', n: 10, upc: '014700319017', cost: 1, prices: { 1: 2 } }] };
  assert.deepEqual(itemIssues(it, [{ n: 1 }]).map((x) => x.k), ['pack']);
  it.sizes.push({ name: 'Pack', n: 1, upc: '01470031900', cost: 0.1, prices: { 1: 0.5 } });
  assert.deepEqual(itemIssues(it, [{ n: 1 }]), []);
  const pr = priceSale([{ size_id: 'x', ordered: 1, shipped: 1 }], [{ id: 'i', name: 'X', item_no: '77', sizes: [{ id: 'x', name: 'Carton', n: 10, upc: '1', prices: { 1: 3 } }, { id: 'y', name: 'Pack', n: 1, upc: '012000001291', prices: {} }] }], 1);
  assert.equal(pr.lines[0].single_upc, '012000001291'); assert.equal(pr.lines[0].item_no, '77');
});

// ---------- the database ----------
const SQL = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const AUTH = `create role anon nologin; create role authenticated nologin; create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', current_setting('t.email', true)) $$;`;
const OWNER = '00000000-0000-4000-8000-000000000001', OTHER = '00000000-0000-4000-8000-000000000009';
const as = (db, uid, email) => db.query("select set_config('t.uid', $1, false), set_config('t.email', $2, false)", [uid, email]);
const one = async (db, sql, args) => Object.values((await db.query(sql, args || [])).rows[0])[0];

test('Database: lines keep the item # and pack barcode; what went out is kept; customer EDI details', async () => {
  const db = new PGlite(); await db.exec(AUTH); await db.exec(SQL); await db.exec(SQL);
  await as(db, OWNER, 'owner@example.com');
  const cid = (await one(db, 'select create_company($1::jsonb)', [JSON.stringify({ name: 'Knox', home: 'TN' })])).id;
  const it = await one(db, 'select item_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Seneca FF', item_no: '4471', category: 'cigarettes',
    sizes: [{ name: 'Carton', n: 10, upc: '014700319017', prices: { 1: 34.5 } }, { name: 'Pack', n: 1, upc: '01470031900', prices: { 1: 3.6 } }] })]);
  const cu = await one(db, 'select customer_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Powell Quick Stop', email: 'p@example.com', edi_email: 'EDI@Example.com', acct_no: '307', gets: { edi: true, print: 'x' } })]);
  assert.equal(cu.edi_email, 'edi@example.com'); assert.equal(cu.acct_no, '307'); assert.deepEqual(cu.gets, { edi: true });
  await assert.rejects(db.query('select customer_put($1, $2::jsonb)', [cid, JSON.stringify({ id: cu.id, acct_no: 'A12' })]), /numbers only/);
  const s = await one(db, 'select sale_save($1, $2::jsonb)', [cid, JSON.stringify({ customer_id: cu.id, action: 'complete', lines: [{ size_id: it.sizes[0].id, ordered: 2, shipped: 2 }] })]);
  assert.equal(s.lines[0].item_no, '4471'); assert.equal(s.lines[0].single_upc, '01470031900');
  const d = await one(db, 'select invoice_data($1, $2)', [cid, s.id]);
  assert.equal(d.sale.number, 1001); assert.equal(d.customer.edi_email, 'edi@example.com'); assert.equal(Number(d.customer.owes), 69); assert.equal(d.company.name, 'Knox');
  assert.equal(readBack(ediFile(d.sale, d.customer)).lines[0].upc, '01470031900');
  const after = await one(db, 'select sale_sent($1, $2, $3::jsonb)', [cid, s.id, JSON.stringify({ kind: 'edi', to: 'edi@example.com' })]);
  assert.equal(after.sends.length, 1); assert.equal(after.sends[0].kind, 'edi'); assert.equal(after.sends[0].ok, true);
  const s2 = await one(db, 'select company_settings_set($1, $2::jsonb)', [cid, JSON.stringify({ inv: { lic: 'TN #1', copies: 2, junk: 1 } })]);
  assert.deepEqual(s2.settings.inv, { lic: 'TN #1', copies: 2 });
  await assert.rejects(db.query('select company_settings_set($1, $2::jsonb)', [cid, JSON.stringify({ inv: { copies: 9 } })]), /1 to 5 copies/);
  // Another company can't see it or write to it.
  await as(db, OTHER, 'other@example.com');
  await assert.rejects(db.query('select invoice_data($1, $2)', [cid, s.id]));
  await assert.rejects(db.query('select sale_sent($1, $2, $3::jsonb)', [cid, s.id, '{"kind":"email"}']));
});
