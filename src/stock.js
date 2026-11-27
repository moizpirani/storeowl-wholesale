// Phase 4: the Stock page — Receive (supplier invoices) · Stock · Counts · Suppliers.
// Part 1 builds "Type it in": pick the supplier → invoice #, date, total → scan or search each item (barcode, name, your
// item # or their item #) → how many → cost → the lines must add up to the invoice total → Receive. Anyone can receive a
// delivery into stock (Moiz, 2026-11-27); only an OWNER changes costs and prices — an owner picks what happens to prices
// when they receive, anyone else's cost changes wait in "Costs to check" for an owner.
// A barcode that isn't on any item: managers make the item right there, or link the barcode to an item they have.
// Typing never redraws the page: boxes update the numbers around them in place.

import { money, dollars, todayIso, shortDate, cleanUpc, upcShow, plural, scanSize, sellSizes, sells, mainSize, findSizeIn,
  recvLineTotal, recvTotal, recvCheck, recvCosts, movePrice, catName } from './rules.js';

const CATS = [['cigarettes', 'Cigarettes'], ['cigars', 'Cigars & cigarillos'], ['otp', 'Other tobacco'], ['snuff', 'Snuff & dip'], ['pouches', 'Pouches'],
  ['vapor', 'Vapor'], ['hemp', 'Hemp'], ['beer', 'Beer'], ['other', 'Other']];
const UNIT_OF = { cigarettes: 'pack', cigars: 'cigarillo', otp: 'pouch', snuff: 'can', pouches: 'can', vapor: 'device', hemp: 'pack', beer: 'can', other: 'each' };

export function makeStock(X) {
  const { A, db, root, esc, opt } = X;
  const q = (s) => root.querySelector(s);
  const $$ = (s) => Array.from(root.querySelectorAll(s));
  const $ = (v) => (v == null || v === '' || isNaN(v) ? '—' : dollars(+v));
  const fresh = () => ({ tab: 'recv', list: null, sups: null, stock: null, ed: null, done: null, view: null, cw: null, sq: '', sf: 'all', busy: false });
  const K = () => A.sk || (A.sk = fresh());
  const items = () => A.items || [];
  const owner = () => X.isOwner(), mgr = () => X.isMgr();

  // ---------- data ----------
  function load(force) {
    X.load();
    const S = K(), cid = A.cid;
    if (S.list && S.sups && !force) return;
    Promise.all([db.receivings(cid), db.suppliers(cid)]).then(([l, s]) => { if (A.cid !== cid) return; S.list = l; S.sups = s; if (A.view === 'stock') X.render(); })
      .catch((e) => { S.list = S.list || []; S.sups = S.sups || []; X.say(e.message, true); X.render(); });
  }
  function loadStock() {
    const S = K(), cid = A.cid;
    db.stock(cid).then((l) => { if (A.cid !== cid) return; S.stock = l; if (A.view === 'stock' && S.tab === 'stock') X.render(); }).catch((e) => { S.stock = []; X.say(e.message, true); });
  }
  const supOf = (id) => (K().sups || []).find((s) => s.id === id) || null;
  const learned = (supId, it) => { const s = supOf(supId); if (!s) return null; const ids = (it.sizes || []).map((z) => z.id); return s.items.find((x) => ids.includes(x.size_id)) || null; };
  const waitingCosts = () => (K().list || []).filter((r) => r.status === 'received' && r.costs === 'waiting');

  // ---------- page ----------
  function html() {
    const S = K(); load();
    if (S.ed) return editorHtml();
    if (S.done) return doneHtml();
    const drafts = (S.list || []).filter((r) => r.status === 'draft');
    const tabs = '<nav class="ctabs">' + [['recv', 'Receive', drafts.length + (owner() ? waitingCosts().length : 0)], ['stock', 'Stock'], ['counts', 'Counts'], ['sup', 'Suppliers']]
      .map(([k, n, c]) => '<button class="' + (S.tab === k ? 'on' : '') + '" data-sktab="' + k + '" data-guide="stock-page-tab">' + n + (c ? '<em>' + c + '</em>' : '') + '</button>').join('') + '</nav>';
    const head = '<div class="hdr"><h1>Stock</h1><button class="btn amber" id="sk-type" data-guide="stock-page-receive">+ Receive an invoice</button></div>';
    let body;
    if (!S.list) body = '<div class="card"><p class="sm">Loading…</p></div>';
    else if (S.tab === 'recv') body = recvTabHtml(drafts);
    else if (S.tab === 'stock') body = stockTabHtml();
    else if (S.tab === 'counts') body = '<div class="card soon"><b>Counts come next</b><span>Count a shelf from your phone; what was off goes into History.</span></div>';
    else body = supTabHtml();
    return head + tabs + body + (S.cw ? costsWinHtml() : '');
  }

  // ----- Receive tab -----
  function recvTabHtml(drafts) {
    const S = K();
    const way = (k, ic, b, t, live) => '<button class="rvway' + (live ? ' live' : '') + '" data-skway="' + k + '" data-guide="stock-receive-way">' +
      '<span class="rvic">' + ic + '</span><b>' + b + '</b><span>' + t + '</span>' + (live ? '' : '<em>Coming next</em>') + '</button>';
    const ways = '<div class="rvways">' + way('photo', '📷', 'Photo or PDF', 'Take a picture of the paper invoice. It’s read for you.') +
      way('email', '✉️', 'Forward the email', 'Send it to your own receiving address.') + way('file', '📄', 'Supplier file', 'An invoice file from your supplier, read exactly.') +
      way('scan', '▦', 'Scan the boxes', 'Scan each box, or type how many in a stack.') + way('type', '⌨️', 'Type it in', 'Enter the lines yourself: item, how many, cost.', true) + '</div>';
    const row = (r, extra) => '<tr data-skopen="' + r.id + '"><td>' + esc(r.status === 'draft' ? X.when(r.updated_at) : shortDate(r.inv_date, true)) + '</td><td><span class="tag grey">' + esc(howName(r.how)) + '</span></td>' +
      '<td><b>' + esc(r.supplier) + '</b><small>' + (r.number ? 'Invoice ' + esc(r.number) + ' · ' : '') + r.lines.length + ' ' + plural('line', r.lines.length) + '</small></td>' +
      '<td class="n"><b>' + $(r.inv_total != null ? r.inv_total : r.total) + '</b></td><td>' + extra + '</td><td class="acsub">' + esc(r.status === 'draft' ? r.by_name : r.received_by) + '</td></tr>';
    const wait = drafts.length ? '<h2 class="sec">Waiting for you to check</h2><div class="cc"><table class="t tsm actab"><thead><tr><th>Saved</th><th>How</th><th>Supplier · invoice</th><th class="n">Invoice total</th><th>Status</th><th>By</th></tr></thead><tbody>' +
      drafts.map((r) => row(r, offTag(r))).join('') + '</tbody></table></div>' : '';
    const wc = owner() ? waitingCosts() : [];
    const costs = wc.length ? '<h2 class="sec">Costs to check</h2><p class="sm mut rvnote">Received by someone else. Costs and prices change only when you say so.</p><div class="cc"><table class="t tsm actab"><thead><tr><th>Date</th><th>Supplier · invoice</th><th>What changed</th><th>Received by</th><th></th></tr></thead><tbody>' +
      wc.map((r) => '<tr><td>' + esc(shortDate(r.inv_date, true)) + '</td><td><b>' + esc(r.supplier) + '</b><small>Invoice ' + esc(r.number) + '</small></td><td>' + costSummary(r.cost_changes.list || []) + '</td><td class="acsub">' + esc(r.received_by) + '</td>' +
        '<td class="n"><button class="btn sm amber" data-skcost="' + r.id + '" data-guide="stock-receive-check-costs">Check costs</button></td></tr>').join('') + '</tbody></table></div>' : '';
    const recd = (S.list || []).filter((r) => r.status === 'received' || r.status === 'undone');
    const done = '<h2 class="sec">Received</h2>' + (recd.length ? '<div class="cc"><table class="t tsm actab"><thead><tr><th>Date</th><th>How</th><th>Supplier · invoice</th><th class="n">Total</th><th>Status</th><th>By</th></tr></thead><tbody>' +
      recd.map((r) => row(r, r.status === 'undone' ? '<span class="tag bad">Taken back</span>' : '<span class="tag ok">✓ In stock</span>' + (r.costs === 'waiting' ? ' <span class="tag need">Costs to check</span>' : ''))).join('') + '</tbody></table></div>'
      : '<div class="card"><p class="emptyc">No supplier invoices received yet. Tap Type it in to receive your first one.</p></div>');
    const view = S.view && (S.list || []).find((r) => r.id === S.view);
    return ways + costs + wait + (view ? viewHtml(view) : '') + done;
  }
  const howName = (h) => ({ typed: 'Typed in', photo: 'Photo', email: 'Email', file: 'Supplier file', scan: 'Scanned' }[h] || h);
  function offTag(r) {
    if (r.inv_total == null) return '<span class="tag need">No invoice total</span>';
    const d = Math.round((r.total - r.inv_total) * 100) / 100;
    return d ? '<span class="tag need">Off by ' + dollars(Math.abs(d)) + '</span>' : '<span class="tag ok">✓ Ready to receive</span>';
  }
  function costSummary(list) {
    const its = {}; list.forEach((c) => { if (!its[c.item_id] || c.n < its[c.item_id].n) its[c.item_id] = c; });
    const l = Object.values(its);
    if (!l.length) return '<span class="mut">Nothing</span>';
    return l.slice(0, 3).map((c) => esc(c.name) + ' <span class="' + (c.before != null && c.after > c.before ? 'rvup' : 'rvdn') + '">' + arrow(c) + '</span>').join('<br>') + (l.length > 3 ? '<br><span class="mut">+ ' + (l.length - 3) + ' more</span>' : '');
  }
  const arrow = (c) => c.before == null ? 'new cost ' + $(c.after) : (c.after > c.before ? '▲ ' : '▼ ') + $(Math.abs(c.after - c.before)) + ' a ' + esc(String(c.size).toLowerCase());
  // A received invoice, read only, with Undo for managers.
  function viewHtml(r) {
    const S = K();
    return '<div class="card rvview"><div class="hdr"><h2>' + esc(r.supplier) + ' · invoice ' + esc(r.number) + '</h2><button class="x" id="sk-vx" aria-label="Close" data-guide="stock-received-close">×</button></div>' +
      '<p class="sm">' + esc(shortDate(r.inv_date, true)) + ' · ' + esc(howName(r.how)) + ' · received by ' + esc(r.received_by) + ' ' + esc(X.when(r.received_at)) +
      (r.status === 'undone' ? ' · <span class="bad">taken back by ' + esc(r.undone_by) + '</span>' : '') + '</p>' +
      '<table class="t tsm"><thead><tr><th>Item</th><th>Unit</th><th class="n">How many</th><th class="n">Cost each</th><th class="n">Line</th></tr></thead><tbody>' +
      r.lines.map((l) => '<tr><td><b>' + esc(l.name) + '</b>' + (l.their_no ? '<small>Their item # ' + esc(l.their_no) + '</small>' : '') + '</td><td>' + esc(unitText(l.unit, l.per, l.size)) + '</td><td class="n">' + l.qty + '</td><td class="n">' + $(l.cost) + '</td><td class="n">' + $(l.line) + '</td></tr>').join('') +
      '<tr><td colspan="4"><b>Total</b></td><td class="n"><b>' + $(r.total) + '</b></td></tr></tbody></table>' +
      (r.costs === 'done' ? '<p class="sm">Costs updated · prices ' + ({ same: 'moved by the same amount', margin: 'kept the same margin', none: 'not changed' }[(r.cost_changes || {}).mode] || '') + '</p>' : '') +
      (r.costs === 'kept' ? '<p class="sm">Costs weren’t changed.</p>' : '') +
      (r.status === 'received' && mgr() ? (S.undo === r.id
        ? '<div class="ivvoidask"><b>Take invoice ' + esc(r.number) + ' back out of stock?</b><p class="sm">Use this for a mistake. Costs and prices already changed stay as they are.</p><div class="rowr"><button class="btn" id="sk-uno" data-guide="stock-received-undo-cancel">Keep it</button><button class="btn red" id="sk-uyes" data-guide="stock-received-undo-confirm">Take it back</button></div></div>'
        : '<button class="lnk bad" id="sk-undo" data-guide="stock-received-undo">Take this invoice back out of stock…</button>') : '') + '</div>';
  }
  const unitText = (u, per, size) => (+per > 1 ? u + ' (' + per + ' ' + plural(String(size).toLowerCase(), +per) + ')' : u);

  // ----- Stock tab -----
  function stockTabHtml() {
    const S = K();
    if (!S.stock) { loadStock(); return '<div class="card"><p class="sm">Loading…</p></div>'; }
    const by = {}; S.stock.forEach((s) => { by[s.item_id] = s; });
    const rows = items().filter((it) => it.active !== false).map((it) => ({ it, s: by[it.id] || { on_hand: 0, set_aside: 0, can_sell: 0 }, z: mainSize(it) }));
    const neg = rows.filter((r) => +r.s.on_hand < 0).length, out = rows.filter((r) => +r.s.can_sell <= 0).length;
    const show = (v, r) => { const n = r.z ? r.z.n : 1, w = Math.trunc(+v / n), rest = +v - w * n;
      return (+v < 0 ? '<span class="bad">' : '') + w + (rest ? '<small>+ ' + Math.abs(rest) + ' ' + esc(plural(r.it.unit || 'each', Math.abs(rest))) + '</small>' : '') + (+v < 0 ? '</span>' : ''); };
    const f = S.sf;
    const list = rows.filter((r) => f === 'all' || (f === 'out' && +r.s.can_sell <= 0) || (f === 'neg' && +r.s.on_hand < 0));
    return '<div class="kpis rvkpis"><div class="kb nv"><span>Items</span><b>' + rows.length + '</b><small>with stock counted in their smallest unit</small></div>' +
      '<div class="kb"><span>Out</span><b>' + out + '</b><small>nothing left to sell</small></div><div class="kb"><span>Count these</span><b>' + neg + '</b><small>went below zero</small></div></div>' +
      '<div class="acbar"><div class="seg">' + [['all', 'All'], ['out', 'Out'], ['neg', 'Count these']].map(([k, n]) => '<button class="' + (f === k ? 'on' : '') + '" data-sksf="' + k + '" data-guide="stock-stock-filter">' + n + '</button>').join('') + '</div>' +
      '<input class="inp acq" id="sk-sq" type="search" placeholder="Item, barcode or item #" value="' + esc(S.sq) + '" data-guide="stock-stock-search"></div>' +
      '<div class="cc"><table class="t tsm actab"><thead><tr><th>Item</th><th>Shown in</th><th class="n">On the shelf</th><th class="n">Set aside</th><th class="n">Can sell</th></tr></thead><tbody id="sk-rows">' +
      (list.length ? list.map((r) => '<tr data-s="' + esc((r.it.name + ' ' + (r.it.item_no || '') + ' ' + r.it.sizes.map((z) => z.upc).join(' ')).toLowerCase()) + '"><td><b>' + esc(r.it.name) + '</b><small>Counted in ' + esc(plural(r.it.unit || 'each', 2)) + '</small></td>' +
        '<td>' + esc(r.z ? r.z.name : '') + '</td><td class="n">' + show(r.s.on_hand, r) + '</td><td class="n">' + show(r.s.set_aside, r) + '</td><td class="n"><b>' + show(r.s.can_sell, r) + '</b></td></tr>').join('')
        : '<tr><td colspan="5" class="empty">Nothing here</td></tr>') + '</tbody></table><p class="fmsg" id="sk-none" hidden>No item matches</p></div>' +
      '<p class="sm mut rvnote">Can sell = on the shelf − set aside for suspended sales and sales sent for review.</p>';
  }

  // ----- Suppliers tab -----
  function supTabHtml() {
    const S = K(), sups = S.sups || [];
    const ed = S.sed;
    const form = ed ? '<div class="card rvsup"><label class="fld"><span>Supplier name</span><input class="inp" id="sp-name" value="' + esc(ed.name) + '" data-guide="stock-suppliers-name"></label>' +
      '<div class="g2"><label class="fld"><span>Phone</span><input class="inp" id="sp-phone" value="' + esc(ed.phone || '') + '" data-guide="stock-suppliers-phone"></label><label class="fld"><span>Email</span><input class="inp" id="sp-email" value="' + esc(ed.email || '') + '" data-guide="stock-suppliers-email"></label></div>' +
      '<p class="fmsg bad" id="sp-err"></p><div class="rowr"><button class="btn" id="sp-cancel" data-guide="stock-suppliers-cancel">Cancel</button><button class="btn amber" id="sp-save" data-guide="stock-suppliers-save">' + (ed.id ? 'Save' : 'Add supplier') + '</button></div></div>' : '';
    return '<div class="acbar"><span class="sm mut">The companies you buy from. Each one’s item numbers and units are learned from their invoices.</span><span class="sp"></span>' +
      '<button class="btn" id="sp-add" data-guide="stock-suppliers-add">+ Add a supplier</button></div>' + form +
      '<div class="cc"><table class="t tsm actab"><thead><tr><th>Supplier</th><th>Last invoice</th><th class="n">Items learned</th><th>Phone · email</th><th></th></tr></thead><tbody>' +
      (sups.length ? sups.map((s) => '<tr><td><b>' + esc(s.name) + '</b></td><td>' + (s.last ? esc(shortDate(s.last.date, true)) + ' · ' + esc(s.last.number) : '<span class="mut">None yet</span>') + '</td>' +
        '<td class="n">' + s.items.length + '</td><td class="acsub">' + esc([s.phone, s.email].filter(Boolean).join(' · ')) + '</td><td class="n">' + (mgr() ? '<button class="lnk" data-spedit="' + s.id + '" data-guide="stock-suppliers-edit">Change</button>' : '') + '</td></tr>').join('')
        : '<tr><td colspan="5" class="empty">No suppliers yet. They’re added when you receive their first invoice.</td></tr>') + '</tbody></table></div>';
  }

  // =====================================================================
  // Type it in
  // =====================================================================
  function startEd(r) {
    const S = K();
    S.ed = r ? { id: r.id, supplier_id: r.supplier_id, sq: r.supplier, number: r.number, inv_date: r.inv_date, inv_total: r.inv_total == null ? '' : String(r.inv_total),
      lines: r.lines.map((l) => ({ size_id: l.size_id, unit: l.unit, per: l.per, qty: String(l.qty), cost: l.cost == null ? '' : String(l.cost), their_no: l.their_no || '' })),
      q: '', hi: 0, unk: null, err: '' }
      : { supplier_id: null, sq: '', number: '', inv_date: todayIso(), inv_total: '', lines: [], q: '', hi: 0, unk: null, err: '' };
    S.done = null; S.view = null; X.render();
    setTimeout(() => { const b = q(S.ed.supplier_id ? '#rv-q' : '#rv-sup'); if (b) b.focus(); }, 0);
  }
  const E = () => K().ed;
  function editorHtml() {
    const e = E(), sup = supOf(e.supplier_id);
    const top = '<div class="hdr"><h1>Type in a supplier invoice</h1></div>' +
      '<div class="rvbar"><button class="btn sm" id="rv-back" data-guide="stock-type-back">‹ Back</button>' +
      '<label class="f rvrel"><span>Supplier</span><input class="inp" id="rv-sup" autocomplete="off" placeholder="Pick or type a supplier" value="' + esc(sup ? sup.name : e.sq) + '" data-guide="stock-type-supplier">' +
      '<div class="rvdd" id="rv-sdd"' + (e.supOpen ? '' : ' hidden') + '>' + supResHtml() + '</div></label>' +
      '<label class="f"><span>Invoice #</span><input class="inp" id="rv-num" placeholder="On their invoice" value="' + esc(e.number) + '" data-guide="stock-type-number"></label>' +
      '<label class="f"><span>Date</span><input class="inp" id="rv-date" type="date" value="' + esc(e.inv_date) + '" data-guide="stock-type-date"></label>' +
      '<label class="f"><span>Invoice total</span><input class="inp rvr" id="rv-tot" inputmode="decimal" placeholder="Bottom of the invoice" value="' + esc(e.inv_total) + '" data-guide="stock-type-total"></label>' +
      '<span class="sp"></span><span class="tag grey">Typed in</span></div>';
    const off = !e.supplier_id;
    const lines = e.lines.map(lineRow).join('');
    const add = '<tr class="rvadd"><td colspan="6"><div class="rvrel"><input class="inp rvq" id="rv-q" autocomplete="off" placeholder="' + (off ? 'Pick the supplier first' : 'Scan a barcode or type an item name, item # or their item #') + '" value="' + esc(e.q) + '"' + (off ? ' disabled' : '') + ' data-guide="stock-type-find">' +
      '<div class="rvdd" id="rv-res"' + (e.q.trim().length >= 2 && !e.unk ? '' : ' hidden') + '>' + itemResHtml() + '</div></div></td></tr>';
    const table = '<div class="cc rvlines"><table class="t tsm actab"><thead><tr><th>Item</th><th>Unit</th><th class="n">How many</th><th class="n">Cost each</th><th class="n">Line</th><th></th></tr></thead><tbody>' +
      (e.lines.length || !off ? '' : '<tr><td colspan="6" class="empty">Lines come after you pick the supplier</td></tr>') + lines + add + '</tbody></table></div>';
    const body = e.unk ? '<div class="rvside">' + table + unkHtml() + '</div>' : table;
    return top + body + totHtml() + (K().cw ? costsWinHtml() : '');
  }
  function supResHtml() {
    const e = E(), t = (e.sq || '').trim().toLowerCase();
    const l = (K().sups || []).filter((s) => !t || s.name.toLowerCase().includes(t)).slice(0, 6);
    return l.map((s, i) => '<button class="rvres' + (i === 0 ? ' on' : '') + '" data-rvsup="' + s.id + '" data-guide="stock-type-supplier-pick"><b>' + esc(s.name) + '</b><small>' + (s.last ? 'Last invoice ' + esc(shortDate(s.last.date, true)) + ' · ' + esc(s.last.number) : 'No invoices yet') + '</small></button>').join('') +
      (t && !l.some((s) => s.name.toLowerCase() === t) ? '<button class="rvres new" id="rv-supnew" data-guide="stock-type-supplier-new">+ New supplier “' + esc(e.sq.trim()) + '”</button>' : '');
  }
  // Items for the search box: barcode, name words, your item # or their item #. One row per item, using the size they learned.
  function itemMatches(t) {
    t = String(t || '').trim().toLowerCase();
    if (t.length < 2) return [];
    const e = E(), sup = supOf(e.supplier_id), words = t.split(/\s+/), out = [];
    const theirs = {}; ((sup && sup.items) || []).forEach((x) => { if (x.their_no) theirs[x.size_id] = x.their_no.toLowerCase(); });
    for (const it of items()) {
      if (it.active === false || !sellSizes(it).length) continue;
      const tn = it.sizes.map((z) => theirs[z.id] || '').join(' ');
      const hay = (it.name + ' ' + (it.item_no || '') + ' ' + tn).toLowerCase();
      if (words.every((w) => hay.includes(w))) out.push(it);
      if (out.length >= 8) break;
    }
    return out;
  }
  function itemResHtml() {
    const e = E(), m = itemMatches(e.q);
    if (!m.length) return '<div class="rvres none">No item matches. Scan its barcode to add it.</div>';
    return m.map((it, i) => {
      const lx = learned(e.supplier_id, it), sup = supOf(e.supplier_id);
      const z = lx ? findSizeIn([it], lx.size_id) : null;
      const sub = lx ? 'Last from ' + esc(sup.name) + ': ' + esc(unitText(lx.unit, lx.per, z ? z.z.name : '')) + (lx.last_cost != null && mgr() ? ' · ' + $(lx.last_cost) : '') + (lx.their_no ? ' · their item # ' + esc(lx.their_no) : '')
        : 'Never bought from ' + esc(sup ? sup.name : 'this supplier');
      return '<button class="rvres' + (i === Math.min(e.hi, m.length - 1) ? ' on' : '') + '" data-rvit="' + it.id + '" data-guide="stock-type-item-pick"><b>' + esc(it.name) + ' · ' + esc((mainSize(it) || {}).name || '') + '</b><small>' + sub + '</small></button>';
    }).join('');
  }
  // The units a line can be in: each size you sell, the unit learned from this supplier, or a case of N.
  function unitOptions(l) {
    const f = findSizeIn(items(), l.size_id); if (!f) return [];
    const o = sellSizes(f.it).map((z) => ({ v: z.id + '|1|' + z.name, t: z.name + (z.n > 1 ? ' (' + z.n + ' ' + plural(f.it.unit || 'each', z.n) + ')' : '') }));
    if (+l.per > 1) o.unshift({ v: l.size_id + '|' + l.per + '|' + l.unit, t: unitText(l.unit, l.per, f.z.name) });
    o.push({ v: 'case', t: 'Case of …' });
    return o;
  }
  function lineRow(l, i) {
    const f = findSizeIn(items(), l.size_id);
    if (!f) return '<tr><td colspan="5" class="bad">This item isn’t in your list any more</td><td class="n"><button class="xb" data-rvrm="' + i + '" aria-label="Take this line off" data-guide="stock-type-line-remove">×</button></td></tr>';
    const cur = l.size_id + '|' + (+l.per || 1) + '|' + l.unit;
    const lc = lineCost(l, f);
    const caseBox = l.caseEd ? '<span class="rvcase">Case of <input class="bx s" inputmode="numeric" data-rvcn="' + i + '" value="' + esc(l.per > 1 ? l.per : '') + '" data-guide="stock-type-line-case-count"> ' + esc(plural(String(f.z.name).toLowerCase(), 2)) + '</span>' : '';
    return '<tr data-rvline="' + i + '"><td><b>' + esc(f.it.name) + '</b><small>' + esc(f.z.name) + (f.z.n > 1 ? ' · ' + f.z.n + ' ' + esc(plural(f.it.unit || 'each', f.z.n)) : '') +
      (l.their_no ? ' · their # ' + esc(l.their_no) : '') + '<span id="rv-ln-' + i + '">' + lc + '</span></small></td>' +
      '<td><select class="sel" data-rvu="' + i + '" data-guide="stock-type-line-unit">' + unitOptions(l).map((o) => opt(o.v, o.t, o.v === cur)).join('') + '</select>' + caseBox + '</td>' +
      '<td class="n"><input class="bx s rvn" inputmode="numeric" data-rvqty="' + i + '" value="' + esc(l.qty) + '" data-guide="stock-type-line-qty"></td>' +
      '<td class="n"><input class="bx m rvn" inputmode="decimal" data-rvcost="' + i + '" value="' + esc(l.cost) + '" placeholder="Cost" data-guide="stock-type-line-cost"></td>' +
      '<td class="n"><b id="rv-lt-' + i + '">' + $(recvLineTotal(l)) + '</b></td>' +
      '<td class="n"><button class="xb" data-rvrm="' + i + '" aria-label="Take this line off" data-guide="stock-type-line-remove">×</button></td></tr>';
  }
  // "▲ $1.10 a carton" against what the size costs now (owners and managers see costs).
  function lineCost(l, f) {
    if (!mgr() || l.cost === '' || isNaN(l.cost) || f.z.cost == null) return '';
    const now = +l.cost / ((+l.per || 1)), d = Math.round((now - f.z.cost) * 100) / 100;
    if (Math.abs(d) < 0.005) return '';
    return ' · <span class="' + (d > 0 ? 'rvup' : 'rvdn') + '">' + (d > 0 ? '▲ ' : '▼ ') + dollars(Math.abs(d)) + ' a ' + esc(String(f.z.name).toLowerCase()) + '</span>';
  }
  function totHtml() {
    const e = E(), t = recvTotal(e.lines), it = e.inv_total === '' ? null : +e.inv_total;
    const bad = recvCheck(rcv(), items());
    let msg;
    if (it == null || isNaN(it)) msg = '<span class="mut">Type the invoice total to check the lines</span>';
    else if (Math.round(t * 100) === Math.round(it * 100)) msg = '<span class="ok2">✓ Totals match</span>';
    else msg = '<span class="miss">Off by ' + dollars(Math.abs(t - it)) + (t < it ? ' — a line is missing?' : ' — a line is too much?') + '</span>';
    return '<div class="rvtot" id="rv-tbar"><span class="rvtl">Lines add up to <b id="rv-sum">' + $(t) + '</b> · invoice total <b id="rv-isum">' + (it == null || isNaN(it) ? '—' : $(it)) + '</b></span>' +
      '<span id="rv-tmsg">' + msg + '</span><p class="fmsg bad" id="rv-err">' + esc(e.err || '') + '</p>' +
      (e.id ? '<button class="lnk bad" id="rv-del" data-guide="stock-type-delete">Delete</button>' : '') +
      '<button class="btn" id="rv-later" data-guide="stock-type-save-later"' + (e.supplier_id ? '' : ' disabled') + '>Save for later</button>' +
      '<button class="btn amber" id="rv-recv" data-guide="stock-type-receive"' + (bad ? ' disabled' : '') + '>Receive</button></div>';
  }
  const rcv = () => { const e = E(); return { id: e.id, supplier_id: e.supplier_id, number: e.number, inv_date: e.inv_date, inv_total: e.inv_total === '' ? '' : +e.inv_total, lines: e.lines.map((l) => ({ size_id: l.size_id, unit: l.unit, per: +l.per || 1, qty: l.qty === '' ? '' : +l.qty, cost: l.cost === '' ? '' : +l.cost, their_no: l.their_no })) }; };
  // Only the numbers around a box change while typing.
  function updNums() {
    const e = E();
    e.lines.forEach((l, i) => {
      const t = q('#rv-lt-' + i); if (t) t.textContent = $(recvLineTotal(l));
      const n = q('#rv-ln-' + i), f = findSizeIn(items(), l.size_id); if (n && f) n.innerHTML = lineCost(l, f);
    });
    const tb = q('#rv-tbar'); if (!tb) return;
    const fresh = document.createElement('div'); fresh.innerHTML = totHtml();
    const nb = fresh.firstChild;
    ['#rv-sum', '#rv-isum', '#rv-tmsg'].forEach((s) => { q(s).innerHTML = nb.querySelector(s).innerHTML; });
    q('#rv-recv').disabled = nb.querySelector('#rv-recv').disabled;
  }

  // ----- a barcode no item has -----
  function unkHtml() {
    const e = E(), u = e.unk;
    if (!mgr()) return '<aside class="card rvpan"><h2>Not in your items</h2><p class="sm">Barcode <b>' + esc(upcShow(u.code)) + '</b> isn’t on any item. Ask a manager to add it, then finish this invoice — <b>Save for later</b> keeps it.</p>' +
      '<div class="rowr"><button class="btn" id="rv-ux" data-guide="stock-type-unknown-close">Close</button></div></aside>';
    const tabs = '<div class="seg rvseg"><button class="' + (u.mode === 'new' ? 'on' : '') + '" data-rvum="new" data-guide="stock-type-unknown-tab">New item</button><button class="' + (u.mode === 'link' ? 'on' : '') + '" data-rvum="link" data-guide="stock-type-unknown-tab">Link to an item I have</button></div>';
    let body;
    if (u.mode === 'new') {
      body = '<p class="sm mut">From this line. Prices can wait — it shows in Items until they’re set.</p>' +
        '<label class="fld"><span>Barcode</span><input class="inp" id="un-upc" value="' + esc(u.code) + '" data-guide="stock-type-new-upc"></label>' +
        '<label class="fld"><span>Name</span><input class="inp" id="un-name" value="' + esc(u.name) + '" data-guide="stock-type-new-name"></label>' +
        '<div class="g2"><label class="fld"><span>Category</span><select class="sel" id="un-cat" data-guide="stock-type-new-category">' + CATS.map(([k, n]) => opt(k, n, k === u.cat)).join('') + '</select></label>' +
        '<label class="fld"><span>Counted in</span><input class="inp" id="un-unit" value="' + esc(u.unit) + '" data-guide="stock-type-new-unit"></label></div>' +
        '<div class="g2"><label class="fld"><span>This size</span><input class="inp" id="un-size" value="' + esc(u.size) + '" data-guide="stock-type-new-size"></label>' +
        '<label class="fld"><span>Holds</span><input class="inp" id="un-n" inputmode="numeric" value="' + esc(u.n) + '" data-guide="stock-type-new-holds"></label></div>' +
        '<label class="fld"><span>Their item # (' + esc((supOf(e.supplier_id) || {}).name || '') + ')</span><input class="inp" id="un-their" value="' + esc(u.their) + '" data-guide="stock-type-new-their-no"></label>' +
        '<p class="fmsg bad" id="un-err"></p><div class="rowr"><button class="btn" id="rv-ux" data-guide="stock-type-unknown-close">Cancel</button><button class="btn amber" id="un-save" data-guide="stock-type-new-save">Add to this invoice</button></div>';
    } else {
      const it = u.item && items().find((x) => x.id === u.item);
      body = '<p class="sm mut">Barcode <b>' + esc(upcShow(u.code)) + '</b> isn’t on any item yet.</p>' +
        '<label class="fld"><span>Find the item</span><input class="inp" id="ul-q" autocomplete="off" value="' + esc(u.lq) + '" data-guide="stock-type-link-find"></label><div id="ul-res">' + linkResHtml() + '</div>' +
        (it ? '<p class="sm rvh">Which size is this barcode on?</p>' + it.sizes.map((z) => '<label class="rvopt' + (u.size_id === z.id ? ' on' : '') + '"><input type="radio" name="ul-z" value="' + z.id + '"' + (u.size_id === z.id ? ' checked' : '') + ' data-guide="stock-type-link-size">' +
          '<span><b>' + esc(z.name) + (z.n > 1 ? ' · ' + z.n : '') + (sells(z) ? '' : ' · not sold') + '</b><small>' + (z.upc ? 'Barcode ' + esc(upcShow(z.upc)) + '<em>Already has one — this is added as a second barcode</em>' : 'No barcode yet') + '</small></span></label>').join('') +
          '<label class="fld"><span>Their item # (' + esc((supOf(e.supplier_id) || {}).name || '') + ')</span><input class="inp" id="ul-their" value="' + esc(u.their) + '" data-guide="stock-type-link-their-no"></label>' : '') +
        '<p class="fmsg bad" id="un-err"></p><div class="rowr"><button class="btn" id="rv-ux" data-guide="stock-type-unknown-close">Cancel</button><button class="btn amber" id="ul-save" data-guide="stock-type-link-save"' + (it && u.size_id ? '' : ' disabled') + '>Link and add to invoice</button></div>' +
        '<p class="sm mut">From now on this barcode finds the item everywhere: here and at the Counter.</p>';
    }
    return '<aside class="card rvpan">' + tabs + body + '</aside>';
  }
  function linkResHtml() {
    const u = E().unk, t = (u.lq || '').trim().toLowerCase();
    if (t.length < 2) return '';
    const l = items().filter((it) => (it.name + ' ' + (it.item_no || '')).toLowerCase().includes(t)).slice(0, 5);
    return l.map((it) => '<button class="rvres' + (u.item === it.id ? ' on' : '') + '" data-ulit="' + it.id + '" data-guide="stock-type-link-pick"><b>' + esc(it.name) + '</b><small>' + (it.item_no ? 'Item # ' + esc(it.item_no) + ' · ' : '') + 'sizes: ' + esc(it.sizes.map((z) => z.name).join(' · ')) + '</small></button>').join('') || '<div class="rvres none">No item matches</div>';
  }

  // ----- costs window (owners): what happens to prices when costs change -----
  function costsWinHtml() {
    const w = K().cw, L = ((X.co() || {}).levels || []);
    const show = w.list.filter((c, i, a) => a.findIndex((y) => y.item_id === c.item_id) === i || true);
    const rows = show.map((c) => '<tr><td><b>' + esc(c.name) + ' · ' + esc(c.size) + '</b><small>' + $(c.before) + ' → ' + $(c.after) + '</small></td><td class="n ' + (c.before != null && c.after > c.before ? 'rvup' : 'rvdn') + '">' +
      (c.before == null ? 'new' : (c.after > c.before ? '+' : '−') + dollars(Math.abs(c.after - c.before))) + '</td>' +
      L.map((l) => { const p = c.prices[l.n]; const np = movePrice(p, c.before, c.after, w.mode);
        return '<td class="n">' + (p == null ? '—' : $(p) + (np !== p ? ' → <b>' + $(np) + '</b>' : '')) + '</td>'; }).join('') + '</tr>').join('');
    const op = (k, b, t) => '<label class="rvopt' + (w.mode === k ? ' on' : '') + '"><input type="radio" name="cw-mode" value="' + k + '"' + (w.mode === k ? ' checked' : '') + ' data-guide="stock-costs-mode"><span><b>' + b + '</b><small>' + t + '</small></span></label>';
    const n = new Set(w.list.map((c) => c.item_id)).size;
    const ex = w.list.find((c) => c.before != null && Math.abs(c.after - c.before) >= 0.005);
    const exd = ex ? dollars(Math.abs(ex.after - ex.before)) : '$1.00', exw = ex && ex.after < ex.before ? 'down' : 'up';
    return '<div class="ctmodal rvmodal"><div class="card rvwin"><h2>Costs ' + (w.list.some((c) => c.before == null || c.after > c.before) ? 'went up' : 'changed') + ' on ' + n + ' ' + plural('item', n) + '</h2>' +
      '<p class="sm mut">From invoice ' + esc(w.number) + '. Your prices don’t change unless you say so.</p>' +
      '<div class="cc rvcw"><table class="t tsm"><thead><tr><th>Item</th><th class="n">Cost</th>' + L.map((l) => '<th class="n">' + esc(l.name) + '</th>').join('') + '</tr></thead><tbody id="cw-rows">' + rows + '</tbody></table></div>' +
      '<div class="rvopts">' + op('same', 'Add the same amount to every price', 'Cost ' + exw + ' ' + exd + ' → every level ' + exw + ' ' + exd) + op('margin', 'Keep the same margin', 'Each level keeps its % over cost') +
      op('none', 'Don’t change my prices', 'Only the cost is updated') + (w.rid ? op('keep', 'Don’t change the costs either', 'Leave costs and prices as they are') : '') + '</div>' +
      (w.rid ? '' : '<p class="sm mut">Prices change when you tap Receive.</p>') +
      '<p class="fmsg bad" id="cw-err"></p><div class="rowr"><button class="btn" id="cw-back" data-guide="stock-costs-back">Back</button><button class="btn amber" id="cw-ok" data-guide="stock-costs-confirm">' + (w.rid ? 'Use these' : 'Receive and use these prices') + '</button></div></div></div>';
  }

  // ----- done -----
  function doneHtml() {
    const r = K().done;
    const ch = (r.cost_changes && r.cost_changes.list) || [], n = new Set(ch.map((c) => c.item_id)).size;
    const costLine = r.costs === 'done' ? n + ' · prices ' + ({ same: 'moved by the same amount', margin: 'kept the same margin', none: 'not changed' }[r.cost_changes.mode] || '')
      : r.costs === 'waiting' ? n + ' · <span class="miss">waiting for an owner to check</span>' : 'None';
    return '<div class="hdr"><h1>Stock</h1></div><div class="card rvdone"><div class="rvbig">✓</div><h2>Invoice ' + esc(r.number) + ' is in stock</h2>' +
      '<p class="sm mut">' + esc(r.supplier) + ' · ' + esc(shortDate(r.inv_date, true)) + ' · received by ' + esc(r.received_by) + '</p>' +
      '<table class="t tsm rvdt"><tbody><tr><td>Lines</td><td class="n">' + r.lines.length + '</td></tr><tr><td>Total</td><td class="n"><b>' + $(r.total) + '</b></td></tr>' +
      '<tr><td>Costs changed</td><td class="n">' + costLine + '</td></tr></tbody></table>' +
      '<div class="rowr rvc"><button class="btn" id="dn-list" data-guide="stock-done-back">Back to Receive</button><button class="btn amber" id="dn-next" data-guide="stock-done-next">Type another invoice</button></div>' +
      '<p class="sm mut">A manager can take it back out of stock from the Received list if it was a mistake. Everything is in History.</p></div>';
  }

  // =====================================================================
  // binding
  // =====================================================================
  function bind() {
    const S = K();
    if (S.ed) return bindEd();
    if (S.done) {
      q('#dn-list').onclick = () => { S.done = null; X.render(); };
      q('#dn-next').onclick = () => startEd(null);
      return;
    }
    $$('[data-sktab]').forEach((b) => { b.onclick = () => { S.tab = b.dataset.sktab; S.view = null; if (S.tab === 'stock') S.stock = null; X.render(); }; });
    q('#sk-type').onclick = () => startEd(null);
    $$('[data-skway]').forEach((b) => { b.onclick = () => { if (b.dataset.skway === 'type') startEd(null); else { X.say('Coming next. For now, use Type it in.'); X.render(); } }; });
    $$('[data-skopen]').forEach((tr) => { tr.onclick = () => {
      const r = (S.list || []).find((x) => x.id === tr.dataset.skopen); if (!r) return;
      if (r.status === 'draft') return startEd(r);
      S.view = S.view === r.id ? null : r.id; S.undo = null; X.render();
    }; });
    $$('[data-skcost]').forEach((b) => { b.onclick = (ev) => { ev.stopPropagation();
      const r = S.list.find((x) => x.id === b.dataset.skcost); S.cw = { rid: r.id, number: r.number, mode: 'same', list: recvCosts(r.lines, items()) }; X.render(); }; });
    const vx = q('#sk-vx'); if (vx) vx.onclick = () => { S.view = null; X.render(); };
    const ud = q('#sk-undo'); if (ud) ud.onclick = () => { S.undo = S.view; X.render(); };
    const un = q('#sk-uno'); if (un) un.onclick = () => { S.undo = null; X.render(); };
    const uy = q('#sk-uyes'); if (uy) uy.onclick = async () => {
      try { await db.receivingUndo(A.cid, S.view); S.undo = null; S.stock = null; X.say('Invoice taken back out of stock'); load(true); } catch (e) { X.say(e.message, true); X.render(); }
    };
    // Stock tab
    $$('[data-sksf]').forEach((b) => { b.onclick = () => { S.sf = b.dataset.sksf; X.render(); }; });
    const sq = q('#sk-sq'); if (sq) { sq.oninput = () => { S.sq = sq.value; filterStock(); }; filterStock(); }
    // Suppliers tab
    const sa = q('#sp-add'); if (sa) sa.onclick = () => { S.sed = { name: '', phone: '', email: '' }; X.render(); const i = q('#sp-name'); if (i) i.focus(); };
    $$('[data-spedit]').forEach((b) => { b.onclick = () => { const s = supOf(b.dataset.spedit); S.sed = { id: s.id, name: s.name, phone: s.phone, email: s.email }; X.render(); }; });
    if (S.sed) {
      ['name', 'phone', 'email'].forEach((k) => { const i = q('#sp-' + k); if (i) i.oninput = () => { S.sed[k] = i.value; }; });
      q('#sp-cancel').onclick = () => { S.sed = null; X.render(); };
      q('#sp-save').onclick = async () => {
        try { await db.supplierPut(A.cid, S.sed); S.sed = null; X.say('✓ Supplier saved'); load(true); }
        catch (e) { q('#sp-err').textContent = e.message; }
      };
    }
    if (S.cw) bindCw();
  }
  function filterStock() {
    const t = (K().sq || '').trim().toLowerCase(); let n = 0;
    $$('#sk-rows tr[data-s]').forEach((tr) => { const ok = !t || tr.dataset.s.includes(t); tr.hidden = !ok; if (ok) n++; });
    const none = q('#sk-none'); if (none) none.hidden = !(t && !n);
  }

  function bindEd() {
    const S = K(), e = E();
    q('#rv-back').onclick = () => {
      if ((e.lines.length || e.number) && !window.confirm('This invoice isn’t saved. Leave it? (Save for later keeps it.)')) return;
      S.ed = null; X.render();
    };
    // Supplier: type to search; Enter or a tap picks; + New supplier adds it.
    const sb = q('#rv-sup');
    const sdd = q('#rv-sdd');
    sb.onfocus = () => { e.supOpen = true; sdd.innerHTML = supResHtml(); sdd.hidden = false; bindSupRes(); };
    sb.oninput = () => { e.sq = sb.value; if (e.supplier_id) { e.supplier_id = null; } e.supOpen = true; sdd.innerHTML = supResHtml(); sdd.hidden = false; bindSupRes(); };
    sb.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); const f = sdd.querySelector('[data-rvsup]'), nw = sdd.querySelector('#rv-supnew'); if (f && f.classList.contains('on')) pickSup(f.dataset.rvsup); else if (nw) newSup(); } };
    sb.onblur = () => { setTimeout(() => { if (q('#rv-sdd')) q('#rv-sdd').hidden = true; e.supOpen = false; }, 150); };
    function bindSupRes() {
      $$('[data-rvsup]').forEach((b) => { b.onmousedown = (ev) => ev.preventDefault(); b.onclick = () => pickSup(b.dataset.rvsup); });
      const nw = q('#rv-supnew'); if (nw) { nw.onmousedown = (ev) => ev.preventDefault(); nw.onclick = newSup; }
    }
    function pickSup(id) { e.supplier_id = id; e.sq = supOf(id).name; e.supOpen = false; X.render(); const n = q(e.number ? '#rv-q' : '#rv-num'); if (n) n.focus(); }
    async function newSup() {
      try { const s = await db.supplierPut(A.cid, { name: e.sq.trim() }); S.sups = (S.sups || []).concat(s); pickSup(s.id); X.say('✓ Supplier added'); }
      catch (er) { e.err = er.message; X.render(); }
    }
    [['#rv-num', 'number'], ['#rv-date', 'inv_date'], ['#rv-tot', 'inv_total']].forEach(([s, k]) => {
      const i = q(s); i.oninput = () => { e[k] = i.value.replace(k === 'inv_total' ? /[$,\s]/g : /^$/, ''); updNums(); };
      i.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); const nx = { number: '#rv-date', inv_date: '#rv-tot', inv_total: '#rv-q' }[k]; const b = q(nx); if (b) b.focus(); } };
    });
    // Find an item.
    const fb = q('#rv-q'), res = q('#rv-res');
    if (fb) {
      fb.oninput = () => { e.q = fb.value; e.hi = 0; const show = e.q.trim().length >= 2 && !/^[\d\s-]+$/.test(e.q.trim()); res.hidden = !show; if (show) { res.innerHTML = itemResHtml(); bindRes(); } };
      fb.onkeydown = (ev) => {
        const m = itemMatches(e.q);
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); e.hi = Math.max(0, Math.min(m.length - 1, e.hi + (ev.key === 'ArrowDown' ? 1 : -1))); res.innerHTML = itemResHtml(); bindRes(); return; }
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        const t = e.q.trim(); if (!t) return;
        const code = cleanUpc(t);
        if (/^[\d\s-]+$/.test(t) && code.length >= 6) {
          const f = scanSize(items(), code);
          if (f) return addItem(f.it, f.z, f.pack);
          if (m.length === 1) return addItem(m[0]);   // their item # typed as digits
          e.unk = { code, mode: 'new', name: '', cat: 'cigarettes', unit: 'pack', size: 'Carton', n: '10', their: '', lq: '', item: null, size_id: null };
          e.q = ''; X.render(); const nm = q('#un-name'); if (nm) nm.focus();
          return;
        }
        if (m.length) addItem(m[Math.min(e.hi, m.length - 1)]);
      };
      bindRes();
    }
    function bindRes() { $$('[data-rvit]').forEach((b) => { b.onmousedown = (ev) => ev.preventDefault(); b.onclick = () => addItem(items().find((x) => x.id === b.dataset.rvit)); }); }
    // Lines.
    $$('[data-rvqty]').forEach((i) => {
      const k = +i.dataset.rvqty;
      i.oninput = () => { e.lines[k].qty = i.value.trim(); updNums(); };
      i.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); const c = q('[data-rvcost="' + k + '"]'); c.focus(); c.select(); } };
    });
    $$('[data-rvcost]').forEach((i) => {
      const k = +i.dataset.rvcost;
      i.oninput = () => { e.lines[k].cost = i.value.replace(/[$,\s]/g, ''); updNums(); };
      i.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); const b = q('#rv-q'); if (b) b.focus(); } };
    });
    $$('[data-rvu]').forEach((s) => { s.onchange = () => {
      const l = e.lines[+s.dataset.rvu];
      if (s.value === 'case') { l.caseEd = true; X.render(); const c = q('[data-rvcn="' + s.dataset.rvu + '"]'); if (c) c.focus(); return; }
      const [sid, per, ...u] = s.value.split('|'); l.size_id = sid; l.per = +per; l.unit = u.join('|'); l.caseEd = false; X.render();
    }; });
    $$('[data-rvcn]').forEach((i) => {
      i.oninput = () => { const l = e.lines[+i.dataset.rvcn], v = parseInt(i.value, 10); if (v >= 2) { l.per = v; l.unit = 'Case'; updNums(); } };
      // Leaving the box (or Enter) shows "Case (10 cartons)" in the unit list and moves on to How many.
      const done = () => { const k = +i.dataset.rvcn, l = e.lines[k]; if (+l.per >= 2) { l.caseEd = false; X.render(); const b = q('[data-rvqty="' + k + '"]'); if (b) { b.focus(); b.select(); } } };
      i.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); done(); } };
      i.onchange = done;
    });
    $$('[data-rvrm]').forEach((b) => { b.onclick = () => { e.lines.splice(+b.dataset.rvrm, 1); X.render(); }; });
    // Unknown barcode panel.
    if (e.unk) bindUnk();
    // Save.
    const del = q('#rv-del'); if (del) del.onclick = async () => {
      if (!window.confirm('Delete this saved invoice? Nothing went into stock from it.')) return;
      try { await db.receivingSave(A.cid, { id: e.id, action: 'delete' }); S.ed = null; X.say('Saved invoice deleted'); load(true); } catch (er) { X.say(er.message, true); }
    };
    q('#rv-later').onclick = () => save('draft');
    q('#rv-recv').onclick = () => {
      const bad = recvCheck(rcv(), items()); if (bad) { e.err = bad; q('#rv-err').textContent = bad; return; }
      const ch = owner() ? recvCosts(rcv().lines, items()) : [];
      if (ch.length) { S.cw = { number: e.number, mode: 'same', list: ch }; X.render(); return; }
      save('receive');
    };
    if (S.cw) bindCw();
  }
  // Add a line: the size and unit learned from this supplier, else the size scanned / the main size, at its cost now.
  function addItem(it, z, pack, their) {
    const e = E(); if (!it) return;
    const lx = learned(e.supplier_id, it);
    const lz = lx && findSizeIn([it], lx.size_id);
    let line;
    if (lz && sells(lz.z) && (!z || z.id === lz.z.id || pack)) line = { size_id: lz.z.id, unit: lx.unit || lz.z.name, per: lx.per || 1, cost: lx.last_cost == null ? '' : String(lx.last_cost), their_no: lx.their_no || '' };
    else { const zz = z && sells(z) ? z : mainSize(it); line = { size_id: zz.id, unit: zz.name, per: 1, cost: zz.cost == null ? '' : String(zz.cost), their_no: '' }; }
    const at = e.lines.findIndex((l) => l.size_id === line.size_id && +l.per === +line.per);
    let i = at;
    if (their) line.their_no = String(their).trim();
    if (at < 0) { line.qty = '1'; e.lines.push(line); i = e.lines.length - 1; }
    else e.lines[at].qty = String((+e.lines[at].qty || 0) + 1);
    e.q = ''; e.hi = 0; e.unk = null; e.err = '';
    if (pack) X.say('You scanned the pack barcode · added a ' + String(line.unit).toLowerCase());
    X.render();
    const b = q('[data-rvqty="' + i + '"]'); if (b) { b.focus(); b.select(); }
  }
  function bindUnk() {
    const e = E(), u = e.unk;
    q('#rv-ux').onclick = () => { e.unk = null; X.render(); const b = q('#rv-q'); if (b) b.focus(); };
    if (!mgr()) return;
    $$('[data-rvum]').forEach((b) => { b.onclick = () => { u.mode = b.dataset.rvum; X.render(); const f = q(u.mode === 'new' ? '#un-name' : '#ul-q'); if (f) f.focus(); }; });
    const err = (m) => { const x = q('#un-err'); if (x) x.textContent = m; };
    if (u.mode === 'new') {
      [['#un-upc', 'code'], ['#un-name', 'name'], ['#un-unit', 'unit'], ['#un-size', 'size'], ['#un-n', 'n'], ['#un-their', 'their']].forEach(([s, k]) => { const i = q(s); i.oninput = () => { u[k] = i.value; }; });
      q('#un-cat').onchange = (ev) => { u.cat = ev.target.value; const un = UNIT_OF[u.cat] || 'each'; if (!u.unitTyped) { u.unit = un; q('#un-unit').value = un; } };
      q('#un-unit').addEventListener('input', () => { u.unitTyped = true; });
      q('#un-save').onclick = async () => {
        if (!u.name.trim()) return err('Type the item’s name.');
        const n = parseInt(u.n, 10); if (!(n >= 1)) return err('How many in a ' + (u.size || 'size') + '? Type a whole number.');
        const sizes = [{ name: (u.size || 'Each').trim(), n, upc: cleanUpc(u.code), prices: {} }];
        try {
          const it = await db.itemPut(A.cid, { name: u.name.trim(), category: u.cat, unit: (u.unit || 'each').trim(), age: ['beer', 'other'].includes(u.cat) ? (u.cat === 'beer' ? 21 : 0) : 21, sizes });
          A.items = (A.items || []).concat(it);
          X.say('✓ ' + it.name + ' added to Items (no prices yet)');
          e.unk = null; addItem(it, it.sizes[0], false, u.their);
        } catch (er) { err(er.message); }
      };
    } else {
      const lq = q('#ul-q'), lr = q('#ul-res');
      lq.oninput = () => { u.lq = lq.value; lr.innerHTML = linkResHtml(); bindLink(); };
      const bindLink = () => $$('[data-ulit]').forEach((b) => { b.onclick = () => { u.item = b.dataset.ulit; const it = items().find((x) => x.id === u.item); const f = it.sizes.find((z) => !z.upc) || mainSize(it); u.size_id = f.id; X.render(); }; });
      bindLink();
      $$('input[name="ul-z"]').forEach((r) => { r.onchange = () => { u.size_id = r.value; X.render(); }; });
      const th = q('#ul-their'); if (th) th.oninput = () => { u.their = th.value; };
      const sv = q('#ul-save'); if (sv) sv.onclick = async () => {
        const it = items().find((x) => x.id === u.item);
        const p = JSON.parse(JSON.stringify(it));
        p.sizes = p.sizes.map((z) => { if (z.id === u.size_id) { if (z.upc) z.upcs = (z.upcs || []).concat(cleanUpc(u.code)); else z.upc = cleanUpc(u.code); } return z; });
        if (p.cost_hidden) p.sizes.forEach((z) => { delete z.cost; });
        try {
          const saved = await db.itemPut(A.cid, p);
          A.items = items().map((x) => (x.id === saved.id ? saved : x));
          const z = saved.sizes.find((y) => y.id === u.size_id);
          X.say('✓ Barcode linked to ' + saved.name);
          e.unk = null; addItem(saved, z, !sells(z), u.their);
        } catch (er) { err(er.message); }
      };
    }
  }
  function bindCw() {
    const S = K(), w = S.cw;
    $$('input[name="cw-mode"]').forEach((r) => { r.onchange = () => { w.mode = r.value; X.render(); }; });
    q('#cw-back').onclick = () => { S.cw = null; X.render(); };
    q('#cw-ok').onclick = async () => {
      if (w.rid) {
        try { await db.receivingCosts(A.cid, w.rid, w.mode); S.cw = null; A.items = null; X.say(w.mode === 'keep' ? 'Costs left as they were' : '✓ Costs updated'); X.load(true); load(true); }
        catch (er) { q('#cw-err').textContent = er.message; }
        return;
      }
      save('receive', w.mode);
    };
  }
  async function save(action, prices) {
    const S = K(), e = E();
    if (S.busy) return;
    S.busy = true;
    try {
      const r = await db.receivingSave(A.cid, Object.assign(rcv(), { action, how: 'typed', prices: prices || undefined }));
      S.cw = null; S.ed = null; S.stock = null;
      if (action === 'draft') { X.say('✓ Saved for later. It’s under “Waiting for you to check”.'); }
      else { S.done = r; if (r.costs === 'done') { A.items = null; X.load(true); } }
      load(true); X.render();
    } catch (er) { S.cw = null; e.err = er.message; X.render(); }
    S.busy = false;
  }

  return { html, bind, load, start: () => { K(); }, waitingCosts: () => (owner() ? waitingCosts().length : 0) };
}
