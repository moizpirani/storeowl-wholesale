// Phase 2, piece 1: the Counter (New sale → find the customer privately → scan → Suspend · Send for review · Complete sale),
// Resume a suspended sale, the Review page (owners / managers finish sales sent to them), a simple Invoices list,
// and Items → Barcodes to add (barcodes scanned at the counter that no item has).
// Privacy at the counter: no recent customers, search shows name · store # · city only, balances hidden behind Show (5 seconds),
// and the screen clears after every sale. Typing never redraws: boxes update the numbers around them in place.
// Nothing ever stops a sale: license problems only warn (or, if the owner picked it, staff send the sale for a manager's OK).

import {
  catName, termName, money, settingsOf, saleWarnings, problemText, priceSale, saleCheck, findUpc, cleanUpc, upcShow,
  plural, todayIso, shortDate, initials, mainSize
} from './rules.js';

const WHY = ['Price check', 'Item not in StoreOwl', 'Short on stock', 'License', 'Credit or terms', 'Other'];

export function makeCounter(X) {
  const { A, db, root, esc, opt } = X;
  const q = (s) => root.querySelector(s);
  const $$ = (s) => Array.from(root.querySelectorAll(s));
  const $ = (v) => (v == null ? '—' : '$' + money(v));
  const co = () => X.co() || {};
  const sets = () => settingsOf(co());
  const today = () => todayIso();
  const fresh = () => ({ step: 'home', q: '', hi: 0, sale: null, susp: null, last: null, panel: null, why: [], note: '', lic: '', clear: 0, unk: null, nq: '', nhi: 0, done: null, busy: false });
  const C = () => A.ct || (A.ct = fresh());

  // ---------- data ----------
  function loadSusp(force) {
    if (C().susp && !force) return;
    const cid = A.cid;
    db.sales(cid, 'suspended').then((l) => { if (A.cid !== cid) return; C().susp = l; if (A.view === 'counter' && ['home', 'resume'].includes(C().step)) X.render(); })
      .catch(() => { C().susp = []; });
  }
  function loadReviewCount() {
    if (!X.isMgr() || A.rvn != null) return;
    const cid = A.cid;
    Promise.all([db.sales(cid, 'review'), db.sales(cid, 'suspended')]).then(([r, s]) => {
      if (A.cid !== cid) return;
      A.rvn = r.length + s.filter(pastDue).length; const b = q('[data-go="review"] .badge');
      if (b) { b.textContent = A.rvn; b.classList.toggle('hide', !A.rvn); }
    }).catch(() => { /* badge only */ });
  }
  const pastDue = (s) => s.created_at && todayIso(new Date(s.created_at)) < today();
  const cust = () => (A.custs || []).find((c) => c.id === (C().sale || {}).customer_id) || null;
  const priced = () => { const s = C().sale, c = cust(); return priceSale(s ? s.lines : [], A.items || [], c ? c.level : 1); };
  const dirty = () => { const s = C().sale; return !!(s && s.lines.length && JSON.stringify(s.lines) !== s.orig); };

  // License problems for what's on this sale ('' when the owner turned the Counter warning off).
  function licWarn() {
    const c = cust(), st = sets();
    if (!c || st.lic_mode === 'off') return [];
    const cats = Array.from(new Set(priced().lines.filter((l) => l.category).map((l) => l.category)));
    const seen = {}, out = [];
    (cats.length ? cats : ['_none']).forEach((cat) => saleWarnings(c, cat, st, today(), co().home).forEach((p) => {
      if (!seen[p.kind]) { seen[p.kind] = 1; out.push(p); }
    }));
    return out;
  }
  const askBlocks = () => sets().lic_mode === 'ask' && !X.isMgr() && licWarn().length > 0;

  // ---------- Counter main screen ----------
  function homeHtml() {
    const n = (C().susp || []).length;
    const tile = (id, icon, t, s, right, guide) => '<button class="cttile" id="' + id + '" data-guide="' + guide + '"><span class="ctic">' + icon + '</span><span class="cttx"><b>' + t + '</b><span>' + s + '</span></span>' + right + '</button>';
    return '<h1>Counter</h1>' +
      '<button class="ctnew" id="ct-new" data-guide="counter-home-new-sale"><span class="ctplus">+</span><span><b>New sale</b><span>Find the customer, then scan items</span></span></button>' +
      '<div class="cttiles">' +
      tile('ct-resume', '❚❚', 'Resume a suspended sale', n ? 'Finish them by closing' : 'None right now', '<span class="ctcount' + (n ? '' : ' zero') + '">' + (C().susp ? n : '…') + '</span>', 'counter-home-resume') +
      tile('ct-invoices', '▤', 'Find an invoice', 'By invoice #, customer or date', '<span class="ctarrow">›</span>', 'counter-home-invoices') +
      '</div>';
  }

  // ---------- find the customer (nothing shows until you type) ----------
  function custMatches(text) {
    const t = String(text || '').trim().toLowerCase();
    if (!t) return [];
    const d = t.replace(/\D/g, '');
    return (A.custs || []).filter((c) => c.active !== false && (c.name.toLowerCase().includes(t) || (c.store_no && c.store_no.toLowerCase() === t.replace(/^#/, '')) ||
      (c.city || '').toLowerCase().startsWith(t) || (d.length >= 4 && String(c.phone || '').replace(/\D/g, '').includes(d)))).slice(0, 8);
  }
  function custRowsHtml() {
    const S = C(), m = custMatches(S.q);
    if (!S.q.trim()) return '<p class="cthint">Nothing shows until you type, so no one at the counter sees your customer list.</p>';
    if (!m.length) return '<p class="cthint">No customer matches “' + esc(S.q) + '”.</p>';
    if (S.hi >= m.length) S.hi = 0;
    return m.map((c, i) => '<button class="ctrr' + (i === S.hi ? ' on' : '') + '" data-ctc="' + c.id + '" data-guide="counter-find-result"><b>' + esc(c.name) + '</b><span>' +
      esc([c.store_no ? 'Store #' + c.store_no : '', c.city].filter(Boolean).join(' · ')) + '</span></button>').join('');
  }
  function findHtml() {
    return '<div class="hdr"><h1>New sale</h1><button class="btn" id="ct-back" data-guide="counter-find-back">Back</button></div>' +
      '<div class="card ctfind"><input class="ctbig" id="ct-cq" placeholder="Customer name, store # or phone" value="' + esc(C().q) + '" autocomplete="off" data-guide="counter-find-search">' +
      '<div id="ct-cres">' + custRowsHtml() + '</div></div>';
  }

  // ---------- the sale ----------
  function groups(pl) {
    const order = [], by = {};
    pl.lines.forEach((l, i) => { const k = l.category || 'other'; if (!by[k]) { by[k] = []; order.push(k); } by[k].push(i); });
    return order.map((k) => ({ k, idx: by[k] }));
  }
  function groupLabel(pl, g) {
    const ls = g.idx.map((i) => pl.lines[i]);
    const units = ls.reduce((a, l) => a + (l.shipped || 0), 0), sub = ls.reduce((a, l) => a + (l.total || 0), 0);
    const names = Array.from(new Set(ls.map((l) => String(l.size || '').toLowerCase())));
    return catName(g.k) + ' · ' + units + ' ' + (names.length === 1 && names[0] ? plural(names[0], units) : plural('item', units)) + ' · ' + $(Math.round(sub * 100) / 100);
  }
  function noteOf(l) {
    if (l.missing === 'price') return ['or', 'No price for this customer’s level'];
    if (l.missing === 'gone') return ['or', 'Not in your items any more · take it off'];
    if (l.shipped < l.ordered) return ['or', (l.ordered - l.shipped) + ' short'];
    if (l.off > 0) return ['ok', 'Quantity break · ' + l.group_qty + (l.group ? ' ' + l.group : '') + ' ' + plural(String(l.size).toLowerCase(), l.group_qty) + ' · $' + money(l.off) + ' off each'];
    if (C().just === l.size_id) return ['ok', 'Just scanned · type how many, then Enter'];
    return ['', ''];
  }
  function lineRow(l, i) {
    const nt = noteOf(l);
    const sz = (l.sizes || []).length > 1
      ? '<span class="ctsz">' + l.sizes.map((z) => '<button class="' + (z.id === l.size_id ? 'on' : '') + '" data-ctsz="' + i + '|' + z.id + '" data-guide="counter-sale-size">' + esc(z.name) + '</button>').join('') + '</span>'
      : '<span class="ctsz one"><button class="on" disabled data-guide="counter-sale-size">' + esc(l.size || '') + '</button></span>';
    const ph = l.photo_url ? '<img class="ctph" src="' + esc(l.photo_url) + '" alt="">' : '<span class="ctph none"></span>';
    return '<tr data-row="' + i + '"><td class="ctphc">' + ph + '</td><td><b>' + esc(l.name || '') + '</b><small>' + esc(l.upc ? upcShow(l.upc) : '') + '</small>' +
      '<small class="ctnote ' + nt[0] + '" id="ct-nt-' + i + '">' + esc(nt[1]) + '</small></td><td>' + sz + '</td>' +
      '<td class="n"><input class="ctq" inputmode="numeric" data-cto="' + i + '" value="' + l.ordered + '" data-guide="counter-sale-ordered"></td>' +
      '<td class="n"><input class="ctq' + (l.shipped < l.ordered ? ' short' : '') + '" inputmode="numeric" data-cts="' + i + '" value="' + l.shipped + '" data-guide="counter-sale-shipped"></td>' +
      '<td class="n" id="ct-pr-' + i + '">' + $(l.unit_price) + '</td><td class="n"><b id="ct-tt-' + i + '">' + $(l.total) + '</b></td>' +
      '<td><button class="x" data-ctrm="' + i + '" aria-label="Take off" data-guide="counter-sale-remove">×</button></td></tr>';
  }
  function linesHtml(pl) {
    if (!pl.lines.length) return '<div class="card ctempty">Scan the first item, or type its name.</div>';
    return '<div class="tcard"><table class="t ctlt"><thead><tr><th></th><th>Item</th><th>Size</th><th class="n">Ordered</th><th class="n">Shipped</th><th class="n">Price</th><th class="n">Total</th><th></th></tr></thead><tbody>' +
      groups(pl).map((g) => '<tr class="ctgrp"><td colspan="8" id="ct-g-' + g.k + '">' + esc(groupLabel(pl, g)) + '</td></tr>' + g.idx.map((i) => lineRow(pl.lines[i], i)).join('')).join('') +
      '</tbody></table></div>';
  }
  function hidden(k, label) {
    return '<span class="cthid"><span>' + label + '</span><b id="ct-v-' + k + '">•••</b><button class="lnk" data-ctshow="' + k + '" data-guide="counter-sale-show-' + k + '">Show</button></span>';
  }
  function saleHtml() {
    const S = C(), s = S.sale, c = cust();
    if (!c) return '<h1>Counter</h1><div class="card"><p class="sm">This customer isn’t in your list any more.</p><button class="btn" id="ct-change" data-guide="counter-sale-change">Pick a customer</button></div>';
    const pl = priced(), warn = licWarn(), mode = sets().lic_mode, mgr = X.isMgr();
    const licChip = mode === 'off' ? '' : warn.length ? '<span class="tag need big">Licenses: ' + warn.length + ' to check</span>' : '<span class="tag ok big">✓ Licenses OK</span>';
    const head = '<div class="card ctcust"><div class="av">' + esc(initials(c.name)) + '</div><div class="ctwho"><b>' + esc(c.name) + '</b><span>' +
      esc([c.store_no ? 'Store #' + c.store_no : '', c.city, termName(c.terms)].filter(Boolean).join(' · ')) + '</span></div>' +
      hidden('owes', 'Owes') + (c.credit_limit != null ? hidden('credit', 'Credit left') : '') + licChip +
      (s.status === 'review' ? '' : '<button class="btn sm" id="ct-change" data-guide="counter-sale-change">Change</button>') + '</div>';
    const others = (S.susp || []).filter((x) => x.customer_id === c.id && x.id !== s.id);
    const held = others.length ? '<div class="ctbar">This store has ' + others.length + ' suspended ' + plural('sale', others.length) + ' from ' +
      esc(when(others[0].created_at)) + '.<button class="btn sm" data-ctopen="' + others[0].id + '" data-guide="counter-sale-open-suspended">Open it</button></div>' : '';
    const rv = s.status === 'review' ? '<div class="ctbar rv"><b>Sent for review</b> by ' + esc(s.by_name || '—') + ' · ' + esc(s.why || '') +
      '<span class="sm">The invoice will be dated ' + esc(shortDate((s.sent_at || '').slice(0, 10), true)) + ', the day it was sent.</span></div>' : '';
    const lic = warn.length ? '<div class="licbar ctlic"><div class="tx"><b>' + esc(warn.map((p) => problemText(p)).join(' · ')) + '</b><br>' +
      (mode === 'ask' && !mgr ? 'A manager needs to OK this sale. Use <b>Send for review</b>.' : 'You can still sell. Say why, and it goes in the customer’s History.') + '</div>' +
      (mode === 'ask' && !mgr ? '' : '<input class="inp" id="ct-licwhy" placeholder="Why sell anyway?" value="' + esc(S.lic) + '" data-guide="counter-sale-license-reason">') + '</div>' : '';
    const unk = S.unk ? '<div class="ctunk"><div class="tx"><b>No item has barcode ' + esc(upcShow(S.unk)) + '.</b> It’s been sent to your manager to add. Type the item’s name to keep selling.</div>' +
      '<button class="btn sm" id="ct-unk-x" data-guide="counter-sale-unknown-ok">OK</button></div>' : '';
    const scan = '<div class="ctscan"><input class="ctbig" id="ct-scan" placeholder="Scan a barcode, or type an item name" autocomplete="off" value="' + esc(S.nq) + '" data-guide="counter-sale-scan">' +
      (S.last && s.status !== 'review' ? '<button class="btn" id="ct-repeat" data-guide="counter-sale-repeat">Repeat last order</button>' : '') + '</div>' +
      '<div id="ct-sres" class="ctsres">' + nameRowsHtml() + '</div>' +
      '<p class="cttip">After a scan the quantity box is ready: type <kbd>5</kbd> <kbd>Enter</kbd> and you’re back to scanning. Scan the same item again to add 1.</p>';
    const isNew = !s.id;
    const side = '<aside class="card ctsum"><h2>Invoice</h2><div class="ctkv"><span id="ct-count">' + pl.count + ' ' + plural('item', pl.count) + ' · ' + pl.lines.length + ' ' + plural('line', pl.lines.length) + '</span></div>' +
      '<div class="ctkv tot"><b>Invoice total</b><b id="ct-total">' + $(pl.total) + '</b></div>' +
      '<div class="ctkv"><span>Paid by</span><span>Charge to account</span></div>' +
      '<div class="ctbtns">' + (s.status === 'review' ? '' : '<button class="btn" id="ct-suspend" data-guide="counter-sale-suspend">Suspend</button><button class="btn" id="ct-review" data-guide="counter-sale-send-review">Send for review</button>') + '</div>' +
      '<button class="btn amber ctgo" id="ct-complete" data-guide="counter-sale-complete"' + (askBlocks() ? ' disabled' : '') + '>Complete sale</button>' +
      '<button class="lnk ctclear" id="ct-clear" data-guide="counter-sale-clear">' + (S.clear ? 'Tap again to ' + (isNew ? 'clear this sale' : 'cancel this sale') : isNew ? 'Clear sale' : 'Cancel sale') + '</button></aside>';
    return '<h1>Counter</h1><div class="ctwrap"><div class="ctmain">' + head + rv + held + lic + unk + scan + '<div id="ct-lines">' + linesHtml(pl) + '</div></div>' + side + '</div>' + panelHtml(pl, warn);
  }
  function when(iso) { const d = new Date(iso); return isNaN(d) ? '' : (todayIso(d) === today() ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ') + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }

  // Item name search under the scan box (whole page never redraws while typing).
  function nameMatches(t) {
    t = String(t || '').trim().toLowerCase();
    if (t.length < 2 || /^\d+$/.test(t)) return [];
    const words = t.split(/\s+/), out = [];
    for (const it of A.items || []) {
      if (it.active === false) continue;
      const hay = (it.name + ' ' + (it.item_no || '')).toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      for (const z of it.sizes || []) { out.push({ it, z }); if (out.length >= 8) return out; }
    }
    return out;
  }
  function nameRowsHtml() {
    const S = C(), m = nameMatches(S.nq);
    if (!m.length) return S.nq.trim().length >= 2 && !/^\d+$/.test(S.nq.trim()) ? '<p class="cthint">No item matches “' + esc(S.nq) + '”.</p>' : '';
    if (S.nhi >= m.length) S.nhi = 0;
    const lv = (cust() || {}).level || 1;
    return m.map((x, i) => '<button class="ctrr' + (i === S.nhi ? ' on' : '') + '" data-ctadd="' + x.z.id + '" data-guide="counter-sale-name-result"><b>' + esc(x.it.name) + '</b><span>' +
      esc(x.z.name + (x.z.n > 1 ? ' · ' + x.z.n + ' ' + plural(x.it.unit || 'each', x.z.n) : '') + ' · ' + (x.z.prices && x.z.prices[lv] != null ? $(x.z.prices[lv]) : 'no price')) + '</span></button>').join('');
  }

  function panelHtml(pl, warn) {
    const S = C();
    if (S.panel === 'complete') {
      const need = warn.length && sets().lic_mode !== 'off';
      return '<div class="ctmodal"><div class="card ctpan"><h2>Complete sale</h2><div class="ctkv tot"><b>Invoice total</b><b>' + $(pl.total) + '</b></div>' +
        '<div class="seg"><button class="on" data-guide="counter-complete-charge">Charge to account</button></div>' +
        (need ? '<label class="fld"><span>Why sell anyway? (licenses: ' + esc(warn.map((p) => problemText(p)).join(', ')) + ')</span><input id="ct-licwhy2" value="' + esc(S.lic) + '" data-guide="counter-complete-license-reason"></label>' : '') +
        '<p class="fmsg" id="ct-perr"></p><div class="rowr"><button class="btn" id="ct-pback" data-guide="counter-complete-back">Back</button>' +
        '<button class="btn amber" id="ct-post" data-guide="counter-complete-post"' + (S.busy ? ' disabled' : '') + '>Post invoice</button></div></div></div>';
    }
    if (S.panel === 'review') {
      return '<div class="ctmodal"><div class="card ctpan"><h2>Send for review</h2><p class="sm gap">An owner or manager opens it on the Review page and finishes it. The invoice keeps today’s date.</p>' +
        '<div class="chips">' + WHY.map((w) => '<button class="chip' + (S.why.includes(w) ? ' on' : '') + '" data-ctwhy="' + esc(w) + '" data-guide="counter-review-reason">' + esc(w) + '</button>').join('') + '</div>' +
        '<label class="fld"><span>Note for the manager</span><input id="ct-rnote" value="' + esc(S.note) + '" data-guide="counter-review-note"></label>' +
        '<p class="fmsg" id="ct-perr"></p><div class="rowr"><button class="btn" id="ct-pback" data-guide="counter-review-back">Back</button>' +
        '<button class="btn amber" id="ct-rsend" data-guide="counter-review-send"' + (S.busy ? ' disabled' : '') + '>Send for review</button></div></div></div>';
    }
    return '';
  }

  function doneHtml() {
    const d = C().done;
    return '<h1>Counter</h1><div class="card ctdone"><div class="ctok">✓</div><h2>Invoice ' + esc(d.number) + ' posted</h2><p>' + $(d.total) + ' · charged to account</p>' +
      '<p class="sm">Printing and emailing invoices come next.</p><div class="rowr rowc"><button class="btn" id="ct-home" data-guide="counter-done-home">Back to Counter</button>' +
      '<button class="btn amber" id="ct-next" data-guide="counter-done-next">Next sale</button></div></div>';
  }

  function resumeHtml() {
    const l = C().susp;
    const rows = !l ? '<tr><td colspan="5" class="empty">Loading…</td></tr>' : !l.length ? '<tr><td colspan="5" class="empty">No suspended sales.</td></tr>' :
      l.map((s) => '<tr data-ctopen="' + s.id + '" class="ctpick" data-guide="counter-resume-row"><td><b>' + esc(s.customer.name) + '</b><small>' + esc(s.customer.store_no ? 'Store #' + s.customer.store_no : '') + '</small></td>' +
        '<td>' + esc(when(s.created_at)) + '<small>' + esc(s.by_name || '') + '</small></td><td class="n">' + s.units + '</td><td class="n">' + $(s.total) + '</td>' +
        '<td>' + (pastDue(s) ? '<span class="tag need">Past due · a manager will check</span>' : '<span class="tag ok">Due by closing</span>') + '</td></tr>').join('');
    return '<div class="hdr"><h1>Suspended sales</h1><button class="btn" id="ct-back" data-guide="counter-resume-back">Back</button></div>' +
      '<div class="tcard"><table class="t"><thead><tr><th>Customer</th><th>Set aside</th><th class="n">Items</th><th class="n">Total</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function html() {
    if (!A.items || !A.custs) return '<h1>Counter</h1><div class="card"><p class="sm">Loading…</p></div>';
    const st = C().step;
    if (st === 'find') return findHtml();
    if (st === 'sale' && C().sale) return saleHtml();
    if (st === 'done' && C().done) return doneHtml();
    if (st === 'resume') return resumeHtml();
    return homeHtml();
  }

  // ---------- actions ----------
  function startSale(c) {
    const S = C();
    if (S.sale && S.sale.lines.length) { S.sale.customer_id = c.id; }
    else S.sale = { id: null, status: 'new', customer_id: c.id, lines: [], orig: '[]' };
    S.step = 'sale'; S.q = ''; S.last = null; S.lic = ''; S.unk = null; S.nq = ''; S.clear = 0;
    db.saleLast(A.cid, c.id).then((l) => {
      if (!(S.sale && S.sale.customer_id === c.id && l && l.lines.length)) return;
      S.last = l;
      const b = q('#ct-scan');   // add the button without redrawing (someone may be typing)
      if (b && !q('#ct-repeat')) { b.insertAdjacentHTML('afterend', '<button class="btn" id="ct-repeat" data-guide="counter-sale-repeat">Repeat last order</button>'); q('#ct-repeat').onclick = doRepeat; }
    }).catch(() => { /* fine */ });
    loadSusp(true);
    X.render(); focusScan();
  }
  function openSale(s) {
    const S = C();
    S.sale = { id: s.id, status: s.status, customer_id: s.customer_id, lines: s.lines.map((l) => ({ size_id: l.size_id, ordered: +l.ordered, shipped: +l.shipped, se: +l.shipped !== +l.ordered })),
      sent_at: s.sent_at, why: s.why, by_name: s.by_name };
    S.sale.orig = JSON.stringify(S.sale.lines);
    S.step = 'sale'; S.lic = s.lic_reason || ''; S.unk = null; S.nq = ''; S.clear = 0; S.last = null; S.panel = null;
    A.view = 'counter'; X.render(); focusScan();
  }
  function reset(msg) {
    const susp = C().susp; A.ct = fresh(); A.ct.susp = susp; loadSusp(true); A.rvn = null;
    X.say(msg || '');
    X.render();
  }
  function addSize(sizeId, fromName) {
    const S = C(), s = S.sale;
    let i = s.lines.findIndex((l) => l.size_id === sizeId);
    if (i >= 0) { s.lines[i].ordered++; if (!s.lines[i].se) s.lines[i].shipped = s.lines[i].ordered; }
    else { s.lines.push({ size_id: sizeId, ordered: 1, shipped: 1, se: false }); i = s.lines.length - 1; }
    if (fromName && S.unk) {
      const z = findSize(sizeId);
      db.upcScan(A.cid, S.unk, z && z.it.id).catch(() => { /* still sells */ });
      S.unk = null;
    }
    S.just = sizeId; S.nq = ''; S.nhi = 0; S.clear = 0;
    X.render();
    const box = q('[data-cto="' + i + '"]'); if (box) { box.focus(); box.select(); }
  }
  function doRepeat() {
    const S = C(), s = S.sale;
    if (!S.last || !s) return;
    const ok = S.last.lines.filter((l) => findSize(l.size_id));
    ok.forEach((l) => { const n = +l.ordered || +l.shipped || 1, ex = s.lines.find((x) => x.size_id === l.size_id); if (ex) { ex.ordered += n; if (!ex.se) ex.shipped = ex.ordered; } else s.lines.push({ size_id: l.size_id, ordered: n, shipped: n, se: false }); });
    X.say(ok.length < S.last.lines.length ? 'Added ' + ok.length + ' of ' + S.last.lines.length + ' lines from invoice ' + S.last.number + ' (the rest aren’t in your items now)' : 'Added invoice ' + S.last.number + '’s ' + ok.length + ' lines');
    S.last = null; X.render(); focusScan();
  }
  function findSize(id) { for (const it of A.items || []) for (const z of it.sizes || []) if (z.id === id) return { it, z }; return null; }
  function focusScan() { setTimeout(() => { const b = q('#ct-scan'); if (b) b.focus(); }, 0); }
  function scanEnter(v) {
    const S = C(), t = v.trim();
    if (!t) return;
    const m = nameMatches(t);
    if (m.length) return addSize(m[Math.min(S.nhi, m.length - 1)].z.id, true);
    const code = cleanUpc(t);
    if (/^[\d\s-]+$/.test(t) && code.length >= 6) {
      const f = findUpc(A.items, code);
      if (f) { S.unk = null; return addSize(f.z.id); }
      S.unk = code; S.nq = '';
      db.upcScan(A.cid, code).catch(() => { /* still sells */ });
      X.render(); focusScan();
    }
  }
  function updNums() {
    const pl = priced();
    pl.lines.forEach((l, i) => {
      const p = q('#ct-pr-' + i), t = q('#ct-tt-' + i), n = q('#ct-nt-' + i), sh = q('[data-cts="' + i + '"]');
      if (p) p.textContent = $(l.unit_price);
      if (t) t.textContent = $(l.total);
      if (n) { const nt = noteOf(l); n.textContent = nt[1]; n.className = 'ctnote ' + nt[0]; }
      if (sh) { if (document.activeElement !== sh) sh.value = l.shipped; sh.classList.toggle('short', l.shipped < l.ordered); }
    });
    groups(pl).forEach((g) => { const e = q('#ct-g-' + g.k); if (e) e.textContent = groupLabel(pl, g); });
    const tt = q('#ct-total'); if (tt) tt.textContent = $(pl.total);
    const ct = q('#ct-count'); if (ct) ct.textContent = pl.count + ' ' + plural('item', pl.count) + ' · ' + pl.lines.length + ' ' + plural('line', pl.lines.length);
  }
  const wire = (s) => s.lines.map((l) => ({ size_id: l.size_id, ordered: l.ordered, shipped: l.shipped }));
  async function save(action, extra) {
    const S = C(), s = S.sale;
    S.busy = true;
    try {
      const r = await db.saleSave(A.cid, Object.assign({ id: s.id || undefined, customer_id: s.customer_id, lines: wire(s), action }, extra || {}));
      S.busy = false;
      return r;
    } catch (e) {
      S.busy = false;
      const er = q('#ct-perr'); if (er) er.textContent = e.message; else { X.say(e.message, true); X.render(); }
      return null;
    }
  }

  function bind() {
    X.load();
    loadSusp();
    loadReviewCount();
    const S = C();
    const g = (id, fn) => { const e = q(id); if (e) e.onclick = fn; };
    g('#ct-new', () => { S.step = 'find'; S.q = ''; S.hi = 0; S.sale = null; X.render(); setTimeout(() => { const b = q('#ct-cq'); if (b) b.focus(); }, 0); });
    g('#ct-resume', () => { S.step = 'resume'; loadSusp(true); X.render(); });
    g('#ct-invoices', () => { A.view = 'invoices'; X.render(); });
    g('#ct-back', () => { S.step = S.sale && S.sale.lines.length ? 'sale' : 'home'; X.render(); });
    g('#ct-home', () => reset());
    g('#ct-next', () => { reset(); S.step = 'find'; A.ct.step = 'find'; X.render(); setTimeout(() => { const b = q('#ct-cq'); if (b) b.focus(); }, 0); });
    $$('[data-ctopen]').forEach((e) => { e.onclick = () => {
      const s = (C().susp || []).find((x) => x.id === e.dataset.ctopen);
      if (!s) return;
      if (dirty() && !window.confirm('Leave this sale without saving it?')) return;
      openSale(s);
    }; });

    // find the customer
    const cq = q('#ct-cq');
    if (cq) {
      cq.oninput = () => { S.q = cq.value; S.hi = 0; q('#ct-cres').innerHTML = custRowsHtml(); bindCustRows(); };
      cq.onkeydown = (e) => {
        const m = custMatches(S.q);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!m.length) return; S.hi = (S.hi + (e.key === 'ArrowDown' ? 1 : m.length - 1)) % m.length; q('#ct-cres').innerHTML = custRowsHtml(); bindCustRows(); }
        if (e.key === 'Enter' && m[S.hi]) { e.preventDefault(); startSale(m[S.hi]); }
      };
      bindCustRows();
    }
    function bindCustRows() { $$('[data-ctc]').forEach((b) => { b.onclick = () => startSale((A.custs || []).find((c) => c.id === b.dataset.ctc)); }); }

    if (S.step !== 'sale' || !S.sale) return;
    const s = S.sale;
    g('#ct-change', () => { S.step = 'find'; S.q = ''; X.render(); setTimeout(() => { const b = q('#ct-cq'); if (b) b.focus(); }, 0); });
    $$('[data-ctshow]').forEach((b) => { b.onclick = () => {
      const c = cust(), k = b.dataset.ctshow, v = q('#ct-v-' + k);
      if (!c || !v) return;
      v.textContent = k === 'owes' ? $(c.owes || 0) : $(Math.round(((c.credit_limit || 0) - (c.owes || 0)) * 100) / 100);
      clearTimeout(v._t); v._t = setTimeout(() => { v.textContent = '•••'; }, 5000);
    }; });
    const sc = q('#ct-scan');
    if (sc) {
      sc.oninput = () => { S.nq = sc.value; S.nhi = 0; q('#ct-sres').innerHTML = nameRowsHtml(); bindNameRows(); };
      sc.onkeydown = (e) => {
        const m = nameMatches(S.nq);
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && m.length) { e.preventDefault(); S.nhi = (S.nhi + (e.key === 'ArrowDown' ? 1 : m.length - 1)) % m.length; q('#ct-sres').innerHTML = nameRowsHtml(); bindNameRows(); }
        if (e.key === 'Enter') { e.preventDefault(); scanEnter(sc.value); }
        if (e.key === 'Escape') { sc.value = ''; S.nq = ''; q('#ct-sres').innerHTML = ''; }
      };
    }
    function bindNameRows() { $$('[data-ctadd]').forEach((b) => { b.onclick = () => addSize(b.dataset.ctadd, true); }); }
    bindNameRows();
    g('#ct-unk-x', () => { S.unk = null; X.render(); focusScan(); });
    g('#ct-repeat', doRepeat);
    const qty = (v) => { const n = parseInt(String(v).replace(/\D/g, ''), 10); return isFinite(n) ? n : 0; };
    $$('[data-cto]').forEach((b) => {
      b.oninput = () => { const l = s.lines[+b.dataset.cto]; l.ordered = qty(b.value); if (!l.se) l.shipped = l.ordered; S.just = null; updNums(); };
      b.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); S.just = null; focusScan(); } };
    });
    $$('[data-cts]').forEach((b) => {
      b.oninput = () => { const l = s.lines[+b.dataset.cts]; l.shipped = qty(b.value); l.se = l.shipped !== l.ordered; updNums(); };
      b.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); focusScan(); } };
    });
    $$('[data-ctsz]').forEach((b) => { b.onclick = () => { const [i, z] = b.dataset.ctsz.split('|'); s.lines[+i].size_id = z; X.render(); }; });
    $$('[data-ctrm]').forEach((b) => { b.onclick = () => { s.lines.splice(+b.dataset.ctrm, 1); X.render(); focusScan(); }; });
    const lw = q('#ct-licwhy'); if (lw) lw.oninput = () => { S.lic = lw.value; };
    g('#ct-clear', async () => {
      if (!S.clear) { S.clear = 1; X.render(); setTimeout(() => { if (C().clear) { C().clear = 0; if (A.view === 'counter') X.render(); } }, 4000); return; }
      if (!s.id) return reset('Sale cleared');
      const r = await save('cancel'); if (r) reset('Sale cancelled');
    });
    g('#ct-suspend', async () => {
      if (!s.lines.length) { X.say('Scan at least one item first', true); return X.render(); }
      const r = await save('suspend', { lic_reason: S.lic }); if (r) reset('Suspended · ' + r.customer.name + ' · finish it by closing');
    });
    g('#ct-review', () => {
      if (!s.lines.length) { X.say('Scan at least one item first', true); return X.render(); }
      S.panel = 'review'; S.why = licWarn().length && sets().lic_mode === 'ask' ? ['License'] : []; S.note = ''; X.render();
    });
    g('#ct-complete', () => {
      const bad = saleCheck(priced()); if (bad) { X.say(bad, true); return X.render(); }
      S.panel = 'complete'; X.render(); setTimeout(() => { const b = q('#ct-licwhy2') || q('#ct-post'); if (b) b.focus(); }, 0);
    });
    g('#ct-pback', () => { S.panel = null; X.render(); });
    $$('[data-ctwhy]').forEach((b) => { b.onclick = () => { const w = b.dataset.ctwhy, i = S.why.indexOf(w); if (i >= 0) S.why.splice(i, 1); else S.why.push(w); b.classList.toggle('on', i < 0); }; });
    const rn = q('#ct-rnote'); if (rn) rn.oninput = () => { S.note = rn.value; };
    const l2 = q('#ct-licwhy2'); if (l2) { l2.oninput = () => { S.lic = l2.value; }; l2.onkeydown = (e) => { if (e.key === 'Enter') q('#ct-post').click(); }; }
    g('#ct-rsend', async () => {
      const why = S.why.concat(S.note.trim() ? [S.note.trim()] : []).join(' · ');
      if (!why) { q('#ct-perr').textContent = 'Pick what the manager should check, or type a note.'; return; }
      const r = await save('review', { why, lic_reason: S.lic }); if (r) reset('Sent for review · ' + r.customer.name);
    });
    g('#ct-post', async () => {
      const warn = licWarn();
      if (warn.length && !S.lic.trim()) { q('#ct-perr').textContent = 'Say why you’re selling without the license. It goes in the customer’s History.'; return; }
      q('#ct-post').disabled = true;
      const r = await save('complete', { lic_reason: warn.length ? S.lic.trim() : '' });
      if (!r) { const b = q('#ct-post'); if (b) b.disabled = false; return; }
      const susp = S.susp; A.ct = fresh(); A.ct.susp = susp; A.ct.step = 'done'; A.ct.done = { number: r.number, total: r.total }; X.say('');
      A.rvn = null; A.ivs = null; A.stoday = null; loadSusp(true); X.load(true); X.render();
    });
  }

  // ---------- Review page (owners and managers) ----------
  function reviewHtml() {
    if (!X.isMgr()) return '<h1>Review</h1><div class="card"><p class="sm">Only owners and managers see sales sent for review.</p></div>';
    const R = A.rv;
    if (!R) return '<h1>Review</h1><div class="card"><p class="sm">Loading…</p></div>';
    const row = (s, kind) => '<tr data-rvopen="' + s.id + '" class="ctpick" data-guide="review-list-row"><td><b>' + esc(s.customer.name) + '</b><small>' + esc(s.customer.store_no ? 'Store #' + s.customer.store_no : '') + '</small></td>' +
      '<td>' + esc(s.by_name || '—') + '<small>' + esc(when(kind === 'review' ? s.sent_at : s.created_at)) + '</small></td>' +
      '<td>' + (kind === 'review' ? esc(s.why) : '<span class="tag need">Suspended and not finished</span>') + '</td><td class="n">' + s.units + '</td><td class="n">' + $(s.total) + '</td></tr>';
    const all = R.review.map((s) => row(s, 'review')).concat(R.old.map((s) => row(s, 'old')));
    return '<div class="hdr"><h1>Review<span class="count">' + all.length + '</span></h1></div>' +
      '<p class="sm gap">Sales sent to you from the Counter, and suspended sales from an earlier day. Open one to fix it and complete it.</p>' +
      '<div class="tcard"><table class="t"><thead><tr><th>Customer</th><th>Sent by</th><th>What to check</th><th class="n">Items</th><th class="n">Total</th></tr></thead><tbody>' +
      (all.length ? all.join('') : '<tr><td colspan="5" class="empty">Nothing to review. ✓</td></tr>') + '</tbody></table></div>';
  }
  function bindReview() {
    X.load();
    if (!X.isMgr()) return;
    if (!A.rv) {
      const cid = A.cid;
      Promise.all([db.sales(cid, 'review'), db.sales(cid, 'suspended')]).then(([r, s]) => {
        if (A.cid !== cid) return;
        A.rv = { review: r, old: s.filter(pastDue) }; A.rvn = r.length + A.rv.old.length;
        if (A.view === 'review') X.render();
      }).catch((e) => { A.rv = { review: [], old: [] }; X.say(e.message, true); X.render(); });
      return;
    }
    $$('[data-rvopen]').forEach((e) => { e.onclick = () => {
      const s = A.rv.review.concat(A.rv.old).find((x) => x.id === e.dataset.rvopen);
      A.rv = null; openSale(s);
    }; });
  }

  // ---------- Invoices (a simple list for now) ----------
  function invRows() {
    const I = A.ivs, t = I.q.trim().toLowerCase();
    const l = I.list.filter((s) => !t || String(s.number) === t.replace(/^#/, '') || s.customer.name.toLowerCase().includes(t) || (s.invoice_date || '').includes(t));
    if (!l.length) return '<tr><td colspan="6" class="empty">' + (I.list.length ? 'No invoice matches.' : 'No invoices yet. They show here once a sale is completed at the Counter.') + '</td></tr>';
    return l.map((s) => '<tr data-ivrow="' + s.id + '" class="ctpick' + (I.sel === s.id ? ' pick' : '') + '" data-guide="invoices-list-row"><td><b>' + s.number + '</b></td><td>' + esc(shortDate(s.invoice_date, true)) + '</td>' +
      '<td><b>' + esc(s.customer.name) + '</b><small>' + esc(s.customer.store_no ? 'Store #' + s.customer.store_no : '') + '</small></td><td class="n">' + s.units + '</td><td class="n">' + $(s.total) + '</td><td class="mut">' + esc(s.posted_by || '') + '</td></tr>').join('');
  }
  function invoicesHtml() {
    if (!A.ivs) return '<h1>Invoices</h1><div class="card"><p class="sm">Loading…</p></div>';
    const I = A.ivs, sel = I.sel && I.list.find((s) => s.id === I.sel);
    const table = '<div class="tcard"><table class="t"><thead><tr><th>Invoice #</th><th>Date</th><th>Customer</th><th class="n">Items</th><th class="n">Total</th><th>By</th></tr></thead><tbody id="iv-rows">' + invRows() + '</tbody></table></div>';
    const panel = sel ? '<aside class="card panel ivpan"><div class="hdr"><h2>Invoice ' + sel.number + '</h2><button class="x" id="iv-x" aria-label="Close" data-guide="invoices-invoice-close">×</button></div>' +
      '<p class="sm">' + esc(sel.customer.name) + ' · ' + esc(shortDate(sel.invoice_date, true)) + ' · charged to account</p>' +
      '<table class="t"><tbody>' + sel.lines.map((l) => '<tr><td><b>' + esc(l.name) + '</b><small>' + esc(l.size) + (l.shipped < l.ordered ? ' · ' + (l.ordered - l.shipped) + ' short' : '') + '</small></td><td class="n">' + l.shipped + ' × ' + $(l.unit_price) + '</td><td class="n"><b>' + $(l.total) + '</b></td></tr>').join('') +
      '<tr><td><b>Total</b></td><td></td><td class="n"><b>' + $(sel.total) + '</b></td></tr></tbody></table>' +
      (sel.lic_reason ? '<p class="sm">Sold without a license: ' + esc(sel.lic_reason) + '</p>' : '') + '<p class="sm">Printing and emailing come next.</p></aside>' : '';
    return '<div class="hdr"><h1>Invoices<span class="count">' + I.list.length + '</span></h1></div>' +
      '<div class="bar"><input class="inp q" id="iv-q" type="search" placeholder="Invoice #, customer or date (2026-11-27)" value="' + esc(I.q) + '" data-guide="invoices-list-search"></div>' +
      (sel ? '<div class="wrap2">' + table + panel + '</div>' : table);
  }
  function bindInvoices() {
    if (!A.ivs) {
      const cid = A.cid;
      db.sales(cid, 'posted').then((l) => { if (A.cid !== cid) return; A.ivs = { list: l, q: '', sel: null }; if (A.view === 'invoices') X.render(); })
        .catch((e) => { A.ivs = { list: [], q: '', sel: null }; X.say(e.message, true); X.render(); });
      return;
    }
    const iq = q('#iv-q'); iq.oninput = () => { A.ivs.q = iq.value; q('#iv-rows').innerHTML = invRows(); rows(); };
    function rows() { $$('[data-ivrow]').forEach((r) => { r.onclick = () => { A.ivs.sel = r.dataset.ivrow; X.render(); }; }); }
    rows();
    const x = q('#iv-x'); if (x) x.onclick = () => { A.ivs.sel = null; X.render(); };
  }

  // ---------- Items → Barcodes to add ----------
  function bcHtml() {
    const back = '<button class="lnk back" id="bc-back" data-guide="barcodes-back">‹ Items</button>';
    if (!X.isMgr()) return back + '<h1>Barcodes to add</h1><div class="card"><p class="sm">Only owners and managers add barcodes.</p></div>';
    if (!A.bc) return back + '<h1>Barcodes to add</h1><div class="card"><p class="sm">Loading…</p></div>';
    const P = A.bcp;
    const pick = (u) => {
      if (!P || P.upc !== u.upc) return '';
      const it = P.item && (A.items || []).find((x) => x.id === P.item);
      const free = it ? it.sizes.filter((z) => !z.upc) : [];
      return '<tr class="bcpick"><td colspan="4"><div class="bcrow">' +
        (it ? '<b>' + esc(it.name) + '</b>' + (free.length ? '<select class="sel" id="bc-size" data-guide="barcodes-pick-size">' + free.map((z) => opt(z.id, z.name + (z.n > 1 ? ' · ' + z.n : ''), z.id === P.size)).join('') + '</select>' +
          '<button class="btn sm amber" id="bc-add" data-guide="barcodes-pick-add">Add barcode</button>' : '<span class="miss">Every size already has a barcode. Add a size to the item first.</span>') +
          '<button class="lnk" id="bc-other" data-guide="barcodes-pick-other">Pick another item</button>'
          : '<input class="inp" id="bc-q" placeholder="Type the item name" value="' + esc(P.q) + '" data-guide="barcodes-pick-search"><span id="bc-res" class="bcres">' + bcRes() + '</span>') +
        '<button class="btn sm" id="bc-cancel" data-guide="barcodes-pick-cancel">Cancel</button></div></td></tr>';
    };
    const rows = A.bc.length ? A.bc.map((u) => '<tr><td><b>' + esc(upcShow(u.upc)) + '</b></td><td>' + u.times + ' ' + plural('time', u.times) + ' · last ' + esc(when(u.last_at)) + (u.last_by ? ' · ' + esc(u.last_by) : '') + '</td>' +
      '<td>' + (u.sold_as_name ? '<b>' + esc(u.sold_as_name) + '</b><small>picked by name at the counter' + (u.sold_by ? ' · ' + esc(u.sold_by) : '') + '</small>' : '<span class="mut">Not sold</span>') + '</td>' +
      '<td class="r">' + (u.sold_as ? '<button class="btn sm amber" data-bcto="' + u.upc + '|' + u.sold_as + '" data-guide="barcodes-add-sold-as">Add to ' + esc(u.sold_as_name) + '</button> ' : '') +
      '<button class="btn sm" data-bcpick="' + u.upc + '" data-guide="barcodes-add-to-item">' + (u.sold_as ? 'Other item…' : 'Add to an item…') + '</button> ' +
      '<button class="btn sm" data-bcig="' + u.upc + '" data-guide="barcodes-ignore">Ignore</button></td></tr>' + pick(u)).join('')
      : '<tr><td colspan="4" class="empty">No barcodes waiting. ✓</td></tr>';
    return back + '<div class="hdr"><h1>Barcodes to add<span class="count">' + A.bc.length + '</span></h1></div>' +
      '<p class="sm gap">Barcodes scanned at the Counter that no item has. Add each to the right item and size.</p>' +
      '<div class="tcard"><table class="t"><thead><tr><th>Barcode</th><th>Scanned</th><th>Sold as</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function bcRes() {
    const t = (A.bcp.q || '').trim().toLowerCase();
    if (t.length < 2) return '';
    return (A.items || []).filter((it) => it.name.toLowerCase().includes(t)).slice(0, 6)
      .map((it) => '<button class="chip" data-bcit="' + it.id + '" data-guide="barcodes-pick-item">' + esc(it.name) + '</button>').join('') || '<span class="mut">No item matches.</span>';
  }
  function bindBc() {
    X.load();
    const back = q('#bc-back'); if (back) back.onclick = () => { A.view = 'items'; A.bcp = null; X.render(); };
    if (!X.isMgr()) return;
    if (!A.bc) {
      const cid = A.cid;
      db.upcList(cid).then((l) => { if (A.cid !== cid) return; A.bc = l; if (A.view === 'barcodes') X.render(); }).catch((e) => { A.bc = []; X.say(e.message, true); X.render(); });
      return;
    }
    const done = async (upc, action, size) => {
      try { A.bc = await db.upcDone(A.cid, upc, action, size); A.bcp = null; A.items = null; X.say(action === 'add' ? '✓ Barcode added' : 'Barcode ignored'); } catch (e) { X.say(e.message, true); }
      X.render();
    };
    const setItem = (itemId, upc) => {
      const it = (A.items || []).find((x) => x.id === itemId), free = it ? it.sizes.filter((z) => !z.upc) : [];
      A.bcp = { upc, q: '', item: itemId, size: (free[0] || {}).id || null };
    };
    $$('[data-bcto]').forEach((b) => { b.onclick = () => {
      const [upc, item] = b.dataset.bcto.split('|');
      setItem(item, upc);
      const it = (A.items || []).find((x) => x.id === item), free = it ? it.sizes.filter((z) => !z.upc) : [];
      if (free.length === 1) return done(upc, 'add', free[0].id);
      X.render();
    }; });
    $$('[data-bcpick]').forEach((b) => { b.onclick = () => { A.bcp = { upc: b.dataset.bcpick, q: '', item: null, size: null }; X.render(); const i = q('#bc-q'); if (i) i.focus(); }; });
    $$('[data-bcig]').forEach((b) => { b.onclick = () => done(b.dataset.bcig, 'ignore'); });
    const bq = q('#bc-q');
    if (bq) bq.oninput = () => { A.bcp.q = bq.value; q('#bc-res').innerHTML = bcRes(); bindRes(); };
    function bindRes() { $$('[data-bcit]').forEach((b) => { b.onclick = () => { setItem(b.dataset.bcit, A.bcp.upc); X.render(); }; }); }
    bindRes();
    const bs = q('#bc-size'); if (bs) bs.onchange = () => { A.bcp.size = bs.value; };
    const ba = q('#bc-add'); if (ba) ba.onclick = () => done(A.bcp.upc, 'add', A.bcp.size);
    const bo = q('#bc-other'); if (bo) bo.onclick = () => { A.bcp.item = null; X.render(); };
    const bx = q('#bc-cancel'); if (bx) bx.onclick = () => { A.bcp = null; X.render(); };
  }

  return { html, bind, reviewHtml, bindReview, invoicesHtml, bindInvoices, bcHtml, bindBc, dirty, loadReviewCount };
}
