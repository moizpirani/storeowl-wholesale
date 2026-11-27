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
  // The receipt step (Settings say: ask each time).
  assert.match($('.rcpan h2').textContent, /Payment 1001 saved/); checkTags('receipt step');
  assert.equal($('#rc-go').textContent, 'Print and email');
  $('#rc-print').checked = false; $('#rc-print').dispatchEvent(new dom.window.Event('change'));
  assert.equal($('#rc-go').textContent, 'Email');
  $('#rc-go').click(); await tick(12);
  assert.ok(!$('.rcpan'), 'the receipt step closes');
  assert.equal(db.S.mail.find((m) => m.kind === 'receipt').to, 'orders@mfs.example');
  // Who owes me is the first tab.
  assert.ok($('[data-pmtab="owes"].on')); checkTags('who owes me');
  assert.match($('#ow-rows').textContent, /No stores here/, 'nobody owes anything now');
  $('[data-owf="credit"]').click(); await tick();
  assert.match($('#ow-rows').textContent, /Maynardville Fuel Stop[\s\S]*-\$20\.00[\s\S]*\$20\.00 credit/);
  $('[data-pmtab="list"]').click(); await tick(10);
  assert.match($('#pm-rows').textContent, /Maynardville Fuel Stop[\s\S]*Cash[\s\S]*Pays Starting balance, #1001 · \$20\.00 store credit[\s\S]*\$160\.00/);

  // Post-dated check: waits, then deposited.
  $('#pm-new').click(); await tick(); type('#pm-cq', 'mayn'); key('#pm-cq', 'Enter'); await tick(10);
  $('[data-pmm="check"]').click(); await tick();
  type('#pm-cno', '4471'); type('#pm-amt', '75');
  const cd = $('#pm-cdate'); cd.value = '2099-01-01'; cd.dispatchEvent(new dom.window.Event('change'));
  assert.match($('#pm-sum').textContent, /Post-dated check/);
  $('#pm-save').click(); await tick(10);
  assert.match($('.toast').textContent, /post-dated, waiting/);
  $('#rc-skip').click(); await tick();
  $('[data-pmtab="held"]').click(); await tick(); checkTags('post-dated');
  assert.match($('#app').textContent, /4471[\s\S]*Waits/);
  db.S.payments.find((p) => p.check_no === '4471').check_date = '2000-01-01';
  A.pm.data = null; A.pm.key = ''; A.pm.bank = null; $('[data-pmtab="held"]').click(); await tick(10);
  assert.match($('#app').textContent, /Ready to deposit/);
  $('[data-pmtab="bank"]').click(); await tick(10); checkTags('take to the bank');
  assert.match($('.kpis').textContent, /Not deposited yet\$235\.00/);
  assert.equal($$('[data-bkp]').length, 2, 'the cash and the check whose date has come');
  // Untick the cash: totals change in place, nothing redraws.
  const cash = $$('[data-bkp]').find((c) => /Cash/.test(c.closest('tr').textContent));
  cash.checked = false; cash.dispatchEvent(new dom.window.Event('change'));
  assert.equal($$('[data-bkp]')[0].isConnected, true);
  assert.match($('#bk-make').textContent, /Make deposit · \$75\.00/);
  cash.checked = true; cash.dispatchEvent(new dom.window.Event('change'));
  $('#bk-make').click(); await tick(12);
  assert.match($('.toast').textContent, /Deposit #1001 made · \$235\.00/);
  checkTags('deposits');
  assert.match($('.dppan').textContent, /#4471 Maynardville Fuel Stop[\s\S]*Deposit total\$235\.00/);
  type('#dp-ref', 'R-9'); pick('#dp-ref', 'R-9'); await tick(10);
  assert.equal(db.S.deposits[0].bank_ref, 'R-9');
  assert.equal(db.S.payments.find((p) => p.check_no === '4471').status, 'posted', 'putting it in a deposit counted it');

  // The check came back from the bank.
  $('[data-pmtab="list"]').click(); await tick(10);
  $$('[data-pmopen]').find((r) => /4471/.test(r.textContent)).click(); await tick();
  assert.match($('.ivpan').textContent, /Deposit #1001/);
  assert.ok(!$('#pm-void'), 'no plain void for a payment in a deposit');
  $('#pm-back').click(); await tick(); checkTags('check came back');
  $('#pm-vyes').click(); await tick(); assert.match($('#pm-verr').textContent, /Say why it came back/);
  type('#pm-vwhy', 'not enough money'); $('#pm-vyes').click(); await tick(10);
  assert.match($('.toast').textContent, /Check #4471 came back · \$75\.00 is owed again/);
  $('[data-pmtab="deps"]').click(); await tick(10);
  assert.match($('#app').textContent, /A check came back/);
  $('[data-dpopen]').click(); await tick();
  $('#dp-conf').click(); await tick(10);
  assert.equal(db.S.deposits[0].status, 'confirmed');

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
  $('#rc-skip').click(); await tick(10);
  const p = db.S.payments.find((x) => x.number === 1003);
  assert.equal(p.amount, 30); assert.ok(p.sale_id);
  assert.ok(db.S.applies.some((a) => a.from_pay === p.id && a.amount === 30));

  // Home reminds owners of cash and checks not deposited.
  $('[data-go="home"]').click(); await tick(10); checkTags('home with bank reminder');
  assert.match($('.hneed').textContent, /\$30\.00 in cash and checks not deposited/);
  $('[data-guide="home-needs-bank"]').click(); await tick(10);
  assert.ok($('[data-pmtab="bank"].on'), 'opens Take to the bank');
});

test('Who owes me, email statements, Settings → Statements & receipts, a store that wants no receipt', async () => {
  const db = makeFake({ signedIn: 'owner@example.com' });
  const c = await db.createCompany({ name: 'Knox', home: 'TN', your_name: 'Sam' });
  await db.companyPut(c.id, { email: 'office@knox.example' }).catch(() => {});
  const a = await db.customerPut(c.id, { name: 'Clinton Mart', level: 1, opening: 120, email: 'cm@x.example' });
  await db.customerPut(c.id, { name: 'Halls Quick Stop', level: 1, opening: 60 });
  await db.customerPut(c.id, { name: 'Zero Market', level: 1, opening: 0, email: 'z@x.example', gets: { receipt: 'none' } });
  const A = startApp(document.getElementById('app'), db);
  await tick();
  $('[data-go="payments"]').click(); await tick(10);
  assert.match($('.kpis').textContent, /Stores owe you\$180\.00/);
  assert.equal($$('#ow-rows tr.pmr').length, 2, 'only stores that owe something');
  assert.match($('#ow-rows').textContent, /Halls Quick Stop[\s\S]*No email/);
  const box = $('#ow-q'); type(box, 'halls'); assert.equal($('#ow-q'), box, 'typing never redraws');
  assert.equal($$('#ow-rows tr.pmr:not([hidden])').length, 1);
  type(box, '');
  $('#ow-csv').click(); assert.match(A.lastCsv, /Clinton Mart.*120/);
  $('#ow-mail').click(); await tick(10); checkTags('email statements');
  assert.match($('.swpan').textContent, /1 statement will go out[\s\S]*1 store has no email[\s\S]*Halls Quick Stop/);
  assert.ok($('#sw-print'));
  $('#sw-go').click(); await tick(12);
  assert.match($('.toast').textContent, /1 statement emailed · 1 with no email/);
  assert.equal(db.S.mail.filter((m) => m.kind === 'statement').length, 1);
  assert.match($('#ow-rows').textContent, /Clinton Mart[\s\S]*Emailed/);

  // Settings → Statements & receipts
  $('[data-go="settings"]').click(); await tick(); $('[data-stab="statements"]').click(); await tick(); checkTags('statements settings');
  assert.ok($('#st-bar').classList.contains('hide'));
  const au = $('[data-sts="auto"]'); au.checked = true; au.dispatchEvent(new dom.window.Event('change'));
  pick('[data-sts="day"]', '3'); pick('[data-sts="after"]', 'print');
  type('[data-sts="note"]', 'Please pay by the 15th');
  assert.ok(!$('#st-bar').classList.contains('hide'), 'Not saved yet shows');
  $('#st-save').click(); await tick(10);
  const s = db.S.companies[0].settings;
  assert.equal(s.stmt.auto, true); assert.equal(s.stmt.day, 3); assert.equal(s.stmt.note, 'Please pay by the 15th'); assert.equal(s.rcpt.after, 'print');
  assert.match($('#st-next').textContent, /Next:/);

  // A store set to no receipt: no receipt step, nothing printed or emailed.
  $('[data-go="payments"]').click(); await tick(10); $('#pm-new').click(); await tick();
  type('#pm-cq', 'zero'); key('#pm-cq', 'Enter'); await tick(10); type('#pm-amt', '10'); $('#pm-save').click(); await tick(12);
  assert.ok(!$('.rcpan')); assert.ok(!db.S.mail.some((m) => m.kind === 'receipt'));
  // Settings say print: printed by itself, written down on the payment.
  $('#pm-new').click(); await tick(); type('#pm-cq', 'clinton'); key('#pm-cq', 'Enter'); await tick(10); type('#pm-amt', '20'); $('#pm-save').click(); await tick(14);
  assert.ok(!$('.rcpan'));
  assert.match(document.getElementById('printout').textContent, /PAYMENT RECEIPT[\s\S]*Clinton Mart[\s\S]*You owe now\$100\.00/);
  assert.equal(db.S.payments.find((p) => p.amount === 20).sends[0].kind, 'print');
});
