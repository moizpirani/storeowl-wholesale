// Walks the Phase 0 screens on the pretend database: sign in, company setup, Home, every Settings tab.
// On every screen, every button / box / select must have a well-formed data-guide tag (for the future help chat).
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'https://wholesale.storeowl.app/' });
global.window = dom.window; global.document = dom.window.document; global.localStorage = dom.window.localStorage;
dom.window.confirm = () => true;

const { startApp } = await import('../src/app.js');
const { makeFake } = await import('../src/db.js');

const tick = () => new Promise((r) => setTimeout(r, 0));
const $ = (s) => document.querySelector(s);
const type = (s, v) => { const el = $(s); el.value = v; el.dispatchEvent(new dom.window.Event('input')); };
const pick = (s, v) => { const el = $(s); el.value = v; el.dispatchEvent(new dom.window.Event('change')); };
const GUIDE = /^[a-z]+(-[a-z0-9]+)+$/;
const seen = [];
function checkTags(name) {
  const bad = Array.from(document.querySelectorAll('#app button, #app input, #app select, #app summary, #app textarea'))
    .filter((el) => !GUIDE.test(el.getAttribute('data-guide') || ''))
    .map((el) => el.outerHTML.slice(0, 80));
  assert.deepEqual(bad, [], 'controls without a data-guide tag on ' + name);
  seen.push(name);
}

test('sign in → set up a company → Home → Settings', async () => {
  const db = makeFake();
  const A = startApp(document.getElementById('app'), db);
  await tick();
  assert.equal(A.phase, 'signin'); checkTags('sign in');

  type('#si-email', 'bad'); $('#si-send').click(); await tick();
  assert.match($('#app').textContent, /doesn’t look right/);
  type('#si-email', 'owner@example.com'); $('#si-send').click(); await tick(); await tick();
  assert.equal(A.si.step, 'code'); checkTags('code');

  // A pasted / auto-filled code spreads over the 6 boxes and signs in by itself.
  const first = $('#si-code input'); first.value = '123456'; first.dispatchEvent(new dom.window.Event('input'));
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(A.phase, 'setup'); checkTags('setup step 1');
  assert.equal($('#su-email').value, 'owner@example.com');

  $('#su-next').click(); await tick();
  assert.match($('#app').textContent, /Type your company name/);
  type('#su-name', 'Knox Wholesale'); type('#su-yname', 'Sam Lee'); pick('#su-state', 'TN');
  // Typing never redraws: the box is still the same element.
  const box = $('#su-name'); type('#su-name', 'Knox Wholesale LLC'); assert.equal($('#su-name'), box);
  $('#su-next').click(); await tick();
  assert.equal(A.su.step, 2); assert.equal($('#su-home').value, 'TN'); checkTags('setup step 2');
  assert.ok($('#su-done').disabled, 'must answer the other-states question first');

  $('#su-oyes').click(); await tick(); checkTags('setup other states');
  assert.ok($('[data-suadd="KY"]'), 'neighbours offered first');
  $('[data-suadd="KY"]').click(); await tick();
  pick('#su-more', 'TX'); await tick();
  assert.match($('#app').textContent, /Tennessee · also Kentucky and Texas/);
  $('[data-surm="TX"]').click(); await tick();
  $('#su-done').click(); for (let i = 0; i < 4; i++) await tick();

  assert.equal(A.phase, 'office'); assert.equal(A.view, 'home');
  await tick(); await tick();
  assert.match($('#app').textContent, /, Sam/);
  assert.match($('.topbar').textContent, /Knox Wholesale LLC/);
  assert.match($('.topbar').textContent, /Tennessee · also Kentucky/);
  checkTags('home');
  assert.equal(db.S.companies[0].home, 'TN');
  assert.deepEqual(db.S.companies[0].others, ['KY']);

  // Unbuilt pages say which phase brings them.
  $('[data-go="items"]').click(); await tick();
  assert.match($('#app').textContent, /Phase 1/); checkTags('items (not built)');

  // Settings → Company: the save bar shows only after a change.
  $('[data-go="settings"]').click(); await tick();
  assert.ok($('#savebar').classList.contains('hide'));
  type('[data-cok="phone"]', '865-555-0100');
  assert.ok(!$('#savebar').classList.contains('hide'));
  checkTags('settings company');
  $('#sv-save').click(); await tick(); await tick();
  assert.equal(db.S.companies[0].phone, '865-555-0100');
  assert.match($('.toast').textContent, /Company saved/);

  // States
  $('[data-stab="states"]').click(); await tick(); checkTags('settings states');
  $('[data-stadd="VA"]').click(); await tick();
  $('[data-strm="KY"]').click(); await tick();
  $('#sv-save').click(); await tick(); await tick();
  assert.deepEqual(db.S.companies[0].others, ['VA']);

  // People: invite a manager
  $('[data-stab="people"]').click(); await tick(); await tick(); checkTags('settings people');
  type('#pi-email', 'Mgr@Example.com'); pick('#pi-role', 'manager');
  $('#pi-go').click(); await tick(); await tick();
  assert.equal(db.S.invites[0].email, 'mgr@example.com');
  assert.match($('#app').textContent, /Invited/);

  // History lists what changed
  $('[data-stab="history"]').click(); await tick(); await tick(); checkTags('settings history');
  assert.match($('#app').textContent, /States: Tennessee · also Virginia/);
  assert.match($('#app').textContent, /Invited mgr@example\.com as Manager/);

  // The invited manager signs in and joins; managers can't change states or invite.
  $('#sign-out').click(); await tick();
  type('#si-email', 'mgr@example.com'); $('#si-send').click(); await tick(); await tick();
  const f2 = $('#si-code input'); f2.value = '123456'; f2.dispatchEvent(new dom.window.Event('input'));
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(A.phase, 'office');
  $('[data-go="settings"]').click(); await tick();
  $('[data-stab="states"]').click(); await tick();
  assert.ok($('#st-home').disabled); assert.match($('#app').textContent, /Only owners can change the states/);
  $('[data-stab="people"]').click(); await tick(); await tick();
  assert.equal($('#pi-email'), null);
  checkTags('settings people (manager)');
  assert.ok(seen.length >= 12);
});
