// Phase 4 screens on the pretend database: "You sell it", extra barcodes, the Counter and a pack barcode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'https://wholesale.storeowl.app/' });
global.window = dom.window; global.document = dom.window.document; global.localStorage = dom.window.localStorage;
dom.window.confirm = () => true;

const { startApp } = await import('../src/app.js');
const { makeFake } = await import('../src/db.js');
const { itemIssues, scanSize, priceSale } = await import('../src/rules.js');

const tick = async (n) => { for (let i = 0; i < (n || 4); i++) await new Promise((r) => setTimeout(r, 0)); };
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const type = (s, v) => { const el = typeof s === 'string' ? $(s) : s; el.value = v; el.dispatchEvent(new dom.window.Event('input')); };
const key = (s, k) => { const el = typeof s === 'string' ? $(s) : s; el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k })); };
const GUIDE = /^[a-z]+(-[a-z0-9]+)+$/;
function checkTags(name) {
  const bad = $$('#app button, #app input, #app select, #app summary, #app textarea')
    .filter((el) => !GUIDE.test(el.getAttribute('data-guide') || '')).map((el) => el.outerHTML.slice(0, 90));
  assert.deepEqual(bad, [], 'controls without a data-guide tag on ' + name);
}

test('rules: a size you don’t sell needs no price, and its barcode means the carton', () => {
  const it = { id: 'i', name: 'Marlboro Red Box', sizes: [
    { id: 'c', name: 'Carton', n: 10, upc: '028200003843', upcs: ['028200003850'], cost: 71.1, prices: { 1: 79.9 } },
    { id: 'p', name: 'Pack', n: 1, upc: '028200003842', sells: false, prices: {} }] };
  assert.deepEqual(itemIssues(it, [{ n: 1 }]), []);
  const a = scanSize([it], '28200003842'); assert.equal(a.z.id, 'c'); assert.equal(a.pack, true);
  const b = scanSize([it], '028200003850'); assert.equal(b.z.id, 'c'); assert.equal(b.pack, false);
  const pr = priceSale([{ size_id: 'c', ordered: 1, shipped: 1 }], [it], 1);
  assert.deepEqual(pr.lines[0].sizes.map((z) => z.name), ['Carton'], 'the pack isn’t a size button');
  assert.equal(pr.lines[0].single_upc, '028200003842', 'the EDI file still gets the pack barcode');
});

test('Items: switch off "You sell it" and add a second barcode; Counter adds a carton for a pack scan', async () => {
  const db = makeFake({ signedIn: 'owner@example.com' });
  const c = await db.createCompany({ name: 'Knox', home: 'TN', your_name: 'Sam' });
  const it = await db.itemPut(c.id, { name: 'Marlboro Red Box', category: 'cigarettes', unit: 'pack', sizes: [
    { name: 'Carton', n: 10, upc: '028200003843', cost: 71.1, prices: { 1: 79.9, 2: 79.4, 3: 78.9 } },
    { name: 'Pack', n: 1, upc: '028200003842', cost: 7.11, prices: { 1: 8.3, 2: 8.25, 3: 8.2 } }] });
  await db.customerPut(c.id, { name: 'Clinton Hwy Market', store_no: '104', city: 'Knoxville', level: 1 });
  startApp(document.getElementById('app'), db);
  await tick();

  $('[data-go="items"]').click(); await tick();
  $$('tr[data-itrow]')[0].click(); await tick();
  checkTags('item panel');
  const sw = $$('[data-zsell]');
  assert.equal(sw.length, 2); assert.ok(sw[0].checked && sw[1].checked);
  sw[1].checked = false; sw[1].dispatchEvent(new dom.window.Event('change')); await tick();
  assert.match($('.znosell').textContent, /EDI file only/);
  $('[data-zuadd="0"]').click(); await tick();
  checkTags('item panel with an extra barcode');
  const extra = $('[data-zu="0|0"]'); type(extra, '028200003850');
  assert.equal($('[data-zu="0|0"]'), extra, 'typing never redraws');
  $('#it-save').click(); await tick(8);
  const saved = (await db.items(c.id))[0];
  assert.equal(saved.sizes[1].sells, false); assert.deepEqual(saved.sizes[0].upcs, ['028200003850']);

  // Counter: the pack barcode adds a carton and says so; the pack isn't a size button.
  $('[data-go="counter"]').click(); await tick();
  $('#ct-new').click(); await tick();
  type($('#ct-cq'), 'clinton'); key($('#ct-cq'), 'Enter'); await tick();
  type($('#ct-scan'), '028200003842'); key($('#ct-scan'), 'Enter'); await tick();
  assert.match($('#ct-nt-0').textContent, /pack barcode · 1 carton was added/);
  assert.ok(!$('[data-ctsz]'), 'no Carton | Pack buttons');
  // The extra barcode finds the carton too.
  key($('[data-cto="0"]'), 'Enter'); await tick();
  type($('#ct-scan'), '028200003850'); key($('#ct-scan'), 'Enter'); await tick();
  assert.equal($('[data-cto="0"]').value, '2');
  assert.equal(it.id, saved.id);
});
