// Phase 3, part 1 on the pretend database: take a payment, oldest first, store credit, post-dated check, deposit, void, Paid now.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'https://wholesale.storeowl.app/' });
global.window = dom.window; global.document = dom.window.document; global.localStorage = dom.window.localStorage;
dom.window.confirm = () => true;

const { startApp } = await import('../src/app.js');
const { makeFake } = await import('../src/db.js');

const tick = async (n) => { for (let i = 0; i < (n || 6); i++) await new Promise((r) => setTimeout(r, 0)); };
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const type = (s, v) => { const el = typeof s === 'string' ? $(s) : s; el.value = v; el.dispatchEvent(new dom.window.Event('input')); };
const pick = (s, v) => { const el = typeof s === 'string' ? $(s) : s; el.value = v; el.dispatchEvent(new dom.window.Event('change')); };
const key = (s, k) => { const el = typeof s === 'string' ? $(s) : s; el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k })); };
const GUIDE = /^[a-z]+(-[a-z0-9]+)+$/;
function checkTags(name) {
  const bad = $$('#app button, #app input, #app select, #app summary, #app textarea')
    .filter((el) => !GUIDE.test(el.getAttribute('data-guide') || '')).map((el) => el.outerHTML.slice(0, 90));
  assert.deepEqual(bad, [], 'controls without a data-guide tag on ' + name);
}


test('Payments: take one, oldest first, store credit, post-dated, deposit, void, Paid now at the Counter', async () => {
  const db = makeFake({ signedIn: 'owner@example.com' });
  const c = await db.createCompany({ name: 'Knox', home: 'TN', your_name: 'Sam' });
  const it = await db.itemPut(c.id, { name: 'Seneca FF', category: 'cigarettes', sizes: [{ name: 'Carton', n: 10, upc: '014700319017', prices: { 1: 30 } }] });
  const cu = await db.customerPut(c.id, { name: 'Maynardville Fuel Stop', store_no: '211', city: 'Maynardville', level: 1, opening: 50, terms: 'net7', email: 'orders@mfs.example' });
  await db.saleSave(c.id, { customer_id: cu.id, action: 'complete', lines: [{ size_id: it.sizes[0].id, ordered: 3, shipped: 3 }] }); // 90
  const A = startApp(document.getElementById('app'), db);
  await tick();

  $('[data-go="payments"]').click(); await tick(10); checkTags('payments page');
  $('#pm-new').click(); await tick(); checkTags('take a payment');
  const cq = $('#pm-cq'); type(cq, 'mayn'); assert.equal($('#pm-cq'), cq, 'typing never redraws');
  key(cq, 'Enter'); await tick(10); checkTags('take a payment, customer picked');
  assert.match($('.pmpan').textContent, /Starting balance[\s\S]*Invoice 1001/);
  const amt = $('#pm-amt'); type(amt, '100'); assert.equal($('#pm-amt'), amt);
  assert.deepEqual($$('[data-pmto]').map((b) => b.value), ['50.00', '50.00'], 'oldest first');
  assert.match($('#pm-sum').textContent, /All of it pays invoices/);
  type(amt, '160'); assert.match($('#pm-sum').textContent, /\$20\.00 left over · kept as store credit/);
  $('#pm-save').click(); await tick(10);
  assert.match($('.toast').textContent, /Payment 1001 saved · \$160\.00/);
  assert.match($('#pm-rows').textContent, /Maynardville Fuel Stop[\s\S]*Cash[\s\S]*Pays Starting balance, #1001 · \$20\.00 store credit[\s\S]*\$160\.00/);

  // Post-dated check: waits, then deposited.
  $('#pm-new').click(); await tick(); type('#pm-cq', 'mayn'); key('#pm-cq', 'Enter'); await tick(10);
  $('[data-pmm="check"]').click(); await tick();
  type('#pm-cno', '4471'); type('#pm-amt', '75');
  const cd = $('#pm-cdate'); cd.value = '2099-01-01'; cd.dispatchEvent(new dom.window.Event('change'));
  assert.match($('#pm-sum').textContent, /Post-dated check/);
  $('#pm-save').click(); await tick(10);
  assert.match($('.toast').textContent, /post-dated, waiting/);
  $('[data-pmtab="held"]').click(); await tick(); checkTags('post-dated');
  assert.match($('#app').textContent, /4471[\s\S]*Waits/);
  db.S.payments.find((p) => p.check_no === '4471').check_date = '2000-01-01';
  A.pm.data = null; A.pm.key = ''; $('[data-pmtab="held"]').click(); await tick(10);
  $('[data-pmdep]').click(); await tick(10);
  assert.match($('.toast').textContent, /Check 4471 deposited/);
  $('[data-pmtab="deposit"]').click(); await tick(10); checkTags('deposit');
  assert.match($('#app').textContent, /To deposit\$235\.00/);

  // Void the check (it came back).
  $('[data-pmtab="list"]').click(); await tick(10);
  $$('[data-pmopen]').find((r) => /4471/.test(r.textContent)).click(); await tick();
  $('#pm-void').click(); await tick(); checkTags('void payment');
  $('#pm-vyes').click(); await tick(); assert.match($('#pm-verr').textContent, /Say why/);
  type('#pm-vwhy', 'Check came back'); $('#pm-vyes').click(); await tick(10);
  assert.match($('.toast').textContent, /Payment 1002 is void/);

  // The customer page: real Owes, payments in the tab.
  $('[data-go="customers"]').click(); await tick(10); $('[data-cuopen]').click(); await tick(10);
  assert.match($('.kpis').textContent, /Owes-\$20\.00/);
  $('[data-cutab="account"]').click(); await tick(10); checkTags('customer account with payments');
  assert.match($('#ac-rows').textContent, /Payment[\s\S]*Cash/);
  $('[data-ack="payment"]').click(); await tick();
  assert.equal($$('#ac-rows tr.acr:not([hidden])').length, 1, 'the voided check shows under Voids');
  $('#ac-smail').click(); await tick(10);
  assert.match($('.toast').textContent, /Statement emailed to orders@mfs\.example/);
  assert.equal(db.S.mail.find((m) => m.kind === 'statement').to, 'orders@mfs.example');

  // Paid now at the Counter.
  $('[data-go="counter"]').click(); await tick(); $('#ct-new').click(); await tick();
  type('#ct-cq', 'mayn'); key('#ct-cq', 'Enter'); await tick(10);
  type('#ct-scan', '014700319017'); key('#ct-scan', 'Enter'); await tick(10);
  key($('[data-cto="0"]'), 'Enter'); await tick();
  $('#ct-complete').click(); await tick(); $('[data-ctpay="now"]').click(); await tick(); checkTags('complete paid now');
  $('#ct-post').click(); await tick(12);
  assert.ok($('.pmpan'), 'the payment window opens for the new invoice');
  assert.match($('.pmpan h2').textContent, /invoice 1002/);
  assert.equal($('#pm-amt').value, '30.00');
  $('#pm-save').click(); await tick(10);
  const p = db.S.payments.find((x) => x.number === 1003);
  assert.equal(p.amount, 30); assert.ok(p.sale_id);
  assert.ok(db.S.applies.some((a) => a.from_pay === p.id && a.amount === 30));
});
