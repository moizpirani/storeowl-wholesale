// Phase 2, piece 4 on the pretend database: Return or credit → items back with a reason → credit without an item →
// Complete credit → owes goes down → Invoices shows Credit → void an invoice (managers, with a reason).
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

test('Counter: return or credit, then void an invoice', async () => {
  const db = makeFake({ signedIn: 'owner@example.com' });
  const c = await db.createCompany({ name: 'Knox', home: 'TN', your_name: 'Sam' });
  await db.itemPut(c.id, { name: 'Seneca FF', category: 'cigarettes', sizes: [{ name: 'Carton', n: 10, upc: '014700319017', prices: { 1: 34.5, 2: 34.2 } }] });
  await db.customerPut(c.id, { name: 'Maynardville Fuel Stop', store_no: '211', city: 'Maynardville', level: 2, opening: 0 });
  const A = startApp(document.getElementById('app'), db);
  await tick();

  // A sale first: 3 cartons at their price.
  $('[data-go="counter"]').click(); await tick();
  $('#ct-new').click(); await tick();
  type('#ct-cq', 'mayn'); key('#ct-cq', 'Enter'); await tick();
  type('#ct-scan', '014700319017'); key('#ct-scan', 'Enter'); await tick();
  type($('[data-cto="0"]'), '3'); key($('[data-cto="0"]'), 'Enter'); await tick();
  $('#ct-complete').click(); await tick(); $('#ct-post').click(); await tick(10);
  assert.match($('#app').textContent, /Invoice 1001 posted/);

  // Return or credit.
  $('[data-go="counter"]').click(); await tick();
  checkTags('counter home');
  $('#ct-credit').click(); await tick();
  type('#ct-cq', 'mayn'); key('#ct-cq', 'Enter'); await tick(10);
  checkTags('credit');
  type('#ct-scan', '014700319017'); key('#ct-scan', 'Enter'); await tick(10);
  assert.ok($('[data-ctcq="0"]'), 'a came-back box');
  type($('[data-ctcq="0"]'), '2'); await tick();
  assert.match($('#ct-pr-0').textContent, /What they last paid/);
  // No reason yet → can't complete.
  $('#ct-complete').click(); await tick();
  assert.ok(!$('#ct-post'), 'stopped without a reason');
  pick('[data-ctwy="0"]', 'damaged');
  $('#ct-other').click(); await tick();
  type('[data-ctod="1"]', 'Short on last delivery'); type('[data-ctoa="1"]', '10'); pick('[data-ctwy="1"]', 'other');
  await tick();
  assert.equal($('#ct-total').textContent, '-$78.40');
  $('#ct-complete').click(); await tick(); checkTags('complete credit');
  $('#ct-post').click(); await tick(10);
  assert.match($('#app').textContent, /Credit memo 1002 posted/);

  // Invoices: the credit is tagged; void the first invoice.
  $('[data-go="invoices"]').click(); await tick(10); checkTags('invoices');
  assert.match($('#app').textContent, /Credit/);
  const row1 = $$('[data-ivrow]').find((r) => /1001/.test(r.textContent)); row1.click(); await tick(10);
  $('#iv-void').click(); await tick(); checkTags('void ask');
  $('#iv-vyes').click(); await tick(6);
  assert.match($('#iv-verr').textContent, /reason|why/i);
  type('#iv-vwhy', 'Rang up the wrong store'); $('#iv-vyes').click(); await tick(10);
  assert.match($('.ivpan').textContent, /Void/);
  const s = db.S.sales.find((x) => x.number === 1001);
  assert.equal(s.status, 'void');
});
