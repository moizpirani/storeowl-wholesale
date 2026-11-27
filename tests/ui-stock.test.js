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

test('Stock → Type it in: supplier, scan, case of 10, totals must match, owner picks prices, Done; new item from a barcode', async () => {
  document.body.innerHTML = '<div id="app"></div>';
  const db = makeFake({ signedIn: 'owner@example.com' });
  const c = await db.createCompany({ name: 'Knox', home: 'TN', your_name: 'Moiz' });
  await db.itemPut(c.id, { name: 'Marlboro Red Box', category: 'cigarettes', unit: 'pack', sizes: [
    { name: 'Carton', n: 10, upc: '028200003843', cost: 101.08, prices: { 1: 106.5, 2: 105.9, 3: 105.4 } },
    { name: 'Pack', n: 1, upc: '028200003842', sells: false }] });
  await db.itemPut(c.id, { name: 'ZYN Cool Mint 6 mg', category: 'pouches', unit: 'can', sizes: [{ name: 'Roll', n: 5, upc: '897190000641', cost: 21.1, prices: { 1: 24.25 } }] });
  startApp(document.getElementById('app'), db);
  await tick();
  $('[data-go="stock"]').click(); await tick(8);
  checkTags('stock receive tab');
  assert.match($('#app').textContent, /Type it in/);
  $('[data-skway="type"]').click(); await tick();
  checkTags('type it in');
  assert.ok($('#rv-q').disabled, 'lines wait for the supplier');

  // A new supplier, typed.
  const sup = $('#rv-sup'); sup.dispatchEvent(new dom.window.Event('focus')); type(sup, 'Eastside Tobacco');
  assert.equal($('#rv-sup'), sup, 'typing never redraws');
  $('#rv-supnew').click(); await tick(6);
  assert.equal($('#rv-sup').value, 'Eastside Tobacco');
  type('#rv-num', '448355'); type('#rv-tot', '10,647.00');

  // Scan the pack barcode → a carton line, at its cost now; make it a case of 10 cartons.
  type('#rv-q', '028200003842'); key('#rv-q', 'Enter'); await tick();
  assert.equal(document.activeElement, $('[data-rvqty="0"]'));
  const u = $('[data-rvu="0"]'); u.value = 'case'; u.dispatchEvent(new dom.window.Event('change')); await tick();
  type('[data-rvcn="0"]', '10');
  type('[data-rvqty="0"]', '10'); type('[data-rvcost="0"]', '1021.80');
  assert.equal($('#rv-lt-0').textContent, '$10,218.00');
  assert.match($('#rv-ln-0').textContent, /▲ \$1\.10 a carton/);
  assert.match($('#rv-tmsg').textContent, /Off by \$429\.00/);
  assert.ok($('#rv-recv').disabled);
  // Name search.
  type('#rv-q', 'zyn mint'); assert.match($('#rv-res').textContent, /ZYN Cool Mint/);
  key('#rv-q', 'Enter'); await tick();
  type('[data-rvqty="1"]', '20'); type('[data-rvcost="1"]', '21.45');
  assert.match($('#rv-tmsg').textContent, /Totals match/);
  assert.equal($('#rv-recv').disabled, false);

  // An owner picks what happens to prices.
  $('#rv-recv').click(); await tick();
  checkTags('costs window');
  assert.match($('.rvwin').textContent, /Costs went up on 2 items/);
  assert.match($('#cw-rows').textContent, /\$106\.50 → \$107\.60/);
  $('#cw-ok').click(); await tick(10);
  checkTags('done');
  assert.match($('.rvdone').textContent, /Invoice 448355 is in stock/);
  assert.match($('.rvdone').textContent, /moved by the same amount/);
  const mb = (await db.items(c.id)).find((x) => x.name.startsWith('Marlboro')).sizes[0];
  assert.equal(mb.cost, 102.18); assert.equal(mb.prices[1], 107.6);

  // Stock tab: 100 cartons on the shelf.
  $('#dn-list').click(); await tick();
  $('[data-sktab="stock"]').click(); await tick(8);
  checkTags('stock tab');
  const row = $$('#sk-rows tr').find((tr) => /Marlboro/.test(tr.textContent));
  assert.match(row.textContent, /Carton\s*100\s*0\s*100/);

  // Next invoice: the supplier's case is remembered; an unknown barcode becomes a new item right there.
  $('[data-sktab="recv"]').click(); await tick();
  $('#sk-type').click(); await tick();
  const sb = $('#rv-sup'); sb.dispatchEvent(new dom.window.Event('focus')); type(sb, 'east'); key(sb, 'Enter'); await tick();
  type('#rv-q', '028200003843'); key('#rv-q', 'Enter'); await tick();
  assert.match($('[data-rvu="0"]').selectedOptions[0].textContent, /Case \(10 cartons\)/);
  assert.equal($('[data-rvcost="0"]').value, '1021.8');
  type('#rv-q', '071610017126'); key('#rv-q', 'Enter'); await tick();
  checkTags('new item panel');
  type('#un-name', 'Swisher Sweets Grape 2/99'); const cat = $('#un-cat'); cat.value = 'cigars'; cat.dispatchEvent(new dom.window.Event('change'));
  type('#un-size', 'Box'); type('#un-n', '60'); type('#un-their', '51120');
  $('#un-save').click(); await tick(8);
  assert.match($('.rvlines').textContent, /Swisher Sweets Grape 2\/99/);
  assert.match($('.rvlines').textContent, /their # 51120/);
  const sw = (await db.items(c.id)).find((x) => x.name.startsWith('Swisher'));
  assert.equal(sw.unit, 'cigarillo'); assert.equal(sw.sizes[0].upc, '071610017126');
  // Save for later → it waits on the Receive tab.
  $('#rv-later').click(); await tick(8);
  assert.match($('#app').textContent, /Waiting for you to check/);
});

test('Staff receive into stock but can’t change costs; the owner checks them later', async () => {
  document.body.innerHTML = '<div id="app"></div>';
  const db = makeFake({ signedIn: 'owner@example.com' });
  const c = await db.createCompany({ name: 'Knox', home: 'TN', your_name: 'Moiz' });
  await db.itemPut(c.id, { name: 'Marlboro Red Box', category: 'cigarettes', unit: 'pack', sizes: [{ name: 'Carton', n: 10, upc: '028200003843', cost: 101.08, prices: { 1: 106.5 } }] });
  const s = await db.supplierPut(c.id, { name: 'Eastside Tobacco' });
  await db.invite(c.id, 'staff@example.com', 'staff');
  await db.signOut(); await db.sendCode('staff@example.com'); await db.verifyCode('staff@example.com', '123456');
  await db.myCompanies();
  const it = (await db.items(c.id))[0];
  const r = await db.receivingSave(c.id, { supplier_id: s.id, number: '9', inv_total: 1021.8, lines: [{ size_id: it.sizes[0].id, unit: 'Case', per: 10, qty: 1, cost: 1021.8 }], action: 'receive', prices: 'same' });
  assert.equal(r.costs, 'waiting');
  await db.signOut(); await db.sendCode('owner@example.com'); await db.verifyCode('owner@example.com', '123456');
  startApp(document.getElementById('app'), db);
  await tick();
  $('[data-go="stock"]').click(); await tick(8);
  assert.match($('#app').textContent, /Costs to check/);
  $('[data-skcost]').click(); await tick();
  checkTags('owner costs window');
  const keep = $$('input[name="cw-mode"]').find((x) => x.value === 'margin'); keep.checked = true; keep.dispatchEvent(new dom.window.Event('change')); await tick();
  $('#cw-ok').click(); await tick(10);
  const z = (await db.items(c.id))[0].sizes[0];
  assert.equal(z.cost, 102.18); assert.equal(z.prices[1], Math.round(106.5 * 102.18 / 101.08 * 100) / 100);
});
