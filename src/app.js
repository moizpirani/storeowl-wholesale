// StoreOwl Wholesale: sign in, company setup (with the state picker), the side menu, Home and Settings (Phase 0);
// Items and Customers come from catalog.js (Phase 1).
// Same look as StoreOwl Back Office: navy side menu with icons, white top bar, grey page, white cards,
// one amber main button per screen (last on the right). Every control has a data-guide tag for the future help chat.
// Typing never redraws the page: boxes keep their value in state on input; the page redraws on Save / Next.

import { owlSvg } from './owl.js';
import { STATES, stateName, neighborsOf, cleanStates, statesLine } from './states.js';
import { makeCatalog } from './catalog.js';
import { makeImport } from './importui.js';
import { makeCounter } from './counter.js';
import { makePayments } from './payments.js';
import { custIssues, itemIssues, settingsOf, todayIso, licName, licProblems } from './rules.js';

const IC = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  counter: 'M3 9h18v11H3zM3 9l2-5h14l2 5M8 13h3M8 16h6',
  invoices: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  review: 'M6 3h12v18H6zM9 12l2 2 4-4M9 7h6',
  customers: 'M3 21V10l9-6 9 6v11M9 21v-6h6v6',
  items: 'M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10',
  payments: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM6 10v4M18 10v4',
  compliance: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM8.5 12l2.5 2.5 4.5-5',
  reports: 'M4 20V11M10 20V5M16 20v-6M2 20h20',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2'
};
function ic(k) { return '<svg class="ic" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + IC[k] + '"/></svg>'; }

// The side menu. `phase` = the build phase that brings a page (shown until it's built).
export const MENU = [
  { k: 'home', n: 'Home' },
  { k: 'counter', n: 'Counter' },
  { k: 'review', n: 'Review', mgr: true },
  { k: 'invoices', n: 'Invoices' },
  { k: 'customers', n: 'Customers' },
  { k: 'items', n: 'Items' },
  { k: 'payments', n: 'Payments' },
  { k: 'compliance', n: 'Compliance', phase: 7 },
  { k: 'reports', n: 'Reports', phase: 4 },
  { k: 'settings', n: 'Settings' }
];
const ROLE = { owner: 'Owner', manager: 'Manager', staff: 'Staff' };
const ROLE_LIST = ['owner', 'manager', 'staff'];

export function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function opt(v, label, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(label) + '</option>'; }
function stateOptions(sel, blank, skip) {
  return (blank ? opt('', blank, !sel) : '') + STATES.filter((s) => !(skip || []).includes(s[0])).map((s) => opt(s[0], s[1], s[0] === sel)).join('');
}
function when(iso) { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function greet() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }

export function startApp(root, db) {
  const A = {
    phase: 'loading',          // loading | signin | setup | office
    me: null, companies: [], cid: null,
    view: 'home', stab: 'company',
    si: { step: 'email', email: '', code: '', busy: false, msg: '' },
    su: { step: 1, f: { name: '', your_name: '', phone: '', email: '', addr: '', city: '', state: '', zip: '' }, home: '', other: null, others: [], busy: false, msg: '' },
    co: null,                  // Settings → Company form being edited
    st: null,                  // Settings → States being edited
    people: null, inv: { email: '', role: 'manager' },
    hist: null,
    msg: '', bad: false
  };
  const co = () => A.companies.find((c) => c.id === A.cid) || null;
  const isOwner = () => (co() || {}).role === 'owner';
  const isMgr = () => ['owner', 'manager'].includes((co() || {}).role);
  const cat = makeCatalog({ A, db, root, esc, opt, stateOptions, co, isMgr, isOwner, when,
    render: () => render(), say: (m, b) => say(m, b), replaceCo: (c) => replaceCo(c), startImport: (k) => imp.start(k, k),
    openInvoice: (id) => { A.view = 'invoices'; A.ivs = null; A.ivWant = id; render(); }, openPay: (o) => pay.open(o),
    openPayment: (id, d) => { A.view = 'payments'; pay.show(id, d); } });
  const loadAll = () => Promise.all([db.items(A.cid), db.customers(A.cid)]).then(([i, c]) => { A.items = i; A.custs = c; }).catch(() => { A.items = A.items || []; A.custs = A.custs || []; });
  const ctr = makeCounter({ A, db, root, esc, opt, co, isMgr, isOwner, when, render: () => render(), say: (m, b) => say(m, b), load: (f) => cat.load(f), openCust: (id, tab) => { A.view = 'customers'; cat.openCust(id, tab); }, replaceCo: (c) => replaceCo(c), openPay: (o) => pay.open(o) });
  const pay = makePayments({ A, db, root, esc, co, isMgr, isOwner, when, render: () => render(), say: (m, b) => say(m, b), reloadCust: (id) => cat.reloadCust(id),
    openCust: (id, tab) => { A.view = 'customers'; cat.openCust(id, tab); }, replaceCo: (c) => replaceCo(c) });
  const imp = makeImport({ A, db, root, esc, opt, co, isMgr, when, loadAll, render: () => render(), say: (m, b) => say(m, b), reload: () => cat.load(true) });

  async function boot() {
    try {
      A.me = await db.session();
      if (!A.me) { A.phase = 'signin'; return render(); }
      await loadCompanies();
    } catch (e) { A.phase = 'signin'; A.si.msg = e.message; render(); }
  }
  async function loadCompanies() {
    A.companies = await db.myCompanies();
    let keep = null; try { keep = localStorage.getItem('sow-company'); } catch (e) { /* private mode */ }
    A.cid = (A.companies.find((c) => c.id === keep) || A.companies[0] || {}).id || null;
    A.phase = A.cid ? 'office' : 'setup';
    if (A.phase === 'setup' && !A.su.f.email) A.su.f.email = A.me.email;
    render();
  }
  function pickCompany(id) { A.cid = id; try { localStorage.setItem('sow-company', id); } catch (e) { /* ok */ } A.co = A.st = A.people = A.hist = A.items = A.custs = A.it = A.cu = A.lv = A.lr = A.ct = A.rv = A.rvn = A.ivs = A.bc = A.bcp = A.stoday = A.pm = A.bankWait = null; render(); }
  function say(m, bad) { A.msg = m; A.bad = !!bad; }

  function render() {
    document.body.className = 'ph-' + A.phase;
    if (A.phase === 'loading') root.innerHTML = '<div class="center">' + owlSvg({ cls: 'owlbig' }) + '</div>';
    else if (A.phase === 'signin') { root.innerHTML = signinHtml(); bindSignin(); }
    else if (A.phase === 'setup') { root.innerHTML = setupHtml(); bindSetup(); }
    else { root.innerHTML = officeHtml(); bindOffice(); }
  }

  // ===== Sign in (email → 6-digit code) =====
  function signinHtml() {
    const S = A.si;
    const head = '<div class="authbrand">' + owlSvg({}) + '<div><b>StoreOwl</b><span>Wholesale</span></div></div>';
    let body;
    if (S.step === 'email') {
      body = '<h1>Sign in</h1>' +
        '<label class="fld"><span>Email</span><input id="si-email" type="email" autocomplete="email" inputmode="email" value="' + esc(S.email) + '" data-guide="signin-email-box"></label>' +
        (S.msg ? '<p class="msgline bad">' + esc(S.msg) + '</p>' : '') +
        '<div class="rowr"><button class="btn amber" id="si-send" data-guide="signin-send-code"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Sending…' : 'Send me a code') + '</button></div>';
    } else {
      body = '<h1>Check your email</h1><p class="sub">We sent a 6-digit code to <b>' + esc(S.email) + '</b></p>' +
        '<div class="code6" id="si-code">' + [0, 1, 2, 3, 4, 5].map((i) => '<input inputmode="numeric" maxlength="6" ' + (i === 0 ? 'autocomplete="one-time-code" ' : 'autocomplete="off" ') + 'data-i="' + i + '" value="' + esc(S.code[i] || '') + '" aria-label="Digit ' + (i + 1) + '" data-guide="signin-code-box">').join('') + '</div>' +
        (S.msg ? '<p class="msgline bad">' + esc(S.msg) + '</p>' : '') +
        '<div class="rowr"><button class="btn" id="si-back" data-guide="signin-use-other-email">Use another email</button><button class="btn" id="si-again" data-guide="signin-send-again">Send again</button>' +
        '<button class="btn amber" id="si-go" data-guide="signin-verify"' + (S.busy || S.code.length < 6 ? ' disabled' : '') + '>' + (S.busy ? 'Checking…' : 'Sign in') + '</button></div>';
    }
    return '<main class="auth"><div class="card authcard">' + head + body + '</div></main>';
  }
  function bindSignin() {
    const S = A.si;
    const em = root.querySelector('#si-email');
    if (em) {
      em.focus();
      em.oninput = () => { S.email = em.value.trim(); };
      em.onkeydown = (e) => { if (e.key === 'Enter') send(); };
      root.querySelector('#si-send').onclick = send;
    }
    const boxes = Array.from(root.querySelectorAll('#si-code input'));
    if (boxes.length) {
      const fill = (digits, from) => {
        const d = digits.replace(/\D/g, '').split('');
        for (let i = from; i < 6 && d.length; i++) boxes[i].value = d.shift();
        S.code = boxes.map((b) => b.value).join('').replace(/\D/g, '');
        const next = boxes.find((b) => !b.value);
        (next || boxes[5]).focus();
        root.querySelector('#si-go').disabled = S.busy || S.code.length < 6;
        if (S.code.length === 6) verify();
      };
      boxes.forEach((b, i) => {
        b.oninput = () => { const v = b.value; b.value = ''; fill(v, i); };
        b.onkeydown = (e) => {
          if (e.key === 'Backspace' && !b.value && i > 0) { boxes[i - 1].value = ''; boxes[i - 1].focus(); S.code = boxes.map((x) => x.value).join(''); e.preventDefault(); }
          if (e.key === 'Enter') verify();
        };
        b.onpaste = (e) => { e.preventDefault(); fill((e.clipboardData || window.clipboardData).getData('text'), 0); };
      });
      (boxes.find((b) => !b.value) || boxes[5]).focus();
      root.querySelector('#si-go').onclick = verify;
      root.querySelector('#si-back').onclick = () => { S.step = 'email'; S.code = ''; S.msg = ''; render(); };
      root.querySelector('#si-again').onclick = () => { S.code = ''; send(); };
    }
  }
  async function send() {
    const S = A.si;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(S.email)) { S.msg = 'That email doesn’t look right.'; return render(); }
    S.busy = true; S.msg = ''; render();
    try { await db.sendCode(S.email); S.step = 'code'; S.code = ''; } catch (e) { S.msg = e.message; }
    S.busy = false; render();
  }
  async function verify() {
    const S = A.si;
    if (S.busy || S.code.length < 6) return;
    S.busy = true; S.msg = ''; render();
    try { await db.verifyCode(S.email, S.code); A.me = await db.session(); S.busy = false; await loadCompanies(); }
    catch (e) { S.busy = false; S.code = ''; S.msg = e.message; render(); }
  }

  // ===== Company setup (first sign-in): 1 Your company · 2 Your states =====
  function setupHtml() {
    const U = A.su, f = U.f;
    const steps = '<div class="steps"><span class="' + (U.step === 1 ? 'on' : 'done') + '"><b>1</b>Your company</span><span class="' + (U.step === 2 ? 'on' : '') + '"><b>2</b>Your states</span></div>';
    let body;
    if (U.step === 1) {
      body = '<h1>Set up your company</h1>' +
        '<div class="grid2">' +
        fld('Company name', 'su-name', f.name, 'setup-company-name', 'organization') +
        fld('Your name', 'su-yname', f.your_name, 'setup-your-name', 'name') +
        fld('Phone', 'su-phone', f.phone, 'setup-company-phone', 'tel', 'tel') +
        fld('Email for invoices', 'su-email', f.email, 'setup-company-email', 'email', 'email') +
        '</div>' +
        fld('Street address', 'su-addr', f.addr, 'setup-company-address', 'street-address') +
        '<div class="grid3">' + fld('City', 'su-city', f.city, 'setup-company-city', 'address-level2') +
        '<label class="fld"><span>State</span><select id="su-state" data-guide="setup-company-state">' + stateOptions(f.state, ' ') + '</select></label>' +
        fld('ZIP', 'su-zip', f.zip, 'setup-company-zip', 'postal-code', 'text', 'numeric') + '</div>' +
        (U.msg ? '<p class="msgline bad">' + esc(U.msg) + '</p>' : '') +
        '<div class="rowr"><button class="btn" id="su-out" data-guide="setup-sign-out">Sign out</button><button class="btn amber" id="su-next" data-guide="setup-next">Next</button></div>';
    } else {
      const near = U.home ? neighborsOf(U.home).filter((s) => !U.others.includes(s)) : [];
      body = '<h1>Which state are you in?</h1>' +
        '<label class="fld"><span>Your state</span><select id="su-home" data-guide="setup-home-state">' + stateOptions(U.home, 'Pick your state') + '</select></label>' +
        (U.home ? '<h2>Do you also sell in other states?</h2>' +
          '<div class="seg"><button class="' + (U.other === false ? 'on' : '') + '" id="su-ono" data-guide="setup-other-states-no">No, only ' + esc(stateName(U.home)) + '</button>' +
          '<button class="' + (U.other === true ? 'on' : '') + '" id="su-oyes" data-guide="setup-other-states-yes">Yes</button></div>' : '') +
        (U.home && U.other ? '<div class="chips">' + U.others.map((s) => '<button class="chip on" data-surm="' + s + '" data-guide="setup-other-state-remove">' + esc(stateName(s)) + ' <span aria-hidden="true">×</span></button>').join('') +
          near.map((s) => '<button class="chip" data-suadd="' + s + '" data-guide="setup-other-state-add">+ ' + esc(stateName(s)) + '</button>').join('') + '</div>' +
          '<label class="fld narrow"><span>Another state</span><select id="su-more" data-guide="setup-other-state-pick">' + stateOptions('', 'Pick a state', [U.home].concat(U.others)) + '</select></label>' : '') +
        (U.home ? '<p class="line">' + esc(statesLine(U.home, U.other ? U.others : [])) + '</p>' : '') +
        (U.msg ? '<p class="msgline bad">' + esc(U.msg) + '</p>' : '') +
        '<div class="rowr"><button class="btn" id="su-back" data-guide="setup-back">Back</button><button class="btn amber" id="su-done" data-guide="setup-finish"' + (U.busy || !U.home || U.other === null ? ' disabled' : '') + '>' + (U.busy ? 'Saving…' : 'Finish setup') + '</button></div>';
    }
    return '<main class="auth"><div class="card authcard wide"><div class="authbrand">' + owlSvg({}) + '<div><b>StoreOwl</b><span>Wholesale</span></div></div>' + steps + body + '</div></main>';
  }
  function fld(label, id, val, guide, ac, type, im) {
    return '<label class="fld"><span>' + esc(label) + '</span><input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val) + '" data-guide="' + guide + '"' + (ac ? ' autocomplete="' + ac + '"' : '') + (im ? ' inputmode="' + im + '"' : '') + '></label>';
  }
  function bindSetup() {
    const U = A.su, f = U.f;
    const map = { 'su-name': 'name', 'su-yname': 'your_name', 'su-phone': 'phone', 'su-email': 'email', 'su-addr': 'addr', 'su-city': 'city', 'su-zip': 'zip' };
    Object.keys(map).forEach((id) => { const el = root.querySelector('#' + id); if (el) el.oninput = () => { f[map[id]] = el.value; }; });
    const q = (s) => root.querySelector(s);
    if (q('#su-state')) q('#su-state').onchange = (e) => { f.state = e.target.value; if (!U.home) U.home = f.state; };
    if (q('#su-name') && !f.name) q('#su-name').focus();
    if (q('#su-next')) q('#su-next').onclick = () => {
      if (!f.name.trim()) { U.msg = 'Type your company name.'; return render(); }
      U.msg = ''; U.step = 2; if (!U.home && f.state) U.home = f.state; render();
    };
    if (q('#su-out')) q('#su-out').onclick = signOut;
    if (q('#su-back')) q('#su-back').onclick = () => { U.step = 1; U.msg = ''; render(); };
    if (q('#su-home')) q('#su-home').onchange = (e) => { U.home = e.target.value; U.others = U.others.filter((s) => s !== U.home); render(); };
    if (q('#su-ono')) q('#su-ono').onclick = () => { U.other = false; render(); };
    if (q('#su-oyes')) q('#su-oyes').onclick = () => { U.other = true; render(); };
    if (q('#su-more')) q('#su-more').onchange = (e) => { if (e.target.value) { U.others.push(e.target.value); render(); } };
    root.querySelectorAll('[data-suadd]').forEach((b) => { b.onclick = () => { U.others.push(b.dataset.suadd); render(); }; });
    root.querySelectorAll('[data-surm]').forEach((b) => { b.onclick = () => { U.others = U.others.filter((s) => s !== b.dataset.surm); render(); }; });
    if (q('#su-done')) q('#su-done').onclick = finishSetup;
  }
  async function finishSetup() {
    const U = A.su;
    const st = cleanStates(U.home, U.other ? U.others : []);
    if (!st) { U.msg = 'Pick the state you are in.'; return render(); }
    U.busy = true; U.msg = ''; render();
    try {
      const c = await db.createCompany(Object.assign({}, U.f, { home: st.home, others: st.others }));
      A.companies.push(c); U.busy = false; pickCompany(c.id); A.phase = 'office'; A.view = 'home'; render();
    } catch (e) { U.busy = false; U.msg = e.message; render(); }
  }
  async function signOut() { await db.signOut(); A.me = null; A.companies = []; A.cid = null; A.phase = 'signin'; A.si = { step: 'email', email: '', code: '', busy: false, msg: '' }; render(); }

  // ===== The office: side menu + top bar + page =====
  function officeHtml() {
    const c = co();
    const rail = '<nav class="rail" aria-label="Menu"><div class="railbrand" title="StoreOwl Wholesale">' + owlSvg({}) + '</div>' +
      MENU.filter((m) => !m.mgr || isMgr()).map((m) => '<button class="railbtn' + (onMenu() === m.k ? ' on' : '') + (m.phase ? ' later' : '') + '" data-go="' + m.k + '" data-guide="menu-' + m.k + '">' + ic(m.k) + '<span>' + m.n + '</span>' +
        (m.k === 'review' ? '<i class="badge' + (A.rvn ? '' : ' hide') + '">' + (A.rvn || '') + '</i>' : '') + '</button>').join('') + '</nav>';
    const sw = A.companies.length > 1
      ? '<select id="co-pick" class="copick" data-guide="common-company-switch">' + A.companies.map((x) => opt(x.id, x.name, x.id === A.cid)).join('') + '</select>'
      : '<span class="coname">' + esc(c.name) + '</span>';
    const top = '<header class="topbar"><div class="tbl">' + sw + '<span class="tbstates">' + esc(statesLine(c.home, c.others)) + '</span></div>' +
      '<details class="acct"><summary data-guide="common-account">' + esc(A.me.email) + ' ▾</summary><div class="acctmenu"><span>' + ROLE[c.role] + '</span>' +
      '<button class="btn" id="sign-out" data-guide="common-sign-out">Sign out</button></div></details></header>';
    const m = MENU.find((x) => x.k === A.view) || MENU[0];
    let page;
    if (A.view === 'home') page = homeHtml();
    else if (A.view === 'settings') page = settingsHtml();
    else if (A.view === 'items') page = cat.itemsHtml();
    else if (A.view === 'customers') page = cat.custHtml();
    else if (A.view === 'import') page = imp.html();
    else if (A.view === 'counter') page = ctr.html();
    else if (A.view === 'review') page = ctr.reviewHtml();
    else if (A.view === 'invoices') page = ctr.invoicesHtml();
    else if (A.view === 'barcodes') page = ctr.bcHtml();
    else if (A.view === 'payments') page = pay.html();
    else page = '<h1>' + m.n + '</h1><div class="card soon"><b>Not built yet</b><span>Comes in Phase ' + m.phase + ' of the build plan.</span></div>';
    const toast = A.msg ? '<div class="toast' + (A.bad ? ' bad' : '') + '" role="status">' + esc(A.msg) + '<button id="toast-x" aria-label="Close" data-guide="common-message-close">×</button></div>' : '';
    return rail + '<div class="shell">' + top + '<main class="page">' + page + '</main></div>' + pay.modalHtml() + toast;
  }
  function onMenu() { return A.view === 'import' ? (A.im && A.im.kind) || 'items' : A.view === 'barcodes' ? 'items' : A.view; }
  function bindOffice() {
    root.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => {
      if (A.view === 'counter' && ctr.dirty() && !window.confirm('This sale isn’t saved. Leave it? (Suspend keeps it for later.)')) return;
      if (b.dataset.go === 'counter' && A.ct && A.ct.step !== 'sale') { A.ct.step = 'home'; A.ct.done = null; }
      if (b.dataset.go === 'review') A.rv = null;
      if (b.dataset.go === 'invoices') A.ivs = null;
      if (b.dataset.go === 'payments' && A.pm) { A.pm.data = null; A.pm.key = ''; A.pm.sel = null; }
      const C = A.cu;
      if (C && C.open && (C.open === 'new' || JSON.stringify(C.ed) !== C.orig || (C.led && JSON.stringify(C.led) !== C.lorig)) && !window.confirm('Your changes to this customer aren’t saved. Leave without saving?')) return;
      const I = A.it;
      if (I && I.sel && I.ed && (I.sel === 'new' || JSON.stringify(I.ed) !== I.orig) && !window.confirm('This item isn’t saved. Leave it without saving?')) return;
      if (b.dataset.go === 'customers' && C) { C.open = null; C.data = null; }
      if (b.dataset.go === 'items' && I) { I.sel = null; I.ed = null; }
      A.view = b.dataset.go; A.msg = ''; render();
    }; });
    const p = root.querySelector('#co-pick'); if (p) p.onchange = () => pickCompany(p.value);
    root.querySelector('#sign-out').onclick = signOut;
    const tx = root.querySelector('#toast-x'); if (tx) tx.onclick = () => { A.msg = ''; render(); };
    if (A.view === 'home') bindHome();
    if (A.view === 'settings') bindSettings();
    if (A.view === 'items') cat.bindItems();
    if (A.view === 'customers') cat.bindCust();
    if (A.view === 'import') imp.bind();
    if (A.view === 'counter') ctr.bind();
    if (A.view === 'review') ctr.bindReview();
    if (A.view === 'invoices') ctr.bindInvoices();
    if (A.view === 'barcodes') ctr.bindBc();
    if (A.view === 'payments') pay.bind();
    pay.bindModal();
    ctr.loadReviewCount();
  }

  // ----- Home -----
  function homeHtml() {
    const c = co();
    const name = ((A.people && (A.people.members.find((x) => x.me) || {}).name) || '').split(' ')[0];
    const box = (l, v, s) => '<div class="card bx"><span class="bxl">' + l + '</span><b class="bxv">' + v + '</b>' + (s ? '<span class="bxsub">' + s + '</span>' : '') + '</div>';
    const row = (done, t, s, go, guide) => '<tr><td class="ck">' + (done ? '<span class="tag ok">✓ Done</span>' : '<span class="tag grey">Next</span>') + '</td><td><b>' + t + '</b><span class="sm">' + s + '</span></td><td class="r">' +
      (go ? '<button class="btn sm" data-hgo="' + go + '" data-guide="' + guide + '">Open</button>' : '<span class="sm">Coming soon</span>') + '</td></tr>';
    const invited = A.people && (A.people.members.length > 1 || A.people.invites.length > 0);
    const items = (A.items || []).filter((x) => x.active !== false), custs = (A.custs || []).filter((x) => x.active !== false);
    const st = settingsOf(c), t = todayIso();
    const cNeed = custs.filter((x) => custIssues(x, st, t, c.home).length).length, iNeed = items.filter((x) => itemIssues(x, c.levels).length).length;
    const n = (v) => (A.items ? v.toLocaleString() : '…');
    const licN = isMgr() ? custs.filter((x) => licProblems(x, st, t, c.home).length).length : 0;
    const bw = isMgr() && A.bankWait && A.bankWait.n ? A.bankWait : null;
    const needCard = licN || bw ? '<div class="card hneed"><h2>Needs you</h2>' +
      (licN ? '<div class="hnrow"><span class="tag need">Licenses</span><b>' + licN + ' ' + (licN === 1 ? 'customer is' : 'customers are') +
      ' missing a license number or it ended</b><button class="btn sm" data-hgo="customers:lic" data-guide="home-needs-licenses">See them ›</button></div>' : '') +
      (bw ? '<div class="hnrow"><span class="tag need">Bank</span><b>$' + bw.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' in cash and checks not deposited' +
        (bw.old ? ' · oldest ' + bw.old + (bw.old === 1 ? ' day' : ' days') : '') + '</b><button class="btn sm" data-hgo="payments:bank" data-guide="home-needs-bank">Take to the bank ›</button></div>' : '') + '</div>' : '';
    return '<h1>' + greet() + (name ? ', ' + esc(name) : '') + '</h1>' +
      '<div class="bxs">' + box('Sales today', A.stoday ? '$' + A.stoday.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '…', A.stoday ? (A.stoday.n ? A.stoday.n + ' invoice' + (A.stoday.n === 1 ? '' : 's') : 'No invoices yet') : '') + box('Customers', n(custs.length), cNeed ? '<span class="miss">' + cNeed + ' need you</span>' : '') +
      box('Items', n(items.length), iNeed ? '<span class="miss">' + iNeed + ' need you</span>' : '') + box('Selling in', String(1 + c.others.length), esc(statesLine(c.home, c.others))) + '</div>' +
      needCard + '<div class="card"><h2>Getting set up</h2><table class="t"><tbody>' +
      row(true, 'Company details', esc(c.name), 'settings:company', 'home-setup-company') +
      row(true, 'Your states', esc(statesLine(c.home, c.others)), 'settings:states', 'home-setup-states') +
      row(!!invited, 'Your team', invited ? 'Invited' : 'Optional', 'settings:people', 'home-setup-team') +
      row(items.length > 0, 'Items', items.length ? items.length.toLocaleString() + ' items' : 'Add what you sell, with sizes and prices', 'items:', 'home-setup-items') +
      row(custs.length > 0, 'Customers', custs.length ? custs.length.toLocaleString() + ' customers' : 'Add your stores, their licenses and terms', 'customers:', 'home-setup-customers') +
      '</tbody></table></div>';
  }
  function bindHome() {
    root.querySelectorAll('[data-hgo]').forEach((b) => { b.onclick = () => { const [v, t] = b.dataset.hgo.split(':'); A.view = v; if (v === 'payments') pay.tab(t || 'list'); else if (v === 'customers') { if (A.cu) { A.cu.open = null; A.cu.f = t || 'all'; } else A.cuF = t; } else if (t) A.stab = t; render(); }; });
    cat.load();
    if (!A.stoday) { const t = todayIso(); db.sales(A.cid, 'posted').then((l) => { const d = l.filter((x) => x.invoice_date === t); A.stoday = { n: d.length, total: Math.round(d.reduce((a, x) => a + Number(x.total), 0) * 100) / 100 }; if (A.view === 'home') render(); }).catch(() => { A.stoday = { n: 0, total: 0 }; }); }
    if (isMgr() && !A.bankWait) { A.bankWait = { n: 0, total: 0, old: 0 }; const t0 = todayIso(); db.bankTodo(A.cid).then((l) => {
      const age = (d) => Math.round((new Date(t0 + 'T12:00:00') - new Date(d + 'T12:00:00')) / 864e5);
      A.bankWait = { n: l.length, total: Math.round(l.reduce((a, p) => a + Number(p.amount), 0) * 100) / 100, old: l.reduce((m, p) => Math.max(m, age(p.received)), 0) };
      if (A.view === 'home') render(); }).catch(() => { /* home still works */ }); }
    if (!A.people) db.members(A.cid).then((p) => { A.people = p; if (A.view === 'home') render(); }).catch(() => { /* home still works */ });
  }

  // ----- Settings: Company · States · People · History -----
  function settingsHtml() {
    const tabs = [['company', 'Company'], ['states', 'States'], ['levels', 'Price levels'], ['licenses', 'License rules'], ['invoices', 'Invoices'], ['statements', 'Statements & receipts'], ['people', 'People']].concat(isMgr() ? [['history', 'History']] : []);
    if (!tabs.some((t) => t[0] === A.stab)) A.stab = 'company';
    const bar = '<nav class="tabs">' + tabs.map((t) => '<button class="' + (A.stab === t[0] ? 'on' : '') + '" data-stab="' + t[0] + '" data-guide="settings-tab">' + t[1] + '</button>').join('') + '</nav>';
    let body = '';
    if (A.stab === 'company') body = companyFormHtml();
    if (A.stab === 'states') body = statesFormHtml();
    if (A.stab === 'people') body = peopleHtml();
    if (A.stab === 'levels') body = cat.levelsHtml();
    if (A.stab === 'licenses') body = cat.licRulesHtml();
    if (A.stab === 'invoices') body = ctr.invSettingsHtml();
    if (A.stab === 'statements') body = pay.setHtml();
    if (A.stab === 'history') body = historyHtml();
    return '<h1>Settings</h1>' + bar + body;
  }
  function bindSettings() {
    root.querySelectorAll('[data-stab]').forEach((b) => { b.onclick = () => { A.stab = b.dataset.stab; A.msg = ''; render(); }; });
    if (A.stab === 'company') bindCompanyForm();
    if (A.stab === 'states') bindStatesForm();
    if (A.stab === 'people') bindPeople();
    if (A.stab === 'levels') cat.bindLevels();
    if (A.stab === 'licenses') cat.bindLicRules();
    if (A.stab === 'invoices') ctr.bindInvSettings();
    if (A.stab === 'statements') pay.bindSet();
    if (A.stab === 'history') bindHistory();
  }
  function saveBar(dirty, guideBase) {
    return '<div class="savebar' + (dirty ? '' : ' hide') + '" id="savebar"><span>Not saved yet</span><div class="rowr"><button class="btn" id="sv-undo" data-guide="' + guideBase + '-undo">Undo</button><button class="btn amber" id="sv-save" data-guide="' + guideBase + '-save">Save</button></div></div>';
  }
  const CO_KEYS = ['name', 'phone', 'email', 'addr', 'city', 'state', 'zip'];
  function companyFormHtml() {
    const c = co();
    if (!A.co) A.co = Object.fromEntries(CO_KEYS.map((k) => [k, c[k] || '']));
    const f = A.co, ro = !isMgr();
    const dirty = CO_KEYS.some((k) => (f[k] || '') !== (c[k] || ''));
    const inp = (l, k, ac, wide) => '<label class="fld' + (wide ? ' span2' : '') + '"><span>' + l + '</span><input data-cok="' + k + '" value="' + esc(f[k]) + '"' + (ac ? ' autocomplete="' + ac + '"' : '') + (ro ? ' disabled' : '') + ' data-guide="settings-company-' + k + '"></label>';
    return '<div class="card form"><h2>Company</h2><div class="grid2">' + inp('Company name', 'name', 'organization', true) + inp('Phone', 'phone', 'tel') + inp('Email for invoices', 'email', 'email') +
      inp('Street address', 'addr', 'street-address', true) + inp('City', 'city', 'address-level2') +
      '<div class="grid2 tight"><label class="fld"><span>State</span><select data-cok="state" data-guide="settings-company-state"' + (ro ? ' disabled' : '') + '>' + stateOptions(f.state, ' ') + '</select></label>' + inp('ZIP', 'zip', 'postal-code') + '</div>' +
      '</div>' + (ro ? '<p class="sm">Only owners and managers can change these.</p>' : '') + '</div>' + saveBar(dirty, 'settings-company');
  }
  function bindCompanyForm() {
    const c = co(), f = A.co;
    const bar = root.querySelector('#savebar');
    const check = () => bar.classList.toggle('hide', !CO_KEYS.some((k) => (f[k] || '') !== (c[k] || '')));
    root.querySelectorAll('[data-cok]').forEach((el) => { const ev = el.tagName === 'SELECT' ? 'onchange' : 'oninput'; el[ev] = () => { f[el.dataset.cok] = el.value; check(); }; });
    root.querySelector('#sv-undo').onclick = () => { A.co = null; render(); };
    root.querySelector('#sv-save').onclick = async () => {
      const ch = {}; CO_KEYS.forEach((k) => { if ((f[k] || '') !== (c[k] || '')) ch[k] = f[k]; });
      try { replaceCo(await db.companyPut(A.cid, ch)); A.co = null; A.hist = null; say('✓ Company saved'); } catch (e) { say(e.message, true); }
      render();
    };
  }
  function replaceCo(c) { A.companies = A.companies.map((x) => (x.id === c.id ? c : x)); }

  function statesFormHtml() {
    const c = co();
    if (!A.st) A.st = { home: c.home, others: c.others.slice() };
    const S = A.st, ro = !isOwner();
    const dirty = S.home !== c.home || S.others.join() !== c.others.slice().sort().join();
    const near = neighborsOf(S.home).filter((s) => !S.others.includes(s));
    return '<div class="card form"><h2>Your state</h2>' +
      '<label class="fld narrow"><span>The state you are in</span><select id="st-home" data-guide="settings-states-home"' + (ro ? ' disabled' : '') + '>' + stateOptions(S.home) + '</select></label>' +
      '<h2>Other states you sell in</h2>' +
      '<div class="chips">' + (S.others.length ? S.others.map((s) => '<span class="chip on">' + esc(stateName(s)) + (ro ? '' : ' <button data-strm="' + s + '" aria-label="Take off ' + esc(stateName(s)) + '" data-guide="settings-states-remove">×</button>') + '</span>').join('') : '<span class="sm">None</span>') + '</div>' +
      (ro ? '<p class="sm">Only owners can change the states.</p>' :
        '<div class="chips">' + near.map((s) => '<button class="chip" data-stadd="' + s + '" data-guide="settings-states-add">+ ' + esc(stateName(s)) + '</button>').join('') + '</div>' +
        '<label class="fld narrow"><span>Another state</span><select id="st-more" data-guide="settings-states-pick">' + stateOptions('', 'Pick a state', [S.home].concat(S.others)) + '</select></label>') +
      '</div>' + saveBar(dirty, 'settings-states');
  }
  function bindStatesForm() {
    const S = A.st, q = (s) => root.querySelector(s);
    if (q('#st-home')) q('#st-home').onchange = (e) => { S.home = e.target.value; S.others = S.others.filter((s) => s !== S.home); render(); };
    if (q('#st-more')) q('#st-more').onchange = (e) => { if (e.target.value) { S.others.push(e.target.value); S.others.sort(); render(); } };
    root.querySelectorAll('[data-stadd]').forEach((b) => { b.onclick = () => { S.others.push(b.dataset.stadd); S.others.sort(); render(); }; });
    root.querySelectorAll('[data-strm]').forEach((b) => { b.onclick = () => { S.others = S.others.filter((s) => s !== b.dataset.strm); render(); }; });
    q('#sv-undo').onclick = () => { A.st = null; render(); };
    q('#sv-save').onclick = async () => {
      try { replaceCo(await db.statesSet(A.cid, S.home, S.others)); A.st = null; A.hist = null; say('✓ States saved'); } catch (e) { say(e.message, true); }
      render();
    };
  }

  function peopleHtml() {
    if (!A.people) return '<div class="card"><p class="sm">Loading…</p></div>';
    const P = A.people, own = isOwner();
    const roleSel = (v, attrs, guide) => '<select ' + attrs + ' data-guide="' + guide + '">' + ROLE_LIST.map((r) => opt(r, ROLE[r], r === v)).join('') + (attrs.includes('data-pmrole') ? opt('', 'Remove from company', false) : '') + '</select>';
    const rows = P.members.map((m) => '<tr><td><b>' + esc(m.name || '—') + '</b>' + (m.me ? ' <span class="tag grey">You</span>' : '') + '</td><td>' + esc(m.email) + '</td><td>' +
      (own && !m.me ? roleSel(m.role, 'data-pmrole="' + m.user_id + '"', 'settings-people-role') : ROLE[m.role]) + '</td></tr>').join('') +
      P.invites.map((x) => '<tr class="inv"><td><span class="tag need">Invited</span></td><td>' + esc(x.email) + '</td><td>' + ROLE[x.role] +
        (own ? ' <button class="btn sm" data-pirm="' + esc(x.email) + '" data-guide="settings-people-invite-remove">Take back</button>' : '') + '</td></tr>').join('');
    const me = P.members.find((m) => m.me) || {};
    return '<div class="card"><h2>People</h2><table class="t"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      (own ? '<div class="invrow"><label class="fld"><span>Invite by email</span><input id="pi-email" type="email" value="' + esc(A.inv.email) + '" data-guide="settings-people-invite-email"></label>' +
        '<label class="fld"><span>Role</span>' + roleSel(A.inv.role, 'id="pi-role"', 'settings-people-invite-role') + '</label>' +
        '<button class="btn amber" id="pi-go" data-guide="settings-people-invite">Invite</button></div><p class="sm">They sign in with this email to join.</p>' : '') +
      '</div><div class="card form"><h2>Your name</h2><div class="invrow"><label class="fld"><span>Shown in the history</span><input id="pn-name" value="' + esc(me.name || '') + '" autocomplete="name" data-guide="settings-people-your-name"></label>' +
      '<button class="btn" id="pn-save" data-guide="settings-people-your-name-save">Save name</button></div></div>';
  }
  function bindPeople() {
    if (!A.people) { db.members(A.cid).then((p) => { A.people = p; render(); }).catch((e) => { A.people = { members: [], invites: [] }; say(e.message, true); render(); }); return; }
    const q = (s) => root.querySelector(s);
    if (q('#pi-email')) {
      q('#pi-email').oninput = (e) => { A.inv.email = e.target.value; };
      q('#pi-role').onchange = (e) => { A.inv.role = e.target.value; };
      q('#pi-go').onclick = async () => {
        try { A.people = await db.invite(A.cid, A.inv.email, A.inv.role); say('✓ Invited ' + A.inv.email.trim().toLowerCase()); A.inv.email = ''; A.hist = null; } catch (e) { say(e.message, true); }
        render();
      };
    }
    root.querySelectorAll('[data-pirm]').forEach((b) => { b.onclick = async () => { try { A.people = await db.inviteRemove(A.cid, b.dataset.pirm); } catch (e) { say(e.message, true); } render(); }; });
    root.querySelectorAll('[data-pmrole]').forEach((s) => {
      s.onchange = async () => {
        const v = s.value || null;
        if (!v && !window.confirm('Remove this person from the company?')) { render(); return; }
        try { A.people = await db.memberSet(A.cid, s.dataset.pmrole, v); say(v ? '✓ Role changed' : '✓ Removed'); A.hist = null; } catch (e) { say(e.message, true); }
        render();
      };
    });
    q('#pn-save').onclick = async () => {
      const v = q('#pn-name').value.trim();
      try { await db.myName(A.cid, v); A.people = await db.members(A.cid); say('✓ Name saved'); } catch (e) { say(e.message, true); }
      render();
    };
  }

  function historyHtml() {
    if (!A.hist) return '<div class="card"><p class="sm">Loading…</p></div>';
    const say1 = (x) => {
      const d = x.detail || {};
      if (x.what === 'states changed' && d.after) return 'States: ' + statesLine(d.after.home, d.after.others);
      if (x.what === 'invited') return 'Invited ' + d.email + ' as ' + (ROLE[d.role] || d.role);
      if (x.what === 'company made') return 'Company made · ' + stateName(d.home);
      if (x.what === 'price levels changed' && d.after) return 'Price levels: ' + d.after.map((l) => l.name).join(' · ');
      if (['item added', 'item changed', 'customer added', 'customer changed'].includes(x.what)) return x.what.charAt(0).toUpperCase() + x.what.slice(1) + ' · ' + (d.name || '');
      if (x.what === 'license changed') return 'License changed · ' + licName(d.kind);
      return x.what.charAt(0).toUpperCase() + x.what.slice(1);
    };
    return '<div class="card"><h2>History</h2><table class="t"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>' +
      (A.hist.length ? A.hist.map((x) => '<tr><td>' + esc(when(x.at)) + '</td><td>' + esc(x.by) + '</td><td>' + esc(say1(x)) + '</td></tr>').join('') : '<tr><td colspan="3" class="sm">Nothing yet</td></tr>') +
      '</tbody></table></div>';
  }
  function bindHistory() { if (!A.hist) db.history(A.cid).then((h) => { A.hist = h; render(); }).catch((e) => { A.hist = []; say(e.message, true); render(); }); }

  db.onAuth((s) => { if (!s && A.phase === 'office') { A.phase = 'signin'; render(); } });
  boot();
  return A;
}
