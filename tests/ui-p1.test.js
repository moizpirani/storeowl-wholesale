// Phase 1 on the pretend database: price levels with private names, items with sizes, customers with licenses.
// The customer page never shows the price level until "Show" is tapped. Every control has a data-guide tag.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'https://wholesale.storeowl.app/' });
global.window = dom.window; global.document = dom.window.document; global.localStorage = dom.window.localStorage;
dom.window.confirm = () => true;

const { startApp } = await import('../src/app.js');
const { makeFake } = await import('../src/db.js');

const tick = async (n) => { for (let i = 0; i < (n || 3); i++) await new Promise((r) => setTimeout(r, 0)); };
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const type = (s, v) => { const el = typeof s === 'string' ? $(s) : s; el.value = v; el.dispatchEvent(new dom.window.Event('input')); };
const pick = (s, v) => { const el = typeof s === 'string' ? $(s) : s; el.value = v; el.dispatchEvent(new dom.window.Event('change')); };
const GUIDE = /^[a-z]+(-[a-z0-9]+)+$/;
function checkTags(name) {
  const bad = $$('#app button, #app input, #app select, #app summary, #app textarea')
    .filter((el) => !GUIDE.test(el.getAttribute('data-guide') || '')).map((el) => el.outerHTML.slice(0, 90));
  assert.deepEqual(bad, [], 'controls without a data-guide tag on ' + name);
}

test('price levels, items and customers', async () => {
  const db = makeFake({ signedIn: 'owner@example.com' });
  const c = await db.createCompany({ name: 'Knox Wholesale', home: 'TN', your_name: 'Sam' });
  const A = startApp(document.getElementById('app'), db);
  A.today = '2026-11-26';
  await tick();
  assert.equal(A.phase, 'office');

  // Settings → Price levels: private names.
  $('[data-go="settings"]').click(); await tick();
  $('[data-stab="levels"]').click(); await tick(); checkTags('settings levels');
  assert.ok($('#lv-bar').classList.contains('hide'));
  const names = $$('[data-lvn]');
  type(names[0], 'Route 1'); type(names[1], 'Route 2'); type(names[2], 'Cash');
  assert.ok(!$('#lv-bar').classList.contains('hide'));
  assert.equal($$('[data-lvn]')[0], names[0], 'typing never redraws');
  $('#lv-save').click(); await tick();
  assert.deepEqual(db.S.companies[0].levels.map((l) => l.name), ['Route 1', 'Route 2', 'Cash']);

  // Settings → License rules.
  $('[data-stab="licenses"]').click(); await tick(); checkTags('settings license rules');
  pick('#lr-days', '60'); $('#lr-save').click(); await tick();
  assert.equal(db.S.companies[0].settings.remind_days, 60);

  // Items: add one with two sizes; the margin updates while typing.
  $('[data-go="items"]').click(); await tick();
  assert.match($('#app').textContent, /No items yet/); checkTags('items empty');
  $('#it-add').click(); await tick(); checkTags('new item');
  type('[data-itk="name"]', 'Seneca Full Flavor Box');
  type('[data-zk="0|upc"]', '0 14700 31901 7'); type('[data-zk="0|cost"]', '28.90');
  const p1 = $('[data-zk="0|p1"]'); type(p1, '34.20');
  assert.equal($('[data-zk="0|p1"]'), p1, 'typing never redraws');
  assert.equal($('#ik-mg').textContent, '15.5%');
  type('[data-zk="0|p2"]', '33.90'); type('[data-zk="0|p3"]', '33.60');
  $('#it-zadd').click(); await tick();
  assert.equal($('[data-zk="1|name"]').value, 'Case'); assert.equal($('[data-zk="1|n"]').value, '500');
  type('[data-zk="1|upc"]', '10014700319014'); type('[data-zk="1|cost"]', '1445');
  ['1|p1', '1|p2', '1|p3'].forEach((k, i) => type('[data-zk="' + k + '"]', String(1701 - i * 15)));
  $('#it-save').click(); await tick();
  assert.equal(db.S.items.length, 1); assert.equal(db.S.items[0].sizes[0].upc, '014700319017');
  assert.match($('.toast').textContent, /Seneca Full Flavor Box saved/);
  checkTags('item panel');
  // A second item with the same UPC is refused in plain words.
  $('#it-add').click(); await tick();
  type('[data-itk="name"]', 'Copy'); type('[data-zk="0|upc"]', '014700319017');
  $('#it-save').click(); await tick();
  assert.match($('#it-err').textContent, /already on Seneca/);
  $('#it-close').click(); await tick();
  assert.match($('th:nth-child(5)').textContent, /Route 1/);
  // Search filters in place.
  type('#it-q', 'nothing like this'); assert.match($('#it-rows').textContent, /No items match/);
  type('#it-q', '31901'); assert.match($('#it-rows').textContent, /Seneca/);

  // Customers: add one; no resale # and no tobacco license both need you.
  $('[data-go="customers"]').click(); await tick(); checkTags('customers empty');
  $('#cu-add').click(); await tick(); checkTags('new customer');
  type('[data-cuk="name"]', 'Maynardville Fuel Stop'); type('[data-cuk="store_no"]', '211'); type('[data-cuk="city"]', 'Maynardville');
  pick('[data-cuk="level"]', '2'); pick('[data-cuk="terms"]', 'net14'); type('[data-cuk="credit_limit"]', '5000');
  type('[data-cck="0|name"]', 'Raj Patel'); type('[data-cck="0|phone"]', '(865) 992-4410');
  $('#cu-save').click(); await tick();
  const cu = db.S.customers[0];
  assert.equal(cu.level, 2); assert.equal(cu.credit_limit, 5000);
  assert.equal(A.cu.tab, 'overview'); checkTags('customer overview');
  const page = $('#app').textContent;
  assert.match(page, /No resale number|No tobacco license/);
  // The price level is hidden on the page until Show is tapped.
  assert.ok(!/Route 2/.test(page), 'price level must not show on the customer page');
  $('#cu-lvshow').click();
  assert.match($('#cu-lv').textContent, /Route 2/);

  // Licenses: add resale + a tobacco license that ends soon.
  $('[data-cutab="licenses"]').click(); await tick(); checkTags('customer licenses');
  const rows = $$('[data-lk$="|number"]');
  type(rows[0], '0108841203');
  type(rows[2], '46-3310389'); type('[data-lk="2|expires"]', '2026-12-08');
  $('#cl-save').click(); await tick();
  assert.equal(db.S.customers[0].licenses.length, 2);
  assert.match($('.chd').textContent, /Tobacco license ends Dec 8/);

  // An ended tobacco license stops tobacco.
  type($$('[data-lk="2|expires"]')[0], '2026-11-01');
  $('#cl-save').click(); await tick();
  assert.match($('.chd').textContent, /Tobacco license ended Nov 1 · tobacco stopped/);
  $('[data-cutab="prices"]').click(); await tick(); checkTags('customer prices');
  assert.match($('#cp-rows').textContent, /\$33\.90/);
  assert.match($('#cp-rows').textContent, /Can’t sell · tobacco stopped/);

  // Notes and history.
  $('[data-cutab="notes"]').click(); await tick(); checkTags('customer notes');
  type('#cn-text', 'Pays by check on Fridays'); $('#cn-add').click(); await tick();
  assert.match($('#app').textContent, /Pays by check on Fridays/);
  $('[data-cutab="history"]').click(); await tick(); checkTags('customer history');
  assert.match($('#app').textContent, /Tobacco license · 46-3310389/);

  // The list has no price level column, only a filter.
  $('#cu-back').click(); await tick(); checkTags('customers list');
  assert.ok(!$$('th').some((th) => /level/i.test(th.textContent)));
  assert.ok(!/Route 2/.test($('#cu-rows').textContent));
  pick('#cu-lvl', '1'); await tick();
  assert.match($('#cu-rows').textContent, /No customers match/);
  pick('#cu-lvl', '2'); await tick();
  assert.match($('#cu-rows').textContent, /Maynardville/);

  // A level with customers on it can't be taken off.
  $('[data-go="settings"]').click(); await tick();
  $('[data-stab="levels"]').click(); await tick();
  assert.ok($$('[data-lvrm]')[1].disabled);

  // Home counts them.
  $('[data-go="home"]').click(); await tick();
  assert.match($('.bxs').textContent, /Customers1/); assert.match($('.bxs').textContent, /Items1/);
  checkTags('home');
  void c;
});

test('staff see items without costs and can’t change customers', async () => {
  const db = makeFake({ signedIn: 'owner@example.com' });
  const c = await db.createCompany({ name: 'Knox', home: 'TN' });
  await db.itemPut(c.id, { name: 'ZYN Cool Mint', category: 'pouches', unit: 'can', sizes: [{ name: 'Roll', n: 5, upc: '897190000641', cost: 21.8, prices: { 1: 26.5 } }] });
  const cu = await db.customerPut(c.id, { name: 'Powell Quick Stop' });
  await db.invite(c.id, 'staff@example.com', 'staff');
  await db.signOut(); await db.verifyCode.call(db, 'staff@example.com', '123456').catch(() => {});
  await db.sendCode('staff@example.com'); await db.verifyCode('staff@example.com', '123456');
  document.getElementById('app').innerHTML = '';
  const A = startApp(document.getElementById('app'), db);
  await tick();
  $('[data-go="items"]').click(); await tick(4);
  assert.ok(!$$('th').some((th) => th.textContent === 'Cost'), 'no cost column for staff');
  assert.equal($('#it-add'), null);
  $('[data-itrow]').click(); await tick();
  assert.match($('.ph').textContent, /View only/);
  assert.ok($('[data-itk="name"]').disabled);
  checkTags('item (staff)');
  $('[data-go="customers"]').click(); await tick();
  assert.equal($('#cu-add'), null);
  $('[data-curow="' + cu.id + '"]').click(); await tick(4);
  assert.equal($('#cu-edit'), null);
  $('[data-cutab="notes"]').click(); await tick();
  type('#cn-text', 'Asked for a statement'); $('#cn-add').click(); await tick();
  assert.equal(db.S.notes.length, 1);
  void A;
});

test('bring in customers from a file, check the balances, take it back', async () => {
  const db = makeFake({ signedIn: 'owner@example.com' });
  await db.createCompany({ name: 'Knox', home: 'TN' });
  document.getElementById('app').innerHTML = '';
  const A = startApp(document.getElementById('app'), db);
  await tick();
  $('[data-go="customers"]').click(); await tick(4);
  $('#cu-import').click(); await tick(4);
  assert.equal(A.view, 'import'); checkTags('import pick');
  const csv = 'Customer,Store #,Terms,Level,Balance,Resale #,Tobacco License,Tobacco Exp\nClinton Hwy Market,104,Net 7,A,"1,284.40",0106,46-1,9/30/2027\nPowell Quick Stop,307,Net 7,B,300,0107,,\nBad One,1,whenever,,0,,,';
  const f = new dom.window.File([csv], 'customers.csv', { type: 'text/csv' });
  if (!f.text) f.text = async () => csv;
  const inp = $('#im-file'); Object.defineProperty(inp, 'files', { value: [f] }); inp.dispatchEvent(new dom.window.Event('change'));
  await tick(6);
  assert.equal(A.im.step, 'match'); assert.equal(A.im.kind, 'customers'); checkTags('import match');
  assert.equal($('[data-immap="4"]').value, 'balance');
  $('#im-check').click(); await tick(6);
  assert.equal(A.im.step, 'check'); checkTags('import check');
  assert.match($('#app').textContent, /StoreOwl doesn’t know the terms “whenever”/);
  assert.match($('#app').textContent, /\$1,584\.40/);
  const old = $('#im-old'); type(old, '1,584.40');
  assert.equal($('#im-old'), old, 'typing never redraws');
  assert.match($('#im-match').textContent, /match to the cent/);
  type(old, '1600'); assert.match($('#im-match').textContent, /Off by \$15\.60/);
  $('#im-go').click(); await tick(8);
  assert.equal(A.im.step, 'done'); checkTags('import done');
  assert.equal(db.S.customers.length, 2);
  assert.equal(db.S.customers.find((c) => c.name === 'Clinton Hwy Market').opening, 1284.4);
  assert.match($('#app').textContent, /Brought in 2 customers/);
  // Take it back (two taps).
  $('[data-imundo1]').click(); await tick();
  $('[data-imundo]').click(); await tick(4);
  assert.equal(db.S.customers.length, 0);
  assert.match($('.toast').textContent, /Took back 2 customers/);
});
