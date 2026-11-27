// Phase 2, piece 3 on the pretend database: after Complete sale pick Print / Email the invoice / Email the EDI file,
// the Invoices panel (send again, downloads, what went out), Settings → Invoices, the customer's EDI details.
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
const key = (s, k) => { const el = typeof s === 'string' ? $(s) : s; el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k })); };
const tickBox = (s, v) => { const el = $(s); el.checked = v; el.dispatchEvent(new dom.window.Event('change')); };
const GUIDE = /^[a-z]+(-[a-z0-9]+)+$/;
function checkTags(name) {
  const bad = $$('#app button, #app input, #app select, #app summary, #app textarea').filter((el) => !GUIDE.test(el.getAttribute('data-guide') || '')).map((el) => el.outerHTML.slice(0, 90));
  assert.deepEqual(bad, [], 'controls without a data-guide tag on ' + name);
}

test('After a sale: print, email the invoice and the EDI file; then the Invoices panel', async () => {
  const db = makeFake({ signedIn: 'owner@example.com' });
  const c = await db.createCompany({ name: 'Knox Wholesale', home: 'TN', your_name: 'Sam', email: 'office@knox.example' });
  await db.itemPut(c.id, { name: 'Seneca FF', item_no: '4471', category: 'cigarettes', sizes: [{ name: 'Carton', n: 10, upc: '014700319017', prices: { 1: 34.5 } }, { name: 'Pack', n: 1, upc: '01470031900', prices: { 1: 3.6 } }] });
  await db.customerPut(c.id, { name: 'Maynardville Fuel Stop', store_no: '211', email: 'mv@example.com', level: 1, tobacco: false });
  const A = startApp(document.getElementById('app'), db);
  await tick();

  // The customer's Details: EDI email, customer # and what the store normally gets.
  $('[data-go="customers"]').click(); await tick();
  $('[data-cuopen]').click(); await tick();
  $('[data-cutab="details"]').click(); await tick(); checkTags('customer details');
  type('[data-cuk="acct_no"]', '211'); type('[data-cuk="edi_email"]', 'edi@example.com');
  const g = $('[data-cugets="edi"]'); g.value = 'true'; g.dispatchEvent(new dom.window.Event('change'));
  $('#cu-save').click(); await tick();
  const cu = db.S.customers[0];
  assert.equal(cu.edi_email, 'edi@example.com'); assert.equal(cu.acct_no, '211'); assert.deepEqual(cu.gets, { edi: true });

  // Sell, complete → the send choices, started from Settings (print) and the store's own choice (EDI).
  $('[data-go="counter"]').click(); await tick();
  $('#ct-new').click(); await tick(); type('#ct-cq', 'mayn'); key('#ct-cq', 'Enter'); await tick();
  type('#ct-scan', '014700319017'); key('#ct-scan', 'Enter'); await tick();
  type('[data-cto="0"]', '3'); key('[data-cto="0"]', 'Enter'); await tick();
  $('#ct-complete').click(); await tick(); type('#ct-licwhy2', 'Copy coming'); $('#ct-post').click(); await tick(10);
  assert.match($('#app').textContent, /Invoice 1001 posted/);
  checkTags('send choices');
  assert.ok($('[data-ivk="print"]').checked); assert.ok(!$('[data-ivk="email"]').checked); assert.ok($('[data-ivk="edi"]').checked);
  assert.match($('#app').textContent, /PDF to mv@example\.com/);
  assert.match($('#app').textContent, /To edi@example\.com · LOC 000211/);
  tickBox('[data-ivk="email"]', true); tickBox('[data-ivk="print"]', false);
  assert.equal($('#ct-next').textContent, 'Send and start next sale');
  $('#ct-next').click(); await tick(10);
  assert.deepEqual((db.S.mail || []).map((m) => m.kind + ' ' + m.to), ['email mv@example.com', 'edi edi@example.com']);
  assert.match($('.toast').textContent, /invoice emailed to mv@example\.com, EDI file emailed to edi@example\.com/);
  assert.ok($('#ct-cq'), 'the next sale started');

  // Invoices → the panel: what went out, send again.
  $('[data-go="invoices"]').click(); await tick(); $('[data-ivrow]').click(); await tick(10);
  checkTags('invoice panel');
  assert.match($('.ivpan').textContent, /Invoice emailed · mv@example\.com/);
  assert.equal($('#ivd-go').textContent, 'Send again'); assert.ok($('#ivd-go').disabled, 'nothing ticked yet');
  tickBox('[data-ivk="email"]', true); assert.ok(!$('#ivd-go').disabled);
  $('#ivd-go').click(); await tick(10);
  assert.equal(db.S.mail.length, 3);
  assert.ok($('#ivd-pdf') && $('#ivd-edi') && $('#ivd-csv'));

  // Settings → Invoices: license numbers, copies; the bar shows only when something changed.
  $('[data-go="settings"]').click(); await tick(); $('[data-stab="invoices"]').click(); await tick(); checkTags('settings invoices');
  assert.ok($('#is-bar').classList.contains('hide'));
  const box = $('[data-isv="lic"]'); type(box, 'TN Tobacco Distributor #12345');
  assert.equal($('[data-isv="lic"]'), box, 'typing never redraws'); assert.ok(!$('#is-bar').classList.contains('hide'));
  const cp = $('[data-isv="copies"]'); cp.value = '2'; cp.dispatchEvent(new dom.window.Event('change'));
  $('#is-save').click(); await tick();
  assert.equal(db.S.companies[0].settings.inv.lic, 'TN Tobacco Distributor #12345'); assert.equal(db.S.companies[0].settings.inv.copies, 2);
  void A;
});
