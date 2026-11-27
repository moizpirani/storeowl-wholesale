// Phase 3, part 3: Who owes me, statements for many stores, monthly statements by themselves, receipts (PGlite).
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
const OWNER = '00000000-0000-4000-8000-000000000001', MGR = '00000000-0000-4000-8000-000000000002';
async function as(db, uid, email) { await db.query("select set_config('t.uid', $1, false), set_config('t.email', $2, false)", [uid || '', email || '']); }
async function one(db, sql, args) { const r = await db.query(sql, args || []); return Object.values(r.rows[0])[0]; }
async function fails(db, sql, args, re) { await assert.rejects(db.query(sql, args || []), re); }
const j = JSON.stringify;

test('who owes me, statements for many stores, the monthly run, receipts', async () => {
  const db = new PGlite(); await db.exec(AUTH); await db.exec(SQL); await db.exec(SQL);
  await as(db, OWNER, 'owner@example.com');
  const cid = (await one(db, 'select create_company($1::jsonb)', [j({ name: 'Knox', home: 'TN' })])).id;
  const ff = await one(db, 'select item_put($1, $2::jsonb)', [cid, j({ name: 'Seneca FF', category: 'cigarettes', sizes: [{ name: 'Carton', n: 10, prices: { 1: 30 } }] })]);
  const a = await one(db, 'select customer_put($1, $2::jsonb)', [cid, j({ name: 'Clinton Hwy Market', level: 1, opening: 50, terms: 'net7', email: 'a@x.com' })]);
  const b = await one(db, 'select customer_put($1, $2::jsonb)', [cid, j({ name: 'Halls Exxon', level: 1, gets: { print: true, receipt: 'both' } })]);
  await one(db, 'select customer_put($1, $2::jsonb)', [cid, j({ name: 'Zero Mart', level: 1 })]);
  assert.equal((await one(db, 'select customer_get($1, $2)', [cid, b.id])).gets.receipt, 'both');
  const s = await one(db, 'select sale_save($1, $2::jsonb)', [cid, j({ customer_id: b.id, action: 'complete', lines: [{ size_id: ff.sizes[0].id, ordered: 2, shipped: 2 }] })]);
  await db.query('update sales set invoice_date = current_date - 20 where id = $1', [s.id]);

  const L = await one(db, 'select owes_list($1)', [cid]);
  assert.deepEqual(L.map((x) => [x.name, Number(x.owes)]), [['Clinton Hwy Market', 50], ['Halls Exxon', 60], ['Zero Mart', 0]]);
  assert.equal(Number(L[1].aging.d30), 60, 'no terms: due on the invoice date, 20 days late');

  const p = await one(db, 'select payment_save($1, $2::jsonb)', [cid, j({ customer_id: a.id, method: 'check', check_no: '77', amount: 20, pay: [{ to: null, amount: 20 }] })]);
  const r = await one(db, 'select payment_receipt($1, $2)', [cid, p.id]);
  assert.equal(r.pay.number, p.number); assert.equal(Number(r.customer.owes), 30); assert.equal(r.company.name, 'Knox');
  const rs = await one(db, 'select receipt_sent($1, $2, $3::jsonb)', [cid, p.id, j({ kind: 'email', to: 'a@x.com', ok: true })]);
  assert.equal(rs.sends.length, 1);
  await one(db, 'select statement_sent($1, $2, $3::jsonb)', [cid, a.id, j({ to: 'a@x.com', ok: true })]);
  const L2 = await one(db, 'select owes_list($1)', [cid]);
  assert.equal(Number(L2[0].last_pay.amount), 20); assert.equal(L2[0].last_stmt.ok, true);

  const B = await one(db, "select stmt_batch($1, current_date - 30, current_date, 'owe')", [cid]);
  assert.deepEqual(B.rows.map((x) => x.cust.name), ['Clinton Hwy Market', 'Halls Exxon']);
  assert.equal(B.rows[1].acct.rows.length, 1);

  // Monthly statements: owners only; the run claims a company once a month.
  await fails(db, 'select company_settings_set($1, $2::jsonb)', [cid, j({ stmt: { auto: true, day: 4 } })], /1st, 2nd, 3rd or 5th/);
  await one(db, 'select company_settings_set($1, $2::jsonb)', [cid, j({ stmt: { auto: true, day: 1, who: 'owe', copy: true, note: 'Pay by the 15th' }, rcpt: { after: 'both' } })]);
  await db.query("insert into company_members(company_id, user_id, email, role) values ($1, $2, 'm@example.com', 'manager')", [cid, MGR]);
  await as(db, MGR, 'm@example.com');
  await fails(db, 'select company_settings_set($1, $2::jsonb)', [cid, j({ stmt: { auto: false } })], /only owners/);
  await as(db, '', '');
  const key = await one(db, "select key from job_keys where name = 'cron'");
  await fails(db, 'select stmt_auto_due($1)', ['wrong'], /not allowed/);
  const due = await one(db, 'select stmt_auto_due($1)', [key]);
  assert.equal(due.length, 1); assert.equal(due[0].note, 'Pay by the 15th'); assert.equal(due[0].copy, true);
  assert.equal((await one(db, 'select stmt_auto_due($1)', [key])).length, 0, 'once a month');
  await one(db, 'select stmt_auto_done($1, $2, $3::jsonb)', [key, cid, j({ from: due[0].from, to: due[0].to, sent: [{ customer: a.id, to: 'a@x.com', ok: true }, { customer: b.id, to: '', ok: false, err: 'no email' }] })]);
  const st = (await one(db, 'select settings from companies where id = $1', [cid])).stmt;
  assert.equal(st.lastrun.sent, 1); assert.equal(st.lastrun.noemail, 1); assert.equal(st.auto, true);
  assert.equal(Number(await one(db, "select count(*) from change_log where what = 'statement emailed' and detail->>'auto' = 'true'")), 1);
});
