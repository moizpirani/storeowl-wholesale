// Phase 2, piece 1 on the pretend database: New sale → private customer search → scan → quantity → Enter → scan,
// unknown barcodes, name search, Suspend · Send for review · Complete sale, Review, Invoices, Barcodes to add.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'https://wholesale.storeowl.app/' });
global.window = dom.window; global.document = dom.window.document; global.localStorage = dom.window.localStorage;
dom.window.confirm = () => true;

const { startApp } = await import('../src/app.js');
const { makeFake } = await import('../src/db.js');

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

test('Counter: find, scan, quantity, suspend, review, complete', async () => {
  const db = makeFake({ signedIn: 'owner@example.com' });
  const c = await db.createCompany({ name: 'Knox', home: 'TN', your_name: 'Sam' });
  const brk = [{ min: 5, off: 0.6 }];
  const ff = await db.itemPut(c.id, { name: 'Seneca FF', category: 'cigarettes', break_group: 'Seneca', sizes: [{ name: 'Carton', n: 10, upc: '014700319017', prices: { 1: 34.5, 2: 34.2 }, breaks: brk }, { name: 'Case', n: 60, prices: { 1: 200, 2: 198 } }] });
  await db.itemPut(c.id, { name: 'Seneca Menthol', category: 'cigarettes', break_group: 'Seneca', sizes: [{ name: 'Carton', n: 10, upc: '014700319024', prices: { 1: 34.5, 2: 34.2 }, breaks: brk }] });
  await db.itemPut(c.id, { name: 'Grabba Leaf Small', category: 'otp', sizes: [{ name: 'Box', n: 25, prices: { 1: 38.99, 2: 38.99 } }] });
  const cu = await db.customerPut(c.id, { name: 'Maynardville Fuel Stop', store_no: '211', city: 'Maynardville', level: 2, opening: 50 });
  await db.customerPut(c.id, { name: 'Powell Quick Stop', store_no: '307', city: 'Powell', level: 1 });
  const A = startApp(document.getElementById('app'), db);
  await tick();

  $('[data-go="counter"]').click(); await tick();
  checkTags('counter home');
  assert.ok(!/Maynardville/.test($('#app').textContent), 'no customers on the main screen');
  $('#ct-new').click(); await tick();
  assert.ok(!/Maynardville/.test($('#app').textContent), 'nothing shows until you type');
  const cq = $('#ct-cq'); type(cq, 'mayn');
  assert.equal($('#ct-cq'), cq, 'typing never redraws');
  assert.match($('#ct-cres').textContent, /Maynardville Fuel Stop.*Store #211 · Maynardville/);
  key(cq, 'Enter'); await tick();
  checkTags('sale');
  assert.match($('.ctcust').textContent, /•••/); assert.ok(!/\$50\.00/.test($('.ctcust').textContent), 'owes hidden');
  $('[data-ctshow="owes"]').click(); assert.match($('#ct-v-owes').textContent, /\$50\.00/);

  // Scan → the quantity box is ready → type 4, Enter → back to scanning.
  const scan = () => $('#ct-scan');
  type(scan(), '014700319017'); key(scan(), 'Enter'); await tick();
  assert.equal(document.activeElement, $('[data-cto="0"]'));
  type($('[data-cto="0"]'), '4'); key($('[data-cto="0"]'), 'Enter'); await tick();
  assert.equal(document.activeElement, scan());
  // A barcode written another way (no leading zero) still matches; together they make the 5+ break.
  type(scan(), '14700319024'); key(scan(), 'Enter'); await tick();
  assert.equal($('#ct-total').textContent, '$168.00');
  assert.match($('#ct-nt-0').textContent, /Quantity break/);
  // Same item scanned again adds 1.
  type(scan(), '014700319024'); key(scan(), 'Enter'); await tick();
  assert.equal(A.ct.sale.lines[1].ordered, 2);
  // Ship less than ordered → "short".
  const sh = $('[data-cts="1"]'); type(sh, '1'); assert.match($('#ct-nt-1').textContent, /1 short/); assert.equal($('[data-cts="1"]'), sh);

  // Unknown barcode → sent to the back office; pick the item by name to keep selling.
  type(scan(), '0 70221 00512 6'); key(scan(), 'Enter'); await tick();
  assert.match($('.ctunk').textContent, /No item has barcode/);
  assert.equal(db.S.upcs[0].upc, '070221005126'); assert.equal(db.S.upcs[0].times, 1);
  const sc = scan(); type(sc, 'grab'); assert.equal(scan(), sc);
  assert.match($('#ct-sres').textContent, /Grabba Leaf Small/);
  key(sc, 'Enter'); await tick();
  assert.equal(A.ct.sale.lines.length, 3); assert.ok(db.S.upcs[0].sold_as);
  assert.ok(!$('.ctunk'));

  // Suspend → the list shows the customer; resume it.
  $('#ct-suspend').click(); await tick();
  assert.match($('.toast').textContent, /Suspended · Maynardville Fuel Stop/);
  assert.equal(A.ct.step, 'home');
  $('#ct-resume').click(); await tick(); checkTags('resume');
  assert.match($('#app').textContent, /Maynardville Fuel Stop[\s\S]*Due by closing/);
  $('[data-ctopen]').click(); await tick();
  assert.equal(A.ct.sale.lines.length, 3); assert.equal(A.ct.sale.lines[1].shipped, 1);

  // Complete → charge to account → invoice 1001; the screen clears.
  $('#ct-complete').click(); await tick(); checkTags('complete');
  type('#ct-licwhy2', 'Bringing it Monday'); $('#ct-post').click(); await tick(6);
  assert.match($('#app').textContent, /Invoice 1001 posted/);
  assert.ok(!/Maynardville/.test($('#app').textContent), 'the screen clears after a sale');
  assert.equal(db.S.sales[0].status, 'posted');
  assert.equal((await db.customer(c.id, cu.id)).owes, Math.round((50 + db.S.sales[0].total) * 100) / 100);

  // Next sale: Repeat last order, then send for review.
  $('#ct-next').click(); await tick();
  type('#ct-cq', '211'); key('#ct-cq', 'Enter'); await tick(6);
  assert.ok($('#ct-repeat'), 'repeat last order offered');
  $('#ct-repeat').click(); await tick();
  assert.equal(A.ct.sale.lines.length, 3);
  $('#ct-review').click(); await tick(); checkTags('send for review');
  $('#ct-rsend').click(); await tick();
  assert.match($('#ct-perr').textContent, /Pick what the manager should check/);
  $('[data-ctwhy="Price check"]').click(); $('#ct-rsend').click(); await tick(6);
  assert.match($('.toast').textContent, /Sent for review/);

  // Review page → open → complete; dated the day it was sent.
  $('[data-go="review"]').click(); await tick(6); checkTags('review');
  assert.match($('#app').textContent, /Price check/);
  $('[data-rvopen]').click(); await tick();
  assert.match($('#app').textContent, /Sent for review/);
  $('#ct-complete').click(); await tick(); type('#ct-licwhy2', 'Owner OK'); $('#ct-post').click(); await tick(6);
  assert.match($('#app').textContent, /Invoice 1002 posted/);

  // Invoices list.
  $('[data-go="invoices"]').click(); await tick(6); checkTags('invoices');
  assert.equal($$('[data-ivrow]').length, 2);
  type('#iv-q', '1001'); assert.equal($$('[data-ivrow]').length, 1);
  $('[data-ivrow]').click(); await tick(); checkTags('invoice panel');
  assert.match($('.ivpan').textContent, /Grabba Leaf Small/);

  // Items → Barcodes to add: add the barcode to what it was sold as.
  $('[data-go="items"]').click(); await tick(6);
  $('#it-bc').click(); await tick(6); checkTags('barcodes');
  assert.match($('#app').textContent, /0 70221 00512 6[\s\S]*Grabba Leaf Small/);
  $('[data-bcto]').click(); await tick(6);
  assert.match($('.toast').textContent, /Barcode added/);
  assert.equal(db.S.items.find((x) => x.name === 'Grabba Leaf Small').sizes[0].upc, '070221005126');
});

test('Counter: license warning per the owner’s choice', async () => {
  const db = makeFake({ signedIn: 'owner@example.com' });
  const c = await db.createCompany({ name: 'Knox', home: 'KY', your_name: 'Sam' });
  await db.itemPut(c.id, { name: 'Seneca FF', category: 'cigarettes', sizes: [{ name: 'Carton', n: 10, upc: '014700319017', prices: { 1: 34.5 } }] });
  await db.customerPut(c.id, { name: 'Corbin Market', level: 1 });
  const A = startApp(document.getElementById('app'), db);
  await tick();
  const ring = async () => {
    $('[data-go="counter"]').click(); await tick();
    $('#ct-new').click(); await tick(); type('#ct-cq', 'corbin'); key('#ct-cq', 'Enter'); await tick();
    type('#ct-scan', '014700319017'); key('#ct-scan', 'Enter'); await tick();
  };
  await ring();
  // KY needs resale + tobacco by default: warn, and ask why when completing.
  assert.match($('.ctlic').textContent, /No resale number · No tobacco license[\s\S]*You can still sell/);
  checkTags('license warning');
  $('#ct-complete').click(); await tick(); $('#ct-post').click(); await tick();
  assert.match($('#ct-perr').textContent, /Say why/);
  type('#ct-licwhy2', 'Copy coming Friday'); $('#ct-post').click(); await tick(6);
  assert.match($('#app').textContent, /Invoice 1001 posted/);
  assert.equal(db.S.sales[0].lic_reason, 'Copy coming Friday');
  assert.ok(db.S.log.some((l) => l.what === 'invoice posted' && l.detail.license_reason === 'Copy coming Friday'));

  // The owner turns the Counter warning off: nothing shows at the Counter, the customer page still shows it.
  $('[data-go="settings"]').click(); await tick(); $('[data-stab="licenses"]').click(); await tick();
  $('#lr-off').click(); await tick(); checkTags('license rules off');
  $('#lr-save').click(); await tick(6);
  assert.equal(db.S.companies[0].settings.lic_mode, 'off');
  await ring();
  assert.ok(!$('.ctlic')); assert.ok(!/Licenses/.test($('.ctcust').textContent));
  assert.equal(A.ct.sale.lines.length, 1);
});
