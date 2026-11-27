// Phase 3, part 2: bank deposits in the database (PGlite).
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
async function as(db, uid, email) { await db.query("select set_config('t.uid', $1, false), set_config('t.email', $2, false)", [uid || '', email || '']); }
async function one(db, sql, args) { const r = await db.query(sql, args || []); return Object.values(r.rows[0])[0]; }
async function fails(db, sql, args, re) { await assert.rejects(db.query(sql, args || []), re); }
const j = JSON.stringify;

test('deposits: what waits for the bank, make, post-dated checks, undo, confirm, a check that came back', async () => {
  const db = new PGlite(); await db.exec(AUTH); await db.exec(SQL); await db.exec(SQL);
  await as(db, OWNER, 'owner@example.com');
  const cid = (await one(db, 'select create_company($1::jsonb)', [j({ name: 'Knox', home: 'TN' })])).id;
  const cu = await one(db, 'select customer_put($1, $2::jsonb)', [cid, j({ name: 'Clinton Hwy Market', level: 1, opening: 500 })]);
  const pay = (p) => one(db, 'select payment_save($1, $2::jsonb)', [cid, j(Object.assign({ customer_id: cu.id }, p))]);
  const cash = await pay({ method: 'cash', amount: 100, pay: [{ to: null, amount: 100 }] });
  const chk = await pay({ method: 'check', check_no: '4471', amount: 150, pay: [{ to: null, amount: 150 }] });
  const card = await pay({ method: 'card', amount: 40 });
  const late = await pay({ method: 'check', check_no: '900', check_date: '2099-01-01', amount: 60 });
  let todo = await one(db, 'select bank_todo($1)', [cid]);
  assert.deepEqual(todo.map((p) => p.number), [cash.number, chk.number], 'card and a post-dated check not due yet stay out');
  await db.query("update payments set check_date = current_date where id = $1", [late.id]);
  todo = await one(db, 'select bank_todo($1)', [cid]);
  assert.equal(todo.length, 3, 'the post-dated check joins on its date');
  await fails(db, 'select deposit_make($1, $2::jsonb)', [cid, j({ ids: [card.id] })], /can't go in a deposit/);
  await fails(db, 'select deposit_make($1, $2::jsonb)', [cid, j({ ids: [] })], /tick what/);

  const d = await one(db, 'select deposit_make($1, $2::jsonb)', [cid, j({ ids: todo.map((p) => p.id) })]);
  assert.equal(d.number, 1001); assert.equal(Number(d.cash), 100); assert.equal(Number(d.checks), 210); assert.equal(Number(d.total), 310); assert.equal(d.n_checks, 2);
  assert.equal(d.payments.length, 3);
  assert.equal((await one(db, 'select status from payments where id = $1', [late.id])), 'posted', 'putting it in a deposit counts the post-dated check');
  assert.equal((await one(db, 'select bank_todo($1)', [cid])).length, 0);
  await fails(db, 'select deposit_make($1, $2::jsonb)', [cid, j({ ids: [cash.id] })], /can't go in a deposit/);
  await fails(db, 'select payment_void($1, $2, $3)', [cid, cash.id, 'oops'], /deposit #1001: undo the deposit first/);

  // Undo: everything waits again; the post-dated check goes back to waiting too.
  const u = await one(db, 'select deposit_set($1, $2, $3::jsonb)', [cid, d.id, j({ action: 'undo' })]);
  assert.equal(u.status, 'undone'); assert.equal(u.payments.length, 0);
  assert.equal((await one(db, 'select status from payments where id = $1', [late.id])), 'held');
  assert.equal((await one(db, 'select bank_todo($1)', [cid])).length, 3);

  // Make it again, note the bank receipt, a check comes back, confirm.
  const d2 = await one(db, 'select deposit_make($1, $2::jsonb)', [cid, j({ ids: [cash.id, chk.id] })]);
  assert.equal(d2.number, 1002);
  await one(db, 'select deposit_set($1, $2, $3::jsonb)', [cid, d2.id, j({ action: 'ref', bank_ref: 'R-55' })]);
  await fails(db, 'select payment_returned($1, $2, $3)', [cid, cash.id, 'x'], /only a check in a deposit/);
  await fails(db, 'select payment_returned($1, $2, $3)', [cid, chk.id, ''], /say why/);
  const r = await one(db, 'select payment_returned($1, $2, $3)', [cid, chk.id, 'not enough money']);
  assert.equal(r.status, 'void'); assert.equal(r.bounced, true); assert.match(r.void_why, /Check came back: not enough money/);
  assert.equal(r.deposit.number, 1002);
  assert.equal(Number((await one(db, 'select customer_get($1, $2)', [cid, cu.id])).owes), 500 - 100 - 40, 'the check that came back is owed again; the post-dated check is waiting again');
  await fails(db, 'select deposit_set($1, $2, $3::jsonb)', [cid, d2.id, j({ action: 'undo' })], /came back/);
  const c2 = await one(db, 'select deposit_set($1, $2, $3::jsonb)', [cid, d2.id, j({ action: 'confirm' })]);
  assert.equal(c2.status, 'confirmed'); assert.equal(c2.bank_ref, 'R-55'); assert.equal(Number(c2.came_back), 150);
  const L = await one(db, "select deposits_list($1, current_date - 1, current_date)", [cid]);
  assert.deepEqual(L.rows.map((x) => [x.number, x.status]), [[1002, 'confirmed'], [1001, 'undone']]);
  assert.equal(L.waiting.length, 0);
});
