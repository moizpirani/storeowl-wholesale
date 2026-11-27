// Phase 3, part 1: payments in the database (PGlite) — paying invoices, store credit, post-dated checks, void, aging.
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
const STAFF = '00000000-0000-4000-8000-000000000004';
async function as(db, uid, email) { await db.query("select set_config('t.uid', $1, false), set_config('t.email', $2, false)", [uid || '', email || '']); }
async function one(db, sql, args) { const r = await db.query(sql, args || []); return Object.values(r.rows[0])[0]; }
async function fails(db, sql, args, re) { await assert.rejects(db.query(sql, args || []), re); }
const save = (db, cid, p) => one(db, 'select sale_save($1, $2::jsonb)', [cid, JSON.stringify(p)]);

const pay = (db, cid, p) => one(db, 'select payment_save($1, $2::jsonb)', [cid, JSON.stringify(p)]);
const cust = (db, cid, id) => one(db, 'select customer_get($1, $2)', [cid, id]);
const open = (db, cid, id) => one(db, 'select customer_open($1, $2)', [cid, id]);

test('payments: pay chosen invoices, store credit, credits used, post-dated checks, void, aging', async () => {
  const db = new PGlite(); await db.exec(AUTH); await db.exec(SQL); await db.exec(SQL);
  await as(db, OWNER, 'owner@example.com');
  const cid = (await one(db, 'select create_company($1::jsonb)', [JSON.stringify({ name: 'Knox', home: 'TN' })])).id;
  const ff = await one(db, 'select item_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Seneca FF', category: 'cigarettes', sizes: [{ name: 'Carton', n: 10, prices: { 1: 30 } }] })]);
  const z = ff.sizes[0].id;
  const cu = await one(db, 'select customer_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'Clinton Hwy Market', level: 1, opening: 50, terms: 'net7' })]);
  const nt = await one(db, 'select customer_put($1, $2::jsonb)', [cid, JSON.stringify({ name: 'No Terms Mart', level: 1 })]);
  assert.equal((await one(db, "select terms from customers where name = 'No Terms Mart'")), '', 'terms are optional');
  const i1 = await save(db, cid, { customer_id: cu.id, action: 'complete', lines: [{ size_id: z, ordered: 3, shipped: 3 }] });   // 90
  const i2 = await save(db, cid, { customer_id: cu.id, action: 'complete', lines: [{ size_id: z, ordered: 2, shipped: 2 }] });   // 60
  await db.query("update sales set invoice_date = current_date - 40 where id = $1", [i1.id]);
  assert.equal(Number((await cust(db, cid, cu.id)).owes), 200);
  let o = await open(db, cid, cu.id);
  assert.deepEqual(o.invoices.map((x) => [x.opening || false, x.number, Number(x.open)]), [[true, null, 50], [false, 1001, 90], [false, 1002, 60]]);
  assert.equal(Number(o.aging.d60), 90, 'invoice 1001 is 33 days past due');
  assert.equal(Number(o.past_due), 0 + 90 + (Number(o.aging.over) + Number(o.aging.d30)));

  // Cash $120: starting balance 50 + 70 of invoice 1001; nothing left over.
  await fails(db, 'select payment_save($1, $2::jsonb)', [cid, JSON.stringify({ customer_id: cu.id, method: 'cash', amount: 50, pay: [{ to: i1.id, amount: 60 }] })], /paying 60/);
  await fails(db, 'select payment_save($1, $2::jsonb)', [cid, JSON.stringify({ customer_id: cu.id, method: 'check', amount: 50, pay: [] })], /check number/);
  const p1 = await pay(db, cid, { customer_id: cu.id, method: 'cash', amount: 120, pay: [{ to: null, amount: 50 }, { to: i1.id, amount: 70 }] });
  assert.equal(p1.number, 1001); assert.equal(p1.status, 'posted'); assert.equal(p1.applied.length, 2);
  assert.equal(Number((await cust(db, cid, cu.id)).owes), 80);
  o = await open(db, cid, cu.id);
  assert.deepEqual(o.invoices.map((x) => [x.number, Number(x.open)]), [[1001, 20], [1002, 60]]);

  // Check $100 for invoice 1002 (60) → 40 left as store credit.
  const p2 = await pay(db, cid, { customer_id: cu.id, method: 'check', check_no: '4471', amount: 100, pay: [{ to: i2.id, amount: 60 }] });
  o = await open(db, cid, cu.id);
  assert.equal(Number(o.store_credit), 40); assert.deepEqual(o.invoices.map((x) => x.number), [1001]);
  assert.equal(Number((await cust(db, cid, cu.id)).owes), -20);

  // A credit memo + that store credit pay the rest of 1001 with no money.
  const cr = await save(db, cid, { kind: 'credit', customer_id: cu.id, action: 'complete', lines: [{ size_id: z, qty: 1, reason: 'damaged' }] }); // -30
  o = await open(db, cid, cu.id);
  assert.deepEqual(o.credits.map((x) => [x.kind, Number(x.left)]).sort(), [['credit', 30], ['payment', 40]]);
  const p3 = await pay(db, cid, { customer_id: cu.id, method: 'other', amount: 0, use: [{ kind: 'credit', id: cr.id, amount: 20 }], pay: [{ to: i1.id, amount: 20 }] });
  o = await open(db, cid, cu.id);
  assert.equal(o.invoices.length, 0); assert.equal(Number(o.store_credit), 50);
  assert.equal(Number((await cust(db, cid, cu.id)).owes), -50, 'using credit doesn’t change what they owe');

  // Post-dated check: held, not counted, can't be deposited early.
  const i3 = await save(db, cid, { customer_id: cu.id, action: 'complete', lines: [{ size_id: z, ordered: 5, shipped: 5 }] }); // 150
  const pd = await pay(db, cid, { customer_id: cu.id, method: 'check', check_no: '901', check_date: '2099-01-01', amount: 100, pay: [{ to: i3.id, amount: 100 }] });
  assert.equal(pd.status, 'held');
  assert.equal(Number((await cust(db, cid, cu.id)).owes), 100);
  o = await open(db, cid, cu.id); assert.equal(Number(o.held), 100); assert.equal(Number(o.invoices[0].open), 150);
  await fails(db, 'select payment_deposit($1, $2)', [cid, pd.id], /deposit it on or after/);
  await db.query("update payments set check_date = current_date where id = $1", [pd.id]);
  const dep = await one(db, 'select payment_deposit($1, $2)', [cid, pd.id]);
  assert.equal(dep.status, 'posted'); assert.equal(Number((await cust(db, cid, cu.id)).owes), 0);

  // The check came back: void it, the invoice is owed again; staff can't void.
  const v = await one(db, 'select payment_void($1, $2, $3)', [cid, p2.id, 'Check came back']);
  assert.equal(v.status, 'void');
  assert.equal(Number((await cust(db, cid, cu.id)).owes), 100);
  o = await open(db, cid, cu.id);
  assert.ok(o.invoices.some((x) => x.number === 1002 && Number(x.open) === 60), '1002 owed again');
  await fails(db, 'select payment_void($1, $2, $3)', [cid, p2.id, 'again'], /already void/);

  // Payments list and the customer's tab.
  const L = await one(db, 'select payments_list($1, current_date - 1, current_date)', [cid]);
  assert.equal(L.rows.length, 4);
  const ac = await one(db, 'select customer_account($1, $2, current_date - 60, current_date)', [cid, cu.id]);
  assert.equal(ac.payments.length, 4); assert.equal(Number(ac.before), 50);
  const log = await db.query("select what from change_log where company_id = $1", [cid]);
  assert.ok(log.rows.some((r) => r.what === 'payment voided') && log.rows.some((r) => r.what === 'post-dated check deposited'));
});

test('a statement: start, every line with a running balance, voids left out, aging, open invoices; PDF and email', async () => {
  const { stmtModel, stmtHtml, stmtPdf, stmtName, stmtEmailText } = await import('../src/statement.js');
  const { buildStatementMail } = await import('../api/send.js');
  const acct = { before: 50, opening: 50,
    rows: [{ kind: 'invoice', status: 'posted', number: 1001, date: '2026-11-03', total: 90 }, { kind: 'invoice', status: 'void', number: 1002, date: '2026-11-04', total: 40 },
      { kind: 'credit', status: 'posted', number: 1003, date: '2026-11-05', total: -30 }],
    payments: [{ kind: 'payment', status: 'posted', number: 1001, date: '2026-11-06', total: -60, method: 'check', check_no: '4471' }, { kind: 'payment', status: 'held', number: 1002, date: '2026-11-07', total: -10, method: 'check' }],
    open: { invoices: [{ id: 'a', number: 1001, date: '2026-11-03', due: '2026-11-10', total: 90, open: 50, late: 17 }], aging: { current: 0, d30: 50, d60: 0, d90: 0, over: 0 }, past_due: 50, store_credit: 0 } };
  const co = { name: 'Knox Wholesale', phone: '865-555-0100', settings: {} }, cust = { name: 'Clinton Hwy Market', store_no: '211', terms: 'net7', email: 'store@example.com' };
  const M = stmtModel({ co, cust, acct, from: '2026-11-01', to: '2026-11-30', today: '2026-11-27' });
  assert.deepEqual(M.lines.map((l) => [l.what, l.bal]), [['Invoice', 140], ['Credit memo', 110], ['Payment · Check #4471', 50]]);
  assert.equal(M.end, 50); assert.equal(M.lines[0].due, '2026-11-10');
  const h = stmtHtml(M);
  assert.match(h, /STATEMENT/); assert.match(h, /You owed at the start/); assert.match(h, /Still open/); assert.match(h, /\$50\.00 is past due/); assert.ok(!/1002/.test(h), 'void and post-dated left out');
  assert.ok(stmtPdf(M).bytes.length > 800);
  assert.equal(stmtName(M), 'Statement-Clinton-Hwy-Market-2026-11-30.pdf');
  assert.match(stmtEmailText(M, co).subject, /Statement Nov 1, 2026 – Nov 30, 2026 · You owe \$50\.00/);
  const m = buildStatementMail(co, cust, acct, '2026-11-01', '2026-11-30');
  assert.equal(m.to, 'store@example.com'); assert.equal(m.mail.attachments[0].contentType, 'application/pdf');
  assert.match(buildStatementMail(co, { name: 'X' }, acct, '2026-11-01', '2026-11-30').err, /no email/);
  // No terms: nothing about terms on the statement, the due date is the invoice date.
  const N = stmtModel({ co, cust: Object.assign({}, cust, { terms: '' }), acct, from: '2026-11-01', to: '2026-11-30', today: '2026-11-27' });
  assert.equal(N.terms, ''); assert.equal(N.lines[0].due, '2026-11-03');
  assert.ok(!/Terms/.test(stmtHtml(N))); assert.ok(!/Terms/.test(stmtEmailText(N, co).text)); assert.ok(stmtPdf(N).bytes.length > 800);
});

test('a payment receipt: what it paid, store credit, what they owe now; PDF and email; statement note and copy', async () => {
  const { receiptModel, receiptHtml, receiptPdf, receiptName, receiptEmailText } = await import('../src/receipt.js');
  const { buildReceiptMail, buildStatementMail } = await import('../api/send.js');
  const co = { name: 'Knox Wholesale', phone: '865-555-0100', email: 'office@knox.example', settings: {} };
  const pay = { number: 1007, status: 'posted', method: 'check', check_no: '4471', amount: 200, received: '2026-11-27', by_name: 'Sam', note: '',
    applied: [{ to: 's1', number: 1043, amount: 150 }, { to: null, number: null, amount: 30 }, { to: 's2', number: 1044, amount: 20, from_sale: 'c1' }] };
  const cust = { name: 'Clinton Hwy Market', store_no: '211', email: 'store@example.com', owes: 412.5 };
  const M = receiptModel({ co, pay, cust });
  assert.deepEqual(M.pays.map((x) => [x.what, x.amount]), [['Invoice #1043', 150], ['Starting balance', 30]]);
  assert.deepEqual(M.credits, [{ what: 'Kept as store credit', amount: 20 }], 'the credit memo line is not this payment');
  assert.equal(M.how, 'Check #4471');
  const h = receiptHtml(M);
  assert.match(h, /PAYMENT RECEIPT[\s\S]*#1007/); assert.match(h, /Pays Invoice #1043/); assert.match(h, /You owe now[\s\S]*\$412\.50/); assert.match(h, /Taken by Sam/);
  assert.ok(receiptPdf(M).bytes.length > 800);
  assert.equal(receiptName(M), 'Receipt-1007-Clinton-Hwy-Market.pdf');
  assert.match(receiptEmailText(M, co).subject, /Payment receipt #1007 · \$200\.00/);
  const m = buildReceiptMail({ company: co, pay, customer: cust });
  assert.equal(m.to, 'store@example.com'); assert.equal(m.mail.replyTo, 'office@knox.example');
  assert.match(buildReceiptMail({ company: co, pay, customer: { name: 'X' } }).err, /no email/);
  // Statements sent many at once: the note and the copy to the company.
  const acct = { before: 10, rows: [], payments: [], open: { invoices: [], aging: {}, past_due: 0, store_credit: 0 } };
  const s = buildStatementMail(co, cust, acct, '2026-10-01', '2026-10-31', 'Please pay by the 15th', 'office@knox.example');
  assert.equal(s.mail.bcc, 'office@knox.example');
  const { stmtModel, stmtHtml } = await import('../src/statement.js');
  assert.match(stmtHtml(stmtModel({ co, cust, acct, from: '2026-10-01', to: '2026-10-31', note: 'Please pay by the 15th' })), /Please pay by the 15th/);
});
