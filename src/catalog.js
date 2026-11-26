// Phase 1 screens: Items (list + item panel), Customers (list + full customer page), and the Settings tabs
// Price levels and License rules. Price levels have private names and are never shown at a glance on a customer's page
// (wholesalers open it in front of customers), only behind "Show".
// Typing never redraws: boxes keep their value in state on input and update the numbers around them in place.

import { stateName } from './states.js';
import {
  CATEGORIES, catName, TERMS, termName, LICENSES, licName, SIZE_NAMES, settingsOf, cleanUpc, upcShow, num, money, margin,
  licState, custIssues, licNeeded, custNeeds, licProblems, problemText, saleWarnings, custStateOf, licNeedCheck,
  suggestedLic, LIC_COVER_TEXT, SUGGEST_NOTE, photoMatch, breakLine, plural, itemIssues, mainSize, sizeLine, itemCheck, custCheck, levelsCheck, todayIso, shortDate, initials
} from './rules.js';

const PAGE = 200;

export function makeCatalog(X) {
  const { A, db, root, esc, opt, stateOptions } = X;
  const co = () => X.co();
  const levels = () => (co() || {}).levels || [];
  const lvName = (n) => (levels().find((l) => l.n === n) || {}).name || '—';
  const sets = () => settingsOf(co());
  const home = () => (co() || {}).home || '';
  const today = () => A.today || todayIso();
  const q = (s) => root.querySelector(s);
  const $$ = (s) => Array.from(root.querySelectorAll(s));
  const money$ = (v) => (v == null ? '' : '$' + money(v));
  const copy = (o) => JSON.parse(JSON.stringify(o));
  if (!A.it) A.it = { q: '', f: 'all', cat: '', sel: null, ed: null, orig: '', tab: 'item', err: '', more: PAGE };
  if (!A.cu) A.cu = { q: '', f: 'all', lvl: '', open: null, data: null, tab: 'overview', ed: null, orig: '', led: null, lorig: '', pq: '', note: '', err: '', more: PAGE };

  // ---------- loading ----------
  function load(force) {
    if (!A.cid) return;
    if (A.items && A.custs && !force) return;
    const cid = A.cid;
    Promise.all([db.items(cid), db.customers(cid)]).then(([it, cu]) => {
      if (A.cid !== cid) return;
      A.items = it; A.custs = cu; X.render();
    }).catch((e) => { A.items = A.items || []; A.custs = A.custs || []; X.say(e.message, true); X.render(); });
  }

  // =====================================================================
  // Items
  // =====================================================================
  const ITEM_KEYS = ['name', 'item_no', 'category', 'nacs', 'vendor', 'unit', 'ml', 'oz', 'age', 'active'];
  function itemDraft(it) {
    if (!it) return { name: '', item_no: '', category: 'cigarettes', nacs: '', vendor: '', unit: 'pack', ml: '', oz: '', age: 21, active: true, break_group: '',
      sizes: [{ name: 'Carton', n: 10, upc: '', cost: '', prices: {}, breaks: [] }] };
    const d = {}; ITEM_KEYS.forEach((k) => { d[k] = it[k] == null ? '' : it[k]; });
    d.id = it.id; d.break_group = it.break_group || '';
    const f2 = (v) => (v == null ? '' : Math.round(v * 100) === v * 100 ? Number(v).toFixed(2) : String(Number(v)));
    d.sizes = it.sizes.map((z) => ({ id: z.id, name: z.name, n: z.n, upc: z.upc, cost: f2(z.cost),
      prices: Object.fromEntries(Object.entries(z.prices || {}).map(([k, v]) => [k, f2(v)])),
      breaks: (z.breaks || []).map((b) => ({ min: String(b.min), off: f2(b.off) })) }));
    return d;
  }
  function itemMatch(it, Q) {
    if (!Q) return true;
    const w = Q.toLowerCase().split(/\s+/).filter(Boolean);
    const hay = (it.name + ' ' + it.item_no + ' ' + it.vendor + ' ' + catName(it.category)).toLowerCase();
    const u = cleanUpc(Q);
    if (u.length >= 4 && it.sizes.some((z) => z.upc.includes(u))) return true;
    return w.every((x) => hay.includes(x));
  }
  function itemsShown() {
    const S = A.it, L = levels();
    return (A.items || []).filter((it) => it.active !== false || S.f === 'off')
      .filter((it) => (S.f === 'off' ? it.active === false : true))
      .filter((it) => !S.cat || it.category === S.cat)
      .filter((it) => S.f !== 'need' || itemIssues(it, L).length)
      .filter((it) => S.f !== 'nophoto' || !it.photo_url)
      .filter((it) => itemMatch(it, S.q));
  }
  function itemRow(it, narrow) {
    const L = levels(), z = mainSize(it) || {}, iss = itemIssues(it, L);
    const name = '<div class="itn">' + thumb(it) + '<div><button class="nmb" data-itopen="' + it.id + '" data-guide="items-list-open"><i class="d' + (iss.length ? '' : ' no') + '"></i><b>' + esc(it.name) + '</b></button>' +
      '<span class="sub">' + esc(sizeLine(z, it.unit)) + (iss.length ? ' · <span class="miss">' + esc(iss.map((x) => x.t).join(', ')) + '</span>' : '') + '</span></div></div>';
    const cost = it.cost_hidden ? '' : '<td class="n">' + (z.cost != null ? money$(z.cost) : '<span class="miss">No cost</span>') + '</td>';
    const p1 = z.prices ? z.prices[L[0] && L[0].n] : null;
    if (narrow) return '<tr class="' + (A.it.sel === it.id ? 'pick' : '') + '" data-itrow="' + it.id + '"><td>' + name + '</td>' + cost + '<td class="n"><b>' + (p1 != null ? money$(p1) : '—') + '</b></td></tr>';
    const mg = margin(z.cost, p1);
    return '<tr data-itrow="' + it.id + '"><td>' + name + '</td><td class="mut">' + esc(catName(it.category)) + '</td><td class="mut">' + (z.upc ? esc(upcShow(z.upc)) : '<span class="miss">No UPC</span>') + '</td>' + cost +
      L.map((l, i) => '<td class="n">' + (z.prices && z.prices[l.n] != null ? (i === 0 ? '<b>' + money$(z.prices[l.n]) + '</b>' : money$(z.prices[l.n])) : '<span class="miss">—</span>') + '</td>').join('') +
      (it.cost_hidden ? '' : '<td class="n' + (mg != null && mg < 0 ? ' bad' : '') + '">' + (mg == null ? '—' : mg.toFixed(1) + '%') + '</td>') + '</tr>';
  }
  const thumb = (it) => (it.photo_url ? '<img class="tph" src="' + esc(it.photo_url) + '" alt="" loading="lazy">' : '<span class="tph0" aria-hidden="true">+</span>');
  function itemRowsHtml(narrow) {
    const list = itemsShown(), L = levels();
    const cols = narrow ? 2 + (A.items[0] && A.items[0].cost_hidden ? 0 : 1) : 3 + L.length + (A.items[0] && A.items[0].cost_hidden ? 0 : 2);
    if (!list.length) return '<tr><td colspan="' + cols + '" class="empty">' + ((A.items || []).length ? 'No items match.' : 'No items yet. Tap + Add item to start.') + '</td></tr>';
    return list.slice(0, A.it.more).map((it) => itemRow(it, narrow)).join('') +
      (list.length > A.it.more ? '<tr><td colspan="' + cols + '" class="empty"><button class="btn sm" id="it-more" data-guide="items-list-more">Show more</button></td></tr>' : '');
  }
  function itemsHtml() {
    if (!A.items) return '<h1>Items</h1><div class="card"><p class="sm">Loading…</p></div>';
    const S = A.it, L = levels(), narrow = !!S.sel, all = A.items, mgr = X.isMgr();
    const need = all.filter((it) => it.active !== false && itemIssues(it, L).length).length;
    const off = all.filter((it) => it.active === false).length;
    const noPh = all.filter((it) => it.active !== false && !it.photo_url).length;
    const hidden = all[0] && all[0].cost_hidden;
    const head = '<div class="hdr"><h1>Items<span class="count">' + all.filter((x) => x.active !== false).length.toLocaleString() + '</span></h1>' +
      (mgr ? '<button class="btn" id="it-photos" data-guide="items-list-photos">Add photos</button><button class="btn" id="it-import" data-guide="items-list-import">Bring in from your old system</button><button class="btn amber" id="it-add" data-guide="items-list-add">+ Add item</button>' : '') + '</div>';
    const bar = '<div class="bar"><input class="inp q" id="it-q" type="search" placeholder="Scan a barcode, or search name, UPC or item #" value="' + esc(S.q) + '" data-guide="items-list-search">' +
      '<div class="seg2"><button class="' + (S.f === 'all' ? 'on' : '') + '" data-itf="all" data-guide="items-list-filter">All</button>' +
      '<button class="or' + (S.f === 'need' ? ' on' : '') + '" data-itf="need" data-guide="items-list-filter">Needs you<b>' + need + '</b></button>' +
      (noPh && all.length ? '<button class="' + (S.f === 'nophoto' ? 'on' : '') + '" data-itf="nophoto" data-guide="items-list-filter">No photo<b>' + noPh + '</b></button>' : '') +
      (off ? '<button class="' + (S.f === 'off' ? 'on' : '') + '" data-itf="off" data-guide="items-list-filter">Stopped<b>' + off + '</b></button>' : '') + '</div>' +
      '<select class="sel" id="it-cat" data-guide="items-list-category">' + opt('', 'All categories', !S.cat) + CATEGORIES.map((c) => opt(c[0], c[1], c[0] === S.cat)).join('') + '</select></div>';
    const th = narrow
      ? '<tr><th>Item</th>' + (hidden ? '' : '<th class="n">Cost</th>') + '<th class="n">' + esc(L[0] ? L[0].name : 'Price') + '</th></tr>'
      : '<tr><th>Item</th><th>Category</th><th>UPC</th>' + (hidden ? '' : '<th class="n">Cost</th>') + L.map((l) => '<th class="n">' + esc(l.name) + '</th>').join('') + (hidden ? '' : '<th class="n">Margin</th>') + '</tr>';
    const table = '<div class="tcard"><table class="t"><thead>' + th + '</thead><tbody id="it-rows">' + itemRowsHtml(narrow) + '</tbody></table>' +
      '<div class="tfoot"><span id="it-count">' + countLine(itemsShown().length, all.length, 'item') + '</span>' + (hidden || narrow ? '' : '<span>Margin = ' + esc(L[0] ? L[0].name : '') + '</span>') + '</div></div>';
    return head + bar + (narrow ? '<div class="wrap2">' + table + itemPanelHtml() + '</div>' : table) + (A.ph ? photosHtml() : '');
  }
  function countLine(shown, all, w) { return shown === all ? all.toLocaleString() + ' ' + w + (all === 1 ? '' : 's') : 'Showing ' + shown.toLocaleString() + ' of ' + all.toLocaleString(); }

  function itemPanelHtml() {
    const S = A.it, L = levels(), d = S.ed, isNew = S.sel === 'new', mgr = X.isMgr(), ro = !mgr;
    const it = isNew ? null : A.items.find((x) => x.id === S.sel);
    const hidden = it ? it.cost_hidden : false;
    const dis = ro ? ' disabled' : '';
    const inp = (lbl, k, extra, wide) => '<label class="f' + (wide ? ' span2' : '') + '"><span>' + lbl + '</span><input data-itk="' + k + '" value="' + esc(d[k]) + '"' + (extra || '') + dis + ' data-guide="items-item-' + k.replace('_', '-') + '"></label>';
    const showMl = d.category === 'vapor', showOz = ['snuff', 'otp', 'pouches', 'cigars'].includes(d.category);
    const sizes = '<table class="sz"><thead><tr><th>Size</th><th class="n">Holds</th><th>UPC</th>' + (hidden ? '' : '<th class="n">Cost</th>') +
      L.map((l) => '<th class="n">' + esc(l.name) + '</th>').join('') + (ro ? '' : '<th></th>') + '</tr></thead><tbody>' +
      d.sizes.map((z, i) => '<tr><td><input class="bx zn" list="sz-names" data-zk="' + i + '|name" value="' + esc(z.name) + '"' + dis + ' data-guide="items-item-size-name"></td>' +
        '<td class="n"><input class="bx s" inputmode="numeric" data-zk="' + i + '|n" value="' + esc(z.n) + '"' + dis + ' data-guide="items-item-size-holds"></td>' +
        '<td><input class="bx u" inputmode="numeric" data-zk="' + i + '|upc" value="' + esc(z.upc) + '"' + dis + ' data-guide="items-item-size-upc"></td>' +
        (hidden ? '' : '<td class="n"><input class="bx m" inputmode="decimal" data-zk="' + i + '|cost" value="' + esc(z.cost) + '"' + dis + ' data-guide="items-item-size-cost"></td>') +
        L.map((l) => '<td class="n"><input class="bx m" inputmode="decimal" data-zk="' + i + '|p' + l.n + '" value="' + esc(z.prices[l.n] == null ? '' : z.prices[l.n]) + '"' + dis + ' data-guide="items-item-size-price"></td>').join('') +
        (ro ? '' : '<td><button class="xb" data-zrm="' + i + '" aria-label="Take this size off" data-guide="items-item-size-remove"' + (d.sizes.length < 2 ? ' disabled' : '') + '>×</button></td>') + '</tr>').join('') +
      '</tbody></table><datalist id="sz-names">' + SIZE_NAMES.map((s) => '<option value="' + s + '">').join('') + '</datalist>' +
      (ro ? '' : '<button class="btn sm addz" id="it-zadd" data-guide="items-item-size-add">+ Add a size</button>');
    const z0 = d.sizes[0] || {}, c0 = num(z0.cost), p0 = num((z0.prices || {})[L[0] && L[0].n]), mg = margin(c0, p0);
    const kpi = '<div class="kpi">' + (hidden ? '' : '<div><span>Cost</span><b id="ik-cost">' + (c0 != null && !isNaN(c0) ? money$(c0) : '—') + '</b></div>') +
      '<div><span>' + esc(L[0] ? L[0].name : 'Price') + '</span><b id="ik-p">' + (p0 != null && !isNaN(p0) ? money$(p0) : '—') + '</b></div>' +
      (hidden ? '' : '<div><span>Margin</span><b id="ik-mg" class="' + (mg != null && mg < 0 ? 'bad' : 'ok') + '">' + (mg == null || isNaN(mg) ? '—' : mg.toFixed(1) + '%') + '</b></div>') +
      '<div><span>Size</span><b class="smb" id="ik-size">' + esc(sizeLine({ name: z0.name || '', n: +z0.n || 1 }, d.unit)) + '</b></div></div>';
    const tabs = !isNew && mgr ? '<div class="ptabs"><button class="' + (S.tab === 'item' ? 'on' : '') + '" data-ittab="item" data-guide="items-item-tab">Item</button><button class="' + (S.tab === 'hist' ? 'on' : '') + '" data-ittab="hist" data-guide="items-item-tab">History</button></div>' : '';
    let body;
    if (S.tab === 'hist' && !isNew) {
      const h = (A.hist || []).filter((x) => x.detail && x.detail.item === S.sel);
      body = A.hist ? '<table class="sz"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>' + (h.length ? h.map((x) => '<tr><td>' + esc(X.when(x.at)) + '</td><td>' + esc(x.by) + '</td><td>' + esc(x.what.charAt(0).toUpperCase() + x.what.slice(1)) + '</td></tr>').join('') : '<tr><td colspan="3" class="mut">Nothing yet</td></tr>') + '</tbody></table>' : '<p class="sm">Loading…</p>';
    } else {
      body = '<div class="sec">Details</div>' + photoBox(it, ro) + '<div class="g2">' + inp('Name on the invoice', 'name', ' autocomplete="off"', true) + '</div>' +
        '<div class="g3">' + inp('Item #', 'item_no') +
        '<label class="f"><span>Category</span><select data-itk="category"' + dis + ' data-guide="items-item-category">' + CATEGORIES.map((c) => opt(c[0], c[1], c[0] === d.category)).join('') + '</select></label>' +
        '<label class="f"><span>Age limit</span><select data-itk="age"' + dis + ' data-guide="items-item-age">' + opt('0', 'None', +d.age === 0) + opt('18', '18+', +d.age === 18) + opt('21', '21+', +d.age === 21) + '</select></label></div>' +
        '<div class="g3">' + inp('Counted in', 'unit', ' list="unit-names"') + inp('Vendor', 'vendor') + inp('NACS code', 'nacs') + '</div>' +
        '<datalist id="unit-names">' + ['pack', 'can', 'each', 'cigar', 'pouch', 'bottle', 'tin', 'pod'].map((s) => '<option value="' + s + '">').join('') + '</datalist>' +
        (showMl || showOz ? '<div class="g3">' + (showMl ? inp('ml of liquid in one ' + esc(d.unit || 'unit'), 'ml', ' inputmode="decimal"') : '') + (showOz ? inp('Ounces in one ' + esc(d.unit || 'unit'), 'oz', ' inputmode="decimal"') : '') + '</div>' : '') +
        '<div class="sec">Sizes and prices</div>' + sizes + breaksHtml(d, ro) +
        (!isNew && mgr ? '<label class="chk1"><input type="checkbox" id="it-active"' + (d.active === false ? '' : ' checked') + ' data-guide="items-item-active"> Selling this item</label>' : '');
    }
    const dirty = isNew || JSON.stringify(d) !== S.orig;
    const foot = ro || S.tab === 'hist' ? '' : '<div class="foot2' + (dirty ? '' : ' hide') + '" id="it-foot"><span class="fmsg' + (S.err ? ' bad' : '') + '" id="it-err">' + esc(S.err || 'Not saved yet') + '</span>' +
      '<button class="btn" id="it-undo" data-guide="items-item-undo">' + (isNew ? 'Cancel' : 'Undo') + '</button><button class="btn amber" id="it-save" data-guide="items-item-save">' + (isNew ? 'Add item' : 'Save') + '</button></div>';
    return '<div class="panel" id="it-panel"><div class="ph"><div><b>' + esc(isNew ? 'New item' : d.name || 'Item') + '</b><span>' + esc(catName(d.category)) + (d.item_no ? ' · Item # ' + esc(d.item_no) : '') + (ro ? ' · View only' : '') + '</span></div>' +
      (isNew ? '' : '<button class="x" id="it-prev" aria-label="Item before" data-guide="items-item-previous">‹</button><button class="x" id="it-next" aria-label="Next item" data-guide="items-item-next">›</button>') +
      '<button class="x" id="it-close" aria-label="Close" data-guide="items-item-close">✕</button></div>' + kpi + tabs + '<div class="pb">' + body + '</div>' + foot + '</div>';
  }
  // ---------- quantity breaks: buys at least N of a size → $ off each, at every price level ----------
  const bkPrice = (d, i, l, b) => { const p = num((d.sizes[i].prices || {})[l.n]), o = num(b.off); return p == null || isNaN(p) ? '—' : o == null || isNaN(o) ? money$(p) : money$(Math.round((p - o) * 100) / 100); };
  const groups = () => Array.from(new Set((A.items || []).map((x) => (x.break_group || '').trim()).filter(Boolean))).sort();
  function bkHint(d) {
    const g = String(d.break_group || '').trim(), first = d.sizes.find((z) => (z.breaks || []).length), b = first && first.breaks[0];
    const what = b && +b.min >= 2 ? b.min + ' ' + plural(String(first.name || 'unit').toLowerCase(), +b.min) : 'The quantity';
    if (!g) return what + ' of this item on one invoice get the break.';
    const n = (A.items || []).filter((x) => x.id !== d.id && (x.break_group || '').trim().toLowerCase() === g.toLowerCase()).length + 1;
    return what + ' of any item in “' + g + '” (' + n + ' item' + (n === 1 ? '' : 's') + ') on one invoice get the break.';
  }
  function breaksHtml(d, ro) {
    const L = levels(), rows = [];
    d.sizes.forEach((z, i) => (z.breaks || []).forEach((b, j) => rows.push([z, i, b, j])));
    if (ro && !rows.length) return '';
    const dis = ro ? ' disabled' : '';
    return '<div class="sec">Quantity breaks</div><p class="sm gap">Buy more, pay less. Works with every price level.</p>' +
      (rows.length ? '<table class="sz brk"><thead><tr><th>Size</th><th>Buys at least</th><th>Off each</th>' + L.map((l) => '<th class="n">' + esc(l.name) + '</th>').join('') + (ro ? '' : '<th></th>') + '</tr></thead><tbody>' +
        rows.map(([z, i, b, j]) => '<tr><td><select class="bx" data-bks="' + i + '|' + j + '"' + dis + ' data-guide="items-item-break-size">' + d.sizes.map((y, k) => opt(k, y.name || 'Size ' + (k + 1), k === i)).join('') + '</select></td>' +
          '<td><input class="bx s" inputmode="numeric" data-bk="' + i + '|' + j + '|min" value="' + esc(b.min) + '"' + dis + ' data-guide="items-item-break-min"></td>' +
          '<td><input class="bx m" inputmode="decimal" data-bk="' + i + '|' + j + '|off" value="' + esc(b.off) + '"' + dis + ' data-guide="items-item-break-off"></td>' +
          L.map((l) => '<td class="n mut" id="bkp-' + i + '-' + j + '-' + l.n + '">' + bkPrice(d, i, l, b) + '</td>').join('') +
          (ro ? '' : '<td><button class="xb" data-bkrm="' + i + '|' + j + '" aria-label="Take this break off" data-guide="items-item-break-remove">×</button></td>') + '</tr>').join('') + '</tbody></table>' : '') +
      (ro ? '' : '<button class="btn sm addz" id="it-badd" data-guide="items-item-break-add">+ Add a break</button>') +
      (rows.length || d.break_group ? '<div class="grp"><label class="f"><span>Count together with</span><input data-itk="break_group" list="bk-groups" placeholder="Just this item" value="' + esc(d.break_group || '') + '"' + dis + ' data-guide="items-item-break-group"></label>' +
        '<datalist id="bk-groups">' + groups().map((g) => '<option value="' + esc(g) + '">').join('') + '</datalist>' +
        '<p class="sm" id="bk-hint">' + esc(bkHint(d)) + '</p></div>' : '');
  }
  function updBreaks(d) {
    const L = levels();
    d.sizes.forEach((z, i) => (z.breaks || []).forEach((b, j) => L.forEach((l) => { const c = q('#bkp-' + i + '-' + j + '-' + l.n); if (c) c.textContent = bkPrice(d, i, l, b); })));
    const h = q('#bk-hint'); if (h) h.textContent = bkHint(d);
  }

  // ---------- item photo (one per item; every size shares it) ----------
  function photoBox(it, ro) {
    const S = A.it, url = it ? it.photo_url : (S.newPhoto || {}).url;
    const note = '<small>Shows on invoices and in the store ordering app.</small>';
    if (ro) return url ? '<div class="pbox"><img class="pbig" src="' + esc(url) + '" alt="Item photo"></div>' : '';
    const fileBtn = (how, label, guide, cam) => '<label class="btn lcadd"><input type="file" accept="image/*"' + (cam ? ' capture="environment"' : '') + ' data-itph="' + how + '" data-guide="' + guide + '">' + label + '</label>';
    if (S.phBusy) return '<div class="pbox"><div class="pbig0"><span>Saving…</span></div></div>';
    if (url) return '<div class="pbox"><img class="pbig" src="' + esc(url) + '" alt="Item photo"><div class="pbtns">' +
      fileBtn('new', 'Take or pick a new photo', 'items-item-photo-change') +
      (S.phRm ? '<button class="btn red" id="it-phrm2" data-guide="items-item-photo-remove-confirm">Remove this photo?</button>' : '<button class="btn" id="it-phrm" data-guide="items-item-photo-remove">Remove photo</button>') + note + '</div></div>';
    return '<div class="pbox"><div class="pbig0"><span class="plus">+</span>Add photo</div><div class="pbtns">' +
      fileBtn('take', 'Take a photo', 'items-item-photo-take', true) + fileBtn('pick', 'Pick a photo', 'items-item-photo-pick') + note + '</div></div>';
  }
  function gotItem(it) {
    const i = A.items.findIndex((x) => x.id === it.id);
    if (i >= 0) A.items[i] = it; else A.items.push(it);
    A.items.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }
  function bindPhoto() {
    const S = A.it;
    $$('[data-itph]').forEach((el) => { el.onchange = async () => {
      const f = el.files && el.files[0]; if (!f) return;
      let ph; try { ph = await readCopy(f, 800, true); } catch (e) { X.say(e.message, true); return; }
      if (S.sel === 'new') { S.newPhoto = ph; X.render(); return; }
      S.phBusy = true; X.render();
      try { gotItem(await db.itemPhoto(A.cid, S.sel, ph)); A.hist = null; X.say('✓ Photo saved'); } catch (e) { X.say(e.message, true); }
      S.phBusy = false; X.render();
    }; });
    if (q('#it-phrm')) q('#it-phrm').onclick = () => { S.phRm = true; X.render(); };
    if (q('#it-phrm2')) q('#it-phrm2').onclick = async () => {
      try { gotItem(await db.itemPhoto(A.cid, S.sel, null)); A.hist = null; X.say('Photo removed'); } catch (e) { X.say(e.message, true); }
      S.phRm = false; X.render();
    };
  }

  // ---------- Add photos for many items: names with a UPC or item # match by themselves ----------
  function photosHtml() {
    const P = A.ph, items = (A.items || []).filter((it) => it.active !== false);
    const itemOpts = (sel) => opt('', 'Pick the item…', !sel) + items.map((it) => opt(it.id, it.name, it.id === sel)).join('');
    const rows = P.rows.map((r, i) => {
      const it = r.id && A.items.find((x) => x.id === r.id);
      const st = r.saved ? '<span class="ok2">✓ Saved</span>' : it ? '<span class="ok2">✓ ' + (r.how === 'upc' ? 'Matched by UPC' : r.how === 'item' ? 'Matched by item #' : 'Picked') + (it.photo_url ? ' · replaces the old photo' : '') + '</span>' : '<span class="miss">Pick the item</span>';
      return '<tr><td><img class="tph" src="' + esc(r.url) + '" alt=""></td><td class="mut">' + esc(r.name) + '</td><td>' +
        (r.how && r.how !== 'pick' ? '<b>' + esc(it.name) + '</b>' : '<select class="sel" data-phsel="' + i + '" data-guide="items-photos-item"' + (P.busy ? ' disabled' : '') + '>' + itemOpts(r.id) + '</select>') + '</td><td>' + st +
        (P.busy ? '' : ' <button class="xb" data-phrm="' + i + '" aria-label="Leave this photo out" data-guide="items-photos-remove">×</button>') + '</td></tr>';
    }).join('');
    const ready = P.rows.filter((r) => r.id && !r.saved).length, need = P.rows.filter((r) => !r.id).length;
    return '<div class="phov" id="ph-ov"><div class="card phbox"><h2>Add photos for many items</h2>' +
      '<p class="sm">Pick or drop photos. A photo named with the item’s UPC or item # matches by itself.</p>' +
      '<label class="phdrop" id="ph-drop"><input type="file" accept="image/*" multiple id="ph-pick" data-guide="items-photos-pick"' + (P.busy ? ' disabled' : '') + '>' +
      (P.reading ? 'Reading ' + P.reading + '…' : 'Drop photos here or <b>pick photos</b>') + '</label>' +
      (P.rows.length ? '<div class="phlist"><table class="t"><thead><tr><th></th><th>File</th><th>Item</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '') +
      '<div class="rowr"><span class="sm phsum" id="ph-sum">' + (P.busy ? 'Saving ' + P.done + ' of ' + P.total + '…' : P.rows.length ? ready + ' ready' + (need ? ' · ' + need + ' need you' : '') : '') + '</span>' +
      '<button class="btn" id="ph-cancel" data-guide="items-photos-cancel"' + (P.busy ? ' disabled' : '') + '>' + (P.rows.length && !ready && P.rows.every((r) => r.saved || !r.id) && P.rows.some((r) => r.saved) ? 'Close' : 'Cancel') + '</button>' +
      '<button class="btn amber" id="ph-save" data-guide="items-photos-save"' + (ready && !P.busy ? '' : ' disabled') + '>Save ' + ready + ' photo' + (ready === 1 ? '' : 's') + '</button></div></div></div>';
  }
  async function addPhotoFiles(files) {
    const P = A.ph, items = (A.items || []).filter((it) => it.active !== false);
    files = Array.from(files || []).filter((f) => /^image\//.test(f.type || ''));
    for (let i = 0; i < files.length; i++) {
      P.reading = (i + 1) + ' of ' + files.length; X.render();
      try {
        const ph = await readCopy(files[i], 800, true), m = photoMatch(files[i].name, items);
        P.rows.push({ name: files[i].name, url: ph.url, type: ph.type, id: m ? m.id : '', how: m ? m.how : '' });
      } catch (e) { X.say(files[i].name + ': ' + e.message, true); }
    }
    P.reading = ''; X.render();
  }
  function bindPhotos() {
    const P = A.ph;
    const pick = q('#ph-pick'); if (pick) pick.onchange = () => addPhotoFiles(pick.files);
    const drop = q('#ph-drop');
    if (drop) {
      drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('on'); };
      drop.ondragleave = () => drop.classList.remove('on');
      drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('on'); addPhotoFiles(e.dataTransfer && e.dataTransfer.files); };
    }
    $$('[data-phsel]').forEach((el) => { el.onchange = () => { const r = P.rows[+el.dataset.phsel]; r.id = el.value; r.how = 'pick'; X.render(); }; });
    $$('[data-phrm]').forEach((b) => { b.onclick = () => { P.rows.splice(+b.dataset.phrm, 1); X.render(); }; });
    q('#ph-cancel').onclick = () => { A.ph = null; X.render(); };
    q('#ph-save').onclick = async () => {
      const todo = P.rows.filter((r) => r.id && !r.saved);
      // Two photos for one item: the last one wins.
      const last = {}; todo.forEach((r) => { last[r.id] = r; });
      const go = Object.values(last);
      todo.filter((r) => last[r.id] !== r).forEach((r) => { r.saved = true; });
      P.busy = true; P.done = 0; P.total = go.length; X.render();
      for (const r of go) {
        try { gotItem(await db.itemPhoto(A.cid, r.id, { name: r.name, type: r.type, url: r.url })); r.saved = true; } catch (e) { X.say(r.name + ': ' + e.message, true); }
        P.done++; const sum = q('#ph-sum'); if (sum) sum.textContent = 'Saving ' + P.done + ' of ' + P.total + '…';
      }
      const n = go.filter((r) => r.saved).length;
      P.busy = false; A.hist = null;
      if (P.rows.every((r) => r.saved)) A.ph = null;
      X.say('✓ ' + n + ' photo' + (n === 1 ? '' : 's') + ' saved'); X.render();
    };
  }

  function openItem(id) {
    const S = A.it;
    if (S.sel && S.ed && S.sel !== id && (S.sel === 'new' || JSON.stringify(S.ed) !== S.orig) && !window.confirm('This item isn’t saved. Leave it without saving?')) return;
    S.sel = id; S.err = ''; S.tab = 'item'; S.newPhoto = null; S.phRm = false; S.phBusy = false;
    S.ed = itemDraft(id === 'new' ? null : A.items.find((x) => x.id === id));
    S.orig = JSON.stringify(S.ed);
    X.render();
  }
  function bindItems() {
    const S = A.it;
    if (!A.items) return load();
    const narrow = !!S.sel;
    const qb = q('#it-q');
    qb.oninput = () => { S.q = qb.value; S.more = PAGE; q('#it-rows').innerHTML = itemRowsHtml(narrow); q('#it-count').textContent = countLine(itemsShown().length, A.items.length, 'item'); bindRows(); };
    qb.onkeydown = (e) => { if (e.key === 'Enter') { const l = itemsShown(); if (l.length === 1) openItem(l[0].id); } };
    if (!S.sel) qb.focus();
    $$('[data-itf]').forEach((b) => { b.onclick = () => { S.f = b.dataset.itf; S.more = PAGE; X.render(); }; });
    q('#it-cat').onchange = (e) => { S.cat = e.target.value; X.render(); };
    if (q('#it-add')) q('#it-add').onclick = () => openItem('new');
    if (q('#it-import')) q('#it-import').onclick = () => X.startImport('items');
    if (q('#it-photos')) q('#it-photos').onclick = () => { A.ph = { rows: [], busy: false, done: 0, total: 0, reading: '' }; X.render(); };
    if (A.ph) bindPhotos();
    function bindRows() {
      $$('[data-itrow]').forEach((tr) => { tr.onclick = () => openItem(tr.dataset.itrow); });
      if (q('#it-more')) q('#it-more').onclick = (e) => { e.stopPropagation(); S.more += PAGE; X.render(); };
    }
    bindRows();
    if (S.sel) bindItemPanel();
  }
  function bindItemPanel() {
    const S = A.it, d = S.ed, L = levels();
    const foot = q('#it-foot');
    const upd = () => {
      if (foot) foot.classList.toggle('hide', !(S.sel === 'new' || JSON.stringify(d) !== S.orig));
      const z0 = d.sizes[0] || {}, c0 = num(z0.cost), p0 = num((z0.prices || {})[L[0] && L[0].n]), mg = margin(c0, p0);
      if (q('#ik-cost')) q('#ik-cost').textContent = c0 != null && !isNaN(c0) ? money$(c0) : '—';
      if (q('#ik-p')) q('#ik-p').textContent = p0 != null && !isNaN(p0) ? money$(p0) : '—';
      const m = q('#ik-mg'); if (m) { m.textContent = mg == null || isNaN(mg) ? '—' : mg.toFixed(1) + '%'; m.className = mg != null && mg < 0 ? 'bad' : 'ok'; }
      if (q('#ik-size')) q('#ik-size').textContent = sizeLine({ name: z0.name || '', n: +z0.n || 1 }, d.unit);
      updBreaks(d);
    };
    $$('[data-itk]').forEach((el) => {
      const k = el.dataset.itk;
      if (el.tagName === 'SELECT') el.onchange = () => { d[k] = k === 'age' ? +el.value : el.value; if (k === 'category') X.render(); else upd(); };
      else el.oninput = () => { d[k] = el.value; upd(); };
    });
    $$('[data-zk]').forEach((el) => {
      el.oninput = () => {
        const [i, k] = el.dataset.zk.split('|'), z = d.sizes[+i];
        if (k[0] === 'p' && k !== 'n') z.prices[k.slice(1)] = el.value; else z[k] = el.value;
        upd();
      };
    });
    $$('[data-zrm]').forEach((b) => { b.onclick = () => { d.sizes.splice(+b.dataset.zrm, 1); X.render(); }; });
    $$('[data-bk]').forEach((el) => { el.oninput = () => { const [i, j, k] = el.dataset.bk.split('|'); d.sizes[+i].breaks[+j][k] = el.value; upd(); }; });
    $$('[data-bks]').forEach((el) => { el.onchange = () => {
      const [i, j] = el.dataset.bks.split('|').map(Number), b = d.sizes[i].breaks.splice(j, 1)[0];
      (d.sizes[+el.value].breaks = d.sizes[+el.value].breaks || []).push(b); X.render();
    }; });
    $$('[data-bkrm]').forEach((b) => { b.onclick = () => { const [i, j] = b.dataset.bkrm.split('|').map(Number); d.sizes[i].breaks.splice(j, 1); X.render(); }; });
    if (q('#it-badd')) q('#it-badd').onclick = () => {
      const z = d.sizes[0], bs = (z.breaks = z.breaks || []), last = bs[bs.length - 1];
      bs.push({ min: last && +last.min ? String(+last.min * 2) : '5', off: '' }); X.render();
      const ins = $$('[data-bk$="|off"]'); if (ins.length) ins[ins.length - 1].focus();
    };
    if (q('#it-zadd')) q('#it-zadd').onclick = () => {
      const last = d.sizes[d.sizes.length - 1];
      d.sizes.push({ name: last && last.name === 'Carton' ? 'Case' : '', n: last ? (+last.n || 1) * (last.name === 'Carton' ? 50 : 1) : 1, upc: '', cost: '', prices: {}, breaks: [] });
      X.render();
    };
    if (q('#it-active')) q('#it-active').onchange = (e) => { d.active = e.target.checked; upd(); };
    $$('[data-ittab]').forEach((b) => { b.onclick = () => { S.tab = b.dataset.ittab; if (S.tab === 'hist' && !A.hist) db.history(A.cid).then((h) => { A.hist = h; X.render(); }).catch(() => { A.hist = []; X.render(); }); X.render(); }; });
    const list = itemsShown(), at = list.findIndex((x) => x.id === S.sel);
    if (q('#it-prev')) { q('#it-prev').disabled = at <= 0; q('#it-prev').onclick = () => openItem(list[at - 1].id); }
    if (q('#it-next')) { q('#it-next').disabled = at < 0 || at >= list.length - 1; q('#it-next').onclick = () => openItem(list[at + 1].id); }
    q('#it-close').onclick = () => {
      if ((S.sel === 'new' || JSON.stringify(d) !== S.orig) && !window.confirm('This item isn’t saved. Close it without saving?')) return;
      S.sel = null; S.ed = null; X.render();
    };
    if (q('#it-undo')) q('#it-undo').onclick = () => { if (S.sel === 'new') { S.sel = null; S.ed = null; } else { S.ed = JSON.parse(S.orig); } S.err = ''; X.render(); };
    if (q('#it-save')) q('#it-save').onclick = saveItem;
    bindPhoto();
    if (S.sel === 'new' && q('[data-itk="name"]') && !d.name) q('[data-itk="name"]').focus();
  }
  async function saveItem() {
    const S = A.it, d = S.ed;
    const p = Object.assign({}, d, {
      ml: num(d.ml), oz: num(d.oz), age: +d.age || 0,
      sizes: d.sizes.map((z) => ({ id: z.id, name: String(z.name || '').trim(), n: +z.n, upc: cleanUpc(z.upc), cost: num(z.cost),
        prices: Object.fromEntries(levels().map((l) => [l.n, num(z.prices[l.n])]).filter(([, v]) => v != null)),
        breaks: (z.breaks || []).map((b) => ({ min: String(b.min).trim() === '' ? '' : +b.min, off: num(b.off) })) })),
      break_group: String(d.break_group || '').trim()
    });
    if (A.items[0] && A.items[0].cost_hidden) p.sizes.forEach((z) => { delete z.cost; });
    const bad = itemCheck(p) || (p.ml != null && isNaN(p.ml) ? 'The ml isn’t a number.' : '') || (p.oz != null && isNaN(p.oz) ? 'The ounces aren’t a number.' : '');
    if (bad) { S.err = bad; const e = q('#it-err'); if (e) { e.textContent = bad; e.classList.add('bad'); } return; }
    try {
      let it = await db.itemPut(A.cid, p);
      if (S.newPhoto) { try { it = await db.itemPhoto(A.cid, it.id, S.newPhoto); } catch (e) { X.say('Item saved, but the photo didn’t go up: ' + e.message, true); } S.newPhoto = null; }
      gotItem(it);
      S.sel = it.id; S.ed = itemDraft(it); S.orig = JSON.stringify(S.ed); S.err = ''; A.hist = null;
      X.say('✓ ' + it.name + ' saved');
    } catch (e) { S.err = e.message; }
    X.render();
  }

  // =====================================================================
  // Customers
  // =====================================================================
  function custMatch(c, Q) {
    if (!Q) return true;
    const lic = (c.licenses || []).map((l) => l.number).join(' ');
    const hay = (c.name + ' ' + c.store_no + ' ' + c.city + ' ' + c.phone + ' ' + c.email + ' ' + lic + ' ' + (c.contacts || []).map((x) => x.name + ' ' + x.phone).join(' ')).toLowerCase();
    return Q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  }
  function custsShown() {
    const S = A.cu, st = sets(), t = today();
    return (A.custs || []).filter((c) => (S.f === 'off' ? c.active === false : c.active !== false))
      .filter((c) => S.f !== 'need' || custIssues(c, st, t, home()).length)
      .filter((c) => !S.lvl || c.level === +S.lvl)
      .filter((c) => custMatch(c, S.q));
  }
  function statusHtml(c) {
    const iss = custIssues(c, sets(), today(), home());
    if (!iss.length) return '<span class="st"><i></i>Good</span>';
    return '<span class="st ' + iss[0].tone + '"><i></i>' + esc(iss[0].t) + (iss.length > 1 ? ' · +' + (iss.length - 1) : '') + '</span>';
  }
  function custRowsHtml() {
    const list = custsShown();
    if (!list.length) return '<tr><td colspan="6" class="empty">' + ((A.custs || []).length ? 'No customers match.' : 'No customers yet. Tap + Add customer to start.') + '</td></tr>';
    return list.slice(0, A.cu.more).map((c) => {
      const iss = custIssues(c, sets(), today(), home()), res = (c.licenses || []).find((l) => l.kind === 'resale');
      return '<tr data-curow="' + c.id + '"><td><button class="nmb" data-cuopen="' + c.id + '" data-guide="customers-list-open"><i class="d' + (iss.length ? (iss.some((x) => x.tone === 'red') ? ' red' : '') : ' no') + '"></i><b>' + esc(c.name) + '</b></button>' +
        '<span class="sub">' + esc([c.store_no ? 'Store #' + c.store_no : '', c.city].filter(Boolean).join(' · ')) + '</span></td>' +
        '<td class="mut">' + esc(termName(c.terms)) + '</td><td class="mut">' + (res ? esc(res.number) : '<span class="bad">Missing</span>') + '</td>' +
        '<td class="n">' + money$(c.owes || 0) + '</td><td class="n mut">' + (c.credit_limit != null ? money$(c.credit_limit) : '—') + '</td><td>' + statusHtml(c) + '</td></tr>';
    }).join('') + (list.length > A.cu.more ? '<tr><td colspan="6" class="empty"><button class="btn sm" id="cu-more" data-guide="customers-list-more">Show more</button></td></tr>' : '');
  }
  function custHtml() {
    if (!A.custs) return '<h1>Customers</h1><div class="card"><p class="sm">Loading…</p></div>';
    if (A.cu.open) return custPageHtml();
    const S = A.cu, all = A.custs, mgr = X.isMgr(), st = sets(), t = today();
    const act = all.filter((c) => c.active !== false);
    const need = act.filter((c) => custIssues(c, st, t, home()).length).length, off = all.length - act.length;
    const owes = act.reduce((s, c) => s + (c.owes || 0), 0);
    return '<div class="hdr"><h1>Customers<span class="count">' + act.length.toLocaleString() + '</span></h1>' + (mgr ? '<button class="btn" id="cu-import" data-guide="customers-list-import">Bring in from your old system</button><button class="btn amber" id="cu-add" data-guide="customers-list-add">+ Add customer</button>' : '') + '</div>' +
      '<div class="bar"><input class="inp q" id="cu-q" type="search" placeholder="Search name, store #, phone or license #" value="' + esc(S.q) + '" data-guide="customers-list-search">' +
      '<div class="seg2"><button class="' + (S.f === 'all' ? 'on' : '') + '" data-cuf="all" data-guide="customers-list-filter">All</button>' +
      '<button class="or' + (S.f === 'need' ? ' on' : '') + '" data-cuf="need" data-guide="customers-list-filter">Needs you<b>' + need + '</b></button>' +
      (off ? '<button class="' + (S.f === 'off' ? 'on' : '') + '" data-cuf="off" data-guide="customers-list-filter">Stopped<b>' + off + '</b></button>' : '') + '</div>' +
      '<select class="sel" id="cu-lvl" data-guide="customers-list-level">' + opt('', 'Every price level', !S.lvl) + levels().map((l) => opt(l.n, l.name, String(l.n) === String(S.lvl))).join('') + '</select></div>' +
      '<div class="tcard"><table class="t"><thead><tr><th>Customer</th><th>Terms</th><th>Resale #</th><th class="n">Owes</th><th class="n">Credit limit</th><th>Status</th></tr></thead><tbody id="cu-rows">' + custRowsHtml() + '</tbody></table>' +
      '<div class="tfoot"><span id="cu-count">' + countLine(custsShown().length, act.length, 'customer') + '</span><span>Customers owe ' + money$(owes) + '</span></div></div>';
  }
  function bindCust() {
    const S = A.cu;
    if (!A.custs) return load();
    if (S.open) return bindCustPage();
    const qb = q('#cu-q');
    qb.oninput = () => { S.q = qb.value; S.more = PAGE; q('#cu-rows').innerHTML = custRowsHtml(); q('#cu-count').textContent = countLine(custsShown().length, A.custs.filter((c) => c.active !== false).length, 'customer'); bindRows(); };
    qb.onkeydown = (e) => { if (e.key === 'Enter') { const l = custsShown(); if (l.length === 1) openCust(l[0].id); } };
    qb.focus();
    $$('[data-cuf]').forEach((b) => { b.onclick = () => { S.f = b.dataset.cuf; X.render(); }; });
    q('#cu-lvl').onchange = (e) => { S.lvl = e.target.value; X.render(); };
    if (q('#cu-add')) q('#cu-add').onclick = () => openCust('new');
    if (q('#cu-import')) q('#cu-import').onclick = () => X.startImport('customers');
    function bindRows() {
      $$('[data-curow]').forEach((tr) => { tr.onclick = () => openCust(tr.dataset.curow); });
      if (q('#cu-more')) q('#cu-more').onclick = (e) => { e.stopPropagation(); S.more += PAGE; X.render(); };
    }
    bindRows();
  }

  // ----- one customer, full page -----
  const CU_KEYS = ['name', 'store_no', 'phone', 'email', 'addr', 'city', 'state', 'zip', 'level', 'terms', 'credit_limit', 'tobacco', 'delivery', 'route', 'rep', 'ship_to', 'since', 'active', 'opening'];
  function custDraft(c) {
    const d = {};
    CU_KEYS.forEach((k) => { d[k] = c && c[k] != null ? (k === 'credit_limit' || k === 'opening' ? String(Number(c[k]) || (k === 'opening' ? '0' : c[k])) : c[k]) : ''; });
    if (!c) d.opening = '0';
    if (!c) { d.level = sets().default_level; d.terms = 'cod'; d.tobacco = true; d.active = true; d.state = (co() || {}).home || ''; }
    d.contacts = c ? copy(c.contacts || []) : [{ name: '', role: 'Owner', phone: '' }];
    return d;
  }
  function licDraft(c) {
    return LICENSES.map(([k]) => { const l = ((c && c.licenses) || []).find((x) => x.kind === k) || {}; return { kind: k, number: l.number || '', expires: l.expires || '', copy: !!l.copy }; });
  }
  function openCust(id, tab) {
    const S = A.cu;
    S.open = id; S.tab = id === 'new' ? 'details' : (tab || 'overview'); S.err = ''; S.note = ''; S.pq = '';
    if (id === 'new') { S.data = null; S.ed = custDraft(null); S.orig = JSON.stringify(S.ed); S.led = null; X.render(); return; }
    const c = A.custs.find((x) => x.id === id);
    S.data = Object.assign({}, c, { notes: null, history: null });
    S.ed = custDraft(c); S.orig = JSON.stringify(S.ed); S.led = licDraft(c); S.lorig = JSON.stringify(S.led);
    X.render();
    db.customer(A.cid, id).then((full) => { if (S.open === id) { gotCust(full, true); X.render(); } }).catch((e) => { X.say(e.message, true); X.render(); });
  }
  function gotCust(full, keepDrafts) {
    const S = A.cu;
    S.data = full;
    const i = A.custs.findIndex((x) => x.id === full.id);
    const slim = Object.assign({}, full); delete slim.notes; delete slim.history;
    if (i >= 0) A.custs[i] = slim; else A.custs.push(slim);
    A.custs.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    if (!keepDrafts || JSON.stringify(S.ed) === S.orig) { S.ed = custDraft(full); S.orig = JSON.stringify(S.ed); }
    if (!keepDrafts || JSON.stringify(S.led) === S.lorig) { S.led = licDraft(full); S.lorig = JSON.stringify(S.led); }
  }
  function custDirty() { const S = A.cu; return S.open === 'new' || JSON.stringify(S.ed) !== S.orig || (S.led && JSON.stringify(S.led) !== S.lorig); }
  function leaveCust() { return !custDirty() || window.confirm('Your changes to this customer aren’t saved. Leave without saving?'); }

  function custPageHtml() {
    const S = A.cu, isNew = S.open === 'new', c = S.data, mgr = X.isMgr();
    const back = '<button class="back" id="cu-back" data-guide="customers-page-back"><i>‹</i>Back to Customers</button>';
    if (isNew) return back + '<div class="chd"><div class="av">+</div><div class="who"><h1>New customer</h1></div></div>' + custDetailsHtml(true);
    const iss = custIssues(c, sets(), today(), home()), st = sets();
    const main = (c.contacts || [])[0];
    const meta = [c.store_no ? 'Store #' + esc(c.store_no) : '', esc([c.addr, c.city, [c.state, c.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')),
      main && main.name ? '<b>' + esc(main.name) + '</b>' : '', esc((main && main.phone) || c.phone)].filter(Boolean).join(' · ');
    const list = custsShown(), at = list.findIndex((x) => x.id === c.id);
    const head = '<div class="chd"><div class="av">' + esc(initials(c.name)) + '</div><div class="who"><h1>' + esc(c.name) +
      (iss.length ? ' <span class="st ' + iss[0].tone + '"><i></i>' + esc(iss[0].t) + '</span>' : '') + (c.active === false ? ' <span class="st"><i class="grey"></i>Stopped</span>' : '') + '</h1>' +
      '<div class="meta">' + (meta || 'No address yet') + '</div></div>' +
      '<div class="nav2"><button class="x" id="cu-prev" data-guide="customers-page-previous"' + (at <= 0 ? ' disabled' : '') + '>‹ Previous</button><button class="x" id="cu-next" data-guide="customers-page-next"' + (at < 0 || at >= list.length - 1 ? ' disabled' : '') + '>Next ›</button></div>' +
      (mgr && S.tab !== 'details' ? '<button class="btn" id="cu-edit" data-guide="customers-page-edit">Edit details</button>' : '') + '</div>';
    const used = c.credit_limit ? Math.min(100, Math.round((c.owes || 0) / c.credit_limit * 100)) : 0;
    const kpis = '<div class="kpis"><div class="kb nv"><span>Owes</span><b>' + money$(c.owes || 0) + '</b><small>No open invoices</small></div>' +
      '<div class="kb"><span>Past due · $0.00</span><div class="age"><div>0–30 days<b>$0</b></div><div>31–60<b>$0</b></div><div>61–90<b>$0</b></div><div>90+<b>$0</b></div></div></div>' +
      '<div class="kb"><span>Credit limit</span><b>' + (c.credit_limit != null ? money$(c.credit_limit) : 'None') + '</b>' + (c.credit_limit ? '<div class="cbar"><i style="width:' + used + '%"></i></div><small>' + used + '% used · ' + money$(c.credit_limit - (c.owes || 0)) + ' left</small>' : '<small>No limit set</small>') + '</div>' +
      '<div class="kb"><span>Terms</span><b class="smb2">' + esc(termName(c.terms)) + '</b><small>' + (licProblems(c, st, today(), home()).length ? '<span class="miss">A license needs a look</span>' : 'Licenses OK') + '</small></div>' +
      '<div class="kb"><span>Buys a week</span><b>—</b><small>No orders yet</small></div></div>';
    const licBad = iss.filter((x) => x.k !== 'credit').length;
    const nN = (c.notes || []).length;
    const tabs = '<nav class="ctabs">' + [['overview', 'Overview'], ['details', 'Details'], ['licenses', 'Licenses' + (licBad ? '<em>' + licBad + '</em>' : '')], ['prices', 'Prices'], ['notes', 'Notes' + (nN ? '<em class="g">' + nN + '</em>' : '')], ['history', 'History']]
      .map((t) => '<button class="' + (S.tab === t[0] ? 'on' : '') + '" data-cutab="' + t[0] + '" data-guide="customers-page-tab">' + t[1] + '</button>').join('') + '</nav>';
    let body = '';
    if (S.tab === 'overview') body = custOverviewHtml(c);
    if (S.tab === 'details') body = custDetailsHtml(false);
    if (S.tab === 'licenses') body = custLicHtml(c);
    if (S.tab === 'prices') body = custPricesHtml(c);
    if (S.tab === 'notes') body = custNotesHtml(c);
    if (S.tab === 'history') body = custHistHtml(c);
    return back + head + licBarHtml(c) + kpis + tabs + body;
  }
  // The orange bar on a customer whose needed license is missing or ended. Selling is never stopped.
  function licBarHtml(c) {
    const pr = licProblems(c, sets(), today(), home());
    if (!pr.length) return '';
    const p = pr[0], co1 = co() || {};
    const what = p.st === 'ended' ? licName(p.kind) + ' ended ' + shortDate(p.expires, true) + '.' : 'No ' + licName(p.kind).toLowerCase() + ' on file.';
    const subj = 'Your ' + licName(p.kind).toLowerCase() + ' for ' + (co1.name || 'us');
    const body = 'Hi, our records show your ' + licName(p.kind).toLowerCase() + (p.st === 'ended' ? ' ended on ' + shortDate(p.expires, true) : ' isn’t on file') + '. Please reply with a photo of the current one. Thank you, ' + (co1.name || '');
    return '<div class="licbar" id="cu-licbar"><div class="tx"><b>' + esc(what) + '</b> You can still sell to them — you’ll get a warning on the invoice.' +
      (pr.length > 1 ? ' <span class="mut">+' + (pr.length - 1) + ' more</span>' : '') + '</div>' +
      (c.email ? '<a class="btn" id="cu-licmail" data-guide="customers-page-license-email" href="mailto:' + esc(c.email) + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(body) + '">Email the store</a>' : '') +
      (X.isMgr() ? addBtn(p.kind, 'Upload now', 'amber big').replace('customers-licenses-copy-add', 'customers-page-license-upload') : '') + '</div>';
  }
  function licLine(c, k) {
    const l = (c.licenses || []).find((x) => x.kind === k), s = licState(l, today(), sets().remind_days);
    if (s === 'none') return '<b class="mut">Not on file</b>';
    if (s === 'ended') return '<b class="bad">Ended ' + esc(shortDate(l.expires, true)) + '</b>';
    if (s === 'soon') return '<b class="miss">Ends ' + esc(shortDate(l.expires)) + '</b>';
    return '<b class="ok2">✓ ' + esc(l.expires ? 'Until ' + shortDate(l.expires, true) : l.number) + '</b>';
  }
  function custOverviewHtml(c) {
    const empty = (t) => '<p class="emptyc">' + t + '</p>';
    const kv = (a, b) => '<div class="kv"><span>' + a + '</span>' + b + '</div>';
    const need = custNeeds(c, sets(), home());
    const lics = LICENSES.filter(([k]) => need.includes(k) || (c.licenses || []).some((l) => l.kind === k && l.number));
    const notes = (c.notes || []).slice(0, 2);
    return '<div class="cgrid"><div>' +
      '<div class="cc"><div class="cch"><b>Open invoices</b></div>' + empty('No invoices yet') + '</div>' +
      '<div class="cc"><div class="cch"><b>Recent payments</b></div>' + empty('No payments yet') + '</div>' +
      '<div class="cc"><div class="cch"><b>What they buy most · last 30 days</b><button class="lnk" data-cutab="prices" data-guide="customers-overview-prices">Prices for this customer ›</button></div>' + empty('Nothing bought yet') + '</div>' +
      '</div><div>' +
      '<div class="cc"><div class="cch"><b>Licenses</b><button class="lnk" data-cutab="licenses" data-guide="customers-overview-licenses">Licenses ›</button></div><div class="ccb">' + lics.map(([k, n]) => kv(n, licLine(c, k))).join('') + '</div></div>' +
      '<div class="cc"><div class="cch"><b>Contacts</b>' + (X.isMgr() ? '<button class="lnk" data-cutab="details" data-guide="customers-overview-contacts-edit">Edit</button>' : '') + '</div><div class="ccb">' +
      ((c.contacts || []).length ? c.contacts.map((x) => kv(esc(x.name || '—') + (x.role ? ' · ' + esc(x.role) : ''), '<b>' + esc(x.phone || '') + '</b>')).join('') : '') +
      (c.email ? kv('Invoices by email', '<b>' + esc(c.email) + '</b>') : '') + (!(c.contacts || []).length && !c.email ? '<p class="emptyc in">No contacts yet</p>' : '') + '</div></div>' +
      '<div class="cc"><div class="cch"><b>Account</b>' + (X.isMgr() ? '<button class="lnk" data-cutab="details" data-guide="customers-overview-account-edit">Edit</button>' : '') + '</div><div class="ccb">' +
      kv('Price level', '<span class="pvhide" id="cu-lv"><span class="dots">•••</span><button class="pvbtn" id="cu-lvshow" data-guide="customers-page-level-show">Show</button></span>') +
      kv('Delivery day', '<b>' + esc([c.delivery, c.route ? 'Route ' + c.route.replace(/^route\s*/i, '') : ''].filter(Boolean).join(' · ') || '—') + '</b>') +
      kv('Sales rep', '<b>' + esc(c.rep || '—') + '</b>') + kv('Ships to', '<b>' + esc(c.ship_to || 'Same as the store') + '</b>') +
      kv('Customer since', '<b>' + esc(c.since ? new Date(c.since + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—') + '</b>') + '</div></div>' +
      '<div class="cc"><div class="cch"><b>Notes</b><button class="lnk" data-cutab="notes" data-guide="customers-overview-notes">+ Add a note</button></div><div class="ccb">' +
      (c.notes == null ? '<p class="emptyc in">Loading…</p>' : notes.length ? notes.map((n) => '<div class="note">' + esc(n.text) + '<small>' + esc(n.by) + ' · ' + esc(X.when(n.at)) + '</small></div>').join('') : '<p class="emptyc in">No notes yet</p>') + '</div></div>' +
      '</div></div>';
  }
  function custDetailsHtml(isNew) {
    const S = A.cu, d = S.ed, ro = !X.isMgr(), dis = ro ? ' disabled' : '';
    const inp = (lbl, k, extra, cls) => '<label class="fld' + (cls ? ' ' + cls : '') + '"><span>' + lbl + '</span><input data-cuk="' + k + '" value="' + esc(d[k]) + '"' + (extra || '') + dis + ' data-guide="customers-details-' + k.replace('_', '-') + '"></label>';
    const sel = (lbl, k, opts) => '<label class="fld"><span>' + lbl + '</span><select data-cuk="' + k + '"' + dis + ' data-guide="customers-details-' + k.replace('_', '-') + '">' + opts + '</select></label>';
    const contacts = '<table class="sz ct"><thead><tr><th>Name</th><th>Role</th><th>Phone</th>' + (ro ? '' : '<th></th>') + '</tr></thead><tbody>' +
      d.contacts.map((x, i) => '<tr><td><input class="bx w" data-cck="' + i + '|name" value="' + esc(x.name) + '"' + dis + ' data-guide="customers-details-contact-name"></td>' +
        '<td><input class="bx w" data-cck="' + i + '|role" value="' + esc(x.role) + '" list="ct-roles"' + dis + ' data-guide="customers-details-contact-role"></td>' +
        '<td><input class="bx w" data-cck="' + i + '|phone" value="' + esc(x.phone) + '" inputmode="tel"' + dis + ' data-guide="customers-details-contact-phone"></td>' +
        (ro ? '' : '<td><button class="xb" data-ccrm="' + i + '" aria-label="Take off this contact" data-guide="customers-details-contact-remove">×</button></td>') + '</tr>').join('') +
      '</tbody></table><datalist id="ct-roles"><option value="Owner"><option value="Manager"><option value="Orders"><option value="Pays the bills"></datalist>' +
      (ro ? '' : '<button class="btn sm addz" id="cu-ccadd" data-guide="customers-details-contact-add">+ Add a contact</button>');
    const dirty = custDirtyDetails();
    return '<div class="cgrid2"><div class="card form2"><h2>Store</h2><div class="grid2">' + inp('Customer name', 'name', ' autocomplete="off"', 'span2') + inp('Store #', 'store_no') + inp('Phone', 'phone', ' inputmode="tel"') +
      inp('Email for invoices', 'email', ' inputmode="email"', 'span2') + inp('Street address', 'addr', '', 'span2') + inp('City', 'city') +
      '<div class="grid2 tight">' + sel('State', 'state', stateOptions(d.state, ' ')) + inp('ZIP', 'zip', ' inputmode="numeric"') + '</div></div>' +
      '<h2>Contacts</h2>' + contacts + '</div>' +
      '<div class="card form2"><h2>Selling to them</h2><div class="grid2">' +
      sel('Price level', 'level', levels().map((l) => opt(l.n, l.name, +d.level === l.n)).join('')) + sel('Terms', 'terms', TERMS.map((t) => opt(t[0], t[1], t[0] === d.terms)).join('')) +
      inp('Credit limit', 'credit_limit', ' inputmode="decimal" placeholder="No limit"') + sel('Buys tobacco', 'tobacco', opt('true', 'Yes', d.tobacco !== false) + opt('false', 'No', d.tobacco === false)) +
      inp('Delivery day', 'delivery', ' list="days"') + inp('Route', 'route') + inp('Sales rep', 'rep') + inp('Customer since', 'since', ' type="date"') +
      inp('Ships to', 'ship_to', ' placeholder="Same as the store"', 'span2') +
      ((co() || {}).role === 'owner' ? inp('Starting balance (owed before StoreOwl)', 'opening', ' inputmode="decimal"', 'span2') : '') + '</div>' +
      '<datalist id="days">' + ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Pick up'].map((x) => '<option value="' + x + '">').join('') + '</datalist>' +
      (!isNew && !ro ? '<label class="chk1"><input type="checkbox" id="cu-active"' + (d.active === false ? '' : ' checked') + ' data-guide="customers-details-active"> Still a customer</label>' : '') +
      (ro ? '<p class="sm">Only owners and managers can change these.</p>' : '') + '</div></div>' +
      (ro ? '' : '<div class="savebar wide' + (dirty ? '' : ' hide') + '" id="cu-bar"><span id="cu-err" class="' + (S.err ? 'bad' : '') + '">' + esc(S.err || 'Not saved yet') + '</span><div class="rowr">' +
        '<button class="btn" id="cu-undo" data-guide="customers-details-undo">' + (isNew ? 'Cancel' : 'Undo') + '</button><button class="btn amber" id="cu-save" data-guide="customers-details-save">' + (isNew ? 'Add customer' : 'Save') + '</button></div></div>');
  }
  function custDirtyDetails() { const S = A.cu; return S.open === 'new' || JSON.stringify(S.ed) !== S.orig; }
  // ---------- license copies (a photo or PDF of each license) ----------
  const copiesOf = (c, k) => (c.copies || []).filter((x) => x.kind === k);
  const isPdf = (x) => /pdf/.test(x.type || '');
  const addBtn = (k, label, cls) => '<label class="btn sm lcadd' + (cls ? ' ' + cls : '') + '"><input type="file" accept="image/*,application/pdf" data-lcadd="' + k + '" data-guide="customers-licenses-copy-add">' + label + '</label>';
  function copyCell(c, k, ro) {
    const cur = copiesOf(c, k)[0];
    if (A.cu.lcBusy === k) return '<span class="mut">Saving…</span>';
    if (cur) return '<button class="lcthumb' + (A.cu.lcv === k ? ' on' : '') + '" data-lcview="' + k + '" data-guide="customers-licenses-copy-view">' +
      (isPdf(cur) ? '<i class="pdf">PDF</i>' : '<img src="' + esc(cur.url) + '" alt="">') + '<span>' + esc(shortDate(cur.at.slice(0, 10))) + '</span></button>';
    return ro ? '<span class="mut">—</span>' : addBtn(k, 'Add copy');
  }
  function copyPanel(c, ro) {
    const S = A.cu, k = S.lcv; if (!k) return '';
    const all = copiesOf(c, k); if (!all.length) return '';
    const x = all.find((y) => y.id === S.lcid) || all[0], cur = x === all[0];
    const L = (c.licenses || []).find((l) => l.kind === k) || {}, licNow = { number: L.number || '', expires: L.expires || null };   // the current copy shows the license as it is now
    const kv2 = (a, b) => '<div class="kv"><span>' + a + '</span><b>' + b + '</b></div>';
    return '<aside class="lcpan" id="lc-pan"><div class="lchd"><b>' + esc(licName(k)) + ' copy</b><button class="x" id="lc-x" data-guide="customers-licenses-copy-close">✕</button></div>' +
      '<div class="lcpic">' + (isPdf(x) ? '<iframe src="' + esc(x.url) + '" title="License copy"></iframe>' : '<img src="' + esc(x.url) + '" alt="License copy">') + '</div>' +
      '<div class="lcinfo">' + (cur ? '' : '<p class="lcold">An older copy · replaced later</p>') +
      (cur && !ro && all[1] && (all[1].expires || '') === (licNow.expires || '') ? '<p class="lcold">Same end date as the last copy. If the new license ends later, change it here.</p>' : '') +
      (cur && !ro ? (() => { const i = S.led.findIndex((l) => l.kind === k), l = S.led[i];
          return '<div class="lcedit"><label class="fld"><span>License number</span><input class="bx" data-lk="' + i + '|number" value="' + esc(l.number) + '" data-guide="customers-licenses-copy-number"></label>' +
            '<label class="fld"><span>Expires</span><input class="bx" type="date" data-lk="' + i + '|expires" value="' + esc(l.expires) + '" data-guide="customers-licenses-copy-expires"></label>' +
            '<button class="btn" id="lc-save" data-guide="customers-licenses-copy-save">Save</button></div>'; })()
        : kv2('Number on file then', esc(x.number || '—')) + kv2('Expires then', x.expires ? esc(shortDate(x.expires, true)) : '—')) +
      kv2('Added', esc(shortDate(x.at.slice(0, 10))) + ' · ' + esc(x.by)) +
      '<a class="lnk" href="' + esc(x.url) + '" target="_blank" rel="noopener" download="' + esc(x.name) + '" data-guide="customers-licenses-copy-open">Open full size</a></div>' +
      (ro || !cur ? '' : '<div class="rowr">' + (S.lcRm === x.id ? '<button class="btn red" id="lc-rm" data-guide="customers-licenses-copy-remove-confirm">Remove this copy?</button>'
        : '<button class="btn" id="lc-rm1" data-guide="customers-licenses-copy-remove">Remove</button>') + addBtn(k, 'Replace with a new copy', 'amber') + '</div>') +
      (all.length > 1 ? '<div class="lcolds"><b>Copies on file · ' + all.length + '</b>' + all.map((y, i) => (i ? y : Object.assign({}, y, licNow))).map((y, i) => '<button class="lcrow' + (y.id === x.id ? ' on' : '') + '" data-lcold="' + y.id + '" data-guide="customers-licenses-copy-older">' +
        '<span>' + (i ? 'Older' : 'Current') + ' · ' + esc(shortDate(y.at.slice(0, 10))) + '</span><em>' + esc(y.number || '') + (y.expires ? ' · ends ' + esc(shortDate(y.expires, true)) : '') + '</em></button>').join('') + '</div>' : '') +
      '</aside>';
  }
  // A photo is shrunk to at most 1600 pixels on the phone before it goes up (a license is readable at that size).
  function readCopy(file, max, photoOnly) {
    max = max || 1600;
    return new Promise((res, rej) => {
      if (photoOnly && !/^image\//.test(file.type || '')) return rej(new Error('Pick a photo'));
      if (!/^image\/|^application\/pdf$/.test(file.type || '')) return rej(new Error('Pick a photo or a PDF'));
      if (file.size > (photoOnly ? 25 : 10) * 1024 * 1024) return rej(new Error('That file is bigger than ' + (photoOnly ? 25 : 10) + ' MB'));
      const fr = new FileReader();
      fr.onerror = () => rej(new Error('StoreOwl couldn’t read that file'));
      fr.onload = () => {
        const url = fr.result;
        let can = false;
        try { const c0 = document.createElement('canvas'); can = typeof c0.getContext === 'function' && !!c0.getContext('2d'); } catch (e) { can = false; }
        if (isPdf(file) || !can) return res({ name: file.name, type: file.type, size: file.size, url });
        const im = new Image();
        im.onload = () => {
          try {
            const r = Math.min(1, max / Math.max(im.width, im.height)), cv = document.createElement('canvas');
            cv.width = Math.round(im.width * r); cv.height = Math.round(im.height * r);
            const g = cv.getContext('2d'); if (!g) throw new Error('no canvas');
            g.drawImage(im, 0, 0, cv.width, cv.height);
            const out = cv.toDataURL('image/jpeg', 0.82);
            res({ name: file.name.replace(/\.\w+$/, '') + '.jpg', type: 'image/jpeg', size: Math.round(out.length * 0.75), url: out });
          } catch (e) { res({ name: file.name, type: file.type, size: file.size, url }); }
        };
        im.onerror = () => res({ name: file.name, type: file.type, size: file.size, url });
        im.src = url;
      };
      fr.readAsDataURL(file);
    });
  }

  function custLicHtml(c) {
    const S = A.cu, ro = !X.isMgr(), dis = ro ? ' disabled' : '', st = sets(), t = today();
    const dirty = JSON.stringify(S.led) !== S.lorig, need = custNeeds(c, st, home()), stName = stateName(custStateOf(c, home())) || 'your state';
    const order = S.led.map((l, i) => i).sort((a, b) => (need.includes(S.led[b].kind) ? 1 : 0) - (need.includes(S.led[a].kind) ? 1 : 0) || a - b);
    const stTxt = (l) => {
      const s = licState(l, t, st.remind_days);
      if (s === 'none') return need.includes(l.kind) ? '<span class="st or"><i></i>Needed</span>' : '<span class="mut">Not needed</span>';
      if (s === 'ended') return '<span class="st or"><i></i>Ended</span>';
      if (s === 'soon') return '<span class="st or"><i></i>Ends soon</span>';
      return '<span class="st"><i></i>Good</span>';
    };
    return '<div class="cc"><table class="t tsm lic"><thead><tr><th>License</th><th>Number</th><th>Expires</th><th>Copy</th><th>Status</th></tr></thead><tbody>' +
      order.map((i) => [S.led[i], i]).map(([l, i]) => '<tr><td><b>' + esc(licName(l.kind)) + '</b>' + (need.includes(l.kind) ? '<span class="sub0">' + esc(LIC_COVER_TEXT[l.kind]) + '</span>' : '') + '</td><td><input class="bx w" data-lk="' + i + '|number" value="' + esc(l.number) + '"' + dis + ' data-guide="customers-licenses-number"></td>' +
        '<td><input class="bx d" type="date" data-lk="' + i + '|expires" value="' + esc(l.expires) + '"' + dis + ' data-guide="customers-licenses-expires"></td>' +
        '<td>' + copyCell(c, l.kind, ro) + '</td>' +
        '<td id="lst-' + i + '">' + stTxt(l) + '</td></tr>').join('') + '</tbody></table></div>' +
      copyPanel(c, ro) +
      '<div class="cc"><div class="cch"><b>When a license runs out</b>' + (X.isMgr() ? '<button class="lnk" id="cu-licrules" data-guide="customers-licenses-rules">Change in Settings ›</button>' : '') + '</div><div class="ccb">' +
      '<div class="kv"><span>Needed in ' + esc(stName) + '</span><b>' + (need.length ? need.map(licName).map(esc).join(', ') : 'None') + '</b></div>' +
      '<div class="kv"><span>Missing or ended</span><b>' + (st.lic_mode === 'ask' ? 'Warn and ask for a manager’s OK' : 'Only warn me') + '</b></div>' +
      '<div class="kv"><span>Remind me before a license ends</span><b>' + (st.remind_days ? st.remind_days + ' days' : 'Off') + '</b></div></div></div>' +
      (ro ? '' : '<div class="savebar wide' + (dirty ? '' : ' hide') + '" id="cl-bar"><span id="cl-err" class="' + (S.err ? 'bad' : '') + '">' + esc(S.err || 'Not saved yet') + '</span><div class="rowr">' +
        '<button class="btn" id="cl-undo" data-guide="customers-licenses-undo">Undo</button><button class="btn amber" id="cl-save" data-guide="customers-licenses-save">Save</button></div></div>');
  }
  function priceRows(c) {
    const S = A.cu, items = (A.items || []).filter((it) => it.active !== false && itemMatch(it, S.pq)), out = [];
    const warnCats = {};
    items.forEach((it) => it.sizes.forEach((z) => out.push([it, z])));
    if (!out.length) return '<tr><td colspan="4" class="empty">' + ((A.items || []).length ? 'No items match.' : 'No items yet.') + '</td></tr>';
    return out.slice(0, 150).map(([it, z]) => {
      if (!(it.category in warnCats)) warnCats[it.category] = saleWarnings(c, it.category, sets(), today(), home()).filter((w) => w.kind !== 'resale' && w.kind !== 'location');
      const p = z.prices[c.level], w = warnCats[it.category][0];
      return '<tr><td><b>' + esc(it.name) + '</b>' + (w ? '<span class="sub0 miss">' + esc(problemText(w)) + ' · you’ll be warned</span>' : '') + '</td><td class="mut">' + esc(sizeLine(z, it.unit)) + '</td><td class="mut">' + esc(upcShow(z.upc)) + '</td><td class="n"><b>' + (p != null ? money$(p) : '<span class="miss">No price</span>') + '</b>' + (p != null && (z.breaks || []).length ? '<span class="brsub">' + esc(breakLine(p, z.breaks)) + '</span>' : '') + '</td></tr>';
    }).join('') + (out.length > 150 ? '<tr><td colspan="4" class="empty">Showing 150 of ' + out.length.toLocaleString() + ' · search to find others</td></tr>' : '');
  }
  function custPricesHtml(c) {
    return '<div class="bar"><input class="inp q" id="cp-q" type="search" placeholder="Search an item or scan its barcode" value="' + esc(A.cu.pq) + '" data-guide="customers-prices-search"></div>' +
      '<div class="cc"><table class="t tsm"><thead><tr><th>Item</th><th>Size</th><th>UPC</th><th class="n">Their price</th></tr></thead><tbody id="cp-rows">' + priceRows(c) + '</tbody></table></div>';
  }
  function custNotesHtml(c) {
    return '<div class="cc"><div class="ccb pad"><label class="fld"><span>Add a note</span><textarea id="cn-text" rows="3" data-guide="customers-notes-text">' + esc(A.cu.note) + '</textarea></label>' +
      '<div class="rowr tight"><button class="btn amber" id="cn-add" data-guide="customers-notes-add">Add note</button></div></div></div>' +
      '<div class="cc"><div class="ccb">' + (c.notes == null ? '<p class="emptyc in">Loading…</p>' : c.notes.length ? c.notes.map((n) => '<div class="note">' + esc(n.text) + '<small>' + esc(n.by) + ' · ' + esc(X.when(n.at)) + '</small></div>').join('') : '<p class="emptyc in">No notes yet</p>') + '</div></div>';
  }
  function custHistHtml(c) {
    const say1 = (x) => {
      const d = x.detail || {};
      if (x.what === 'license changed') return licName(d.kind) + (d.after ? ' · ' + d.after.number + (d.after.expires ? ' · until ' + shortDate(d.after.expires, true) : '') : ' taken off');
      if (x.what === 'customer changed' && d.before) {
        const now = A.cu.data, ch = CU_KEYS.filter((k) => k !== 'level' && String(d.before[k] == null ? '' : d.before[k]) !== String(now[k] == null ? '' : now[k]));
        return 'Details changed' + (ch.length && ch.length < 4 ? ' · ' + ch.map((k) => k.replace('_', ' ')).join(', ') : '');
      }
      return x.what.charAt(0).toUpperCase() + x.what.slice(1);
    };
    return '<div class="cc"><table class="t tsm"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>' +
      (c.history == null ? '<tr><td colspan="3" class="empty">Loading…</td></tr>' : c.history.length ? c.history.map((x) => '<tr><td>' + esc(X.when(x.at)) + '</td><td>' + esc(x.by) + '</td><td>' + esc(say1(x)) + '</td></tr>').join('') : '<tr><td colspan="3" class="empty">Nothing yet</td></tr>') +
      '</tbody></table></div>';
  }
  function bindCustPage() {
    const S = A.cu;
    q('#cu-back').onclick = () => { if (!leaveCust()) return; S.open = null; S.data = null; X.render(); };
    const list = custsShown(), at = S.data ? list.findIndex((x) => x.id === S.data.id) : -1;
    if (q('#cu-prev')) q('#cu-prev').onclick = () => { if (leaveCust()) openCust(list[at - 1].id, S.tab); };
    if (q('#cu-next')) q('#cu-next').onclick = () => { if (leaveCust()) openCust(list[at + 1].id, S.tab); };
    if (q('#cu-edit')) q('#cu-edit').onclick = () => { S.tab = 'details'; X.render(); };
    $$('[data-cutab]').forEach((b) => { b.onclick = () => { S.tab = b.dataset.cutab; S.err = ''; X.render(); }; });
    // Price level: hidden; Show reveals it for 5 seconds, without redrawing the page.
    const sh = q('#cu-lvshow');
    if (sh) sh.onclick = () => {
      const box = q('#cu-lv'), was = box.innerHTML;
      box.innerHTML = '<b>' + esc(lvName(S.data.level)) + '</b>';
      clearTimeout(A.lvT);
      A.lvT = setTimeout(() => { const b = q('#cu-lv'); if (b === box) { b.innerHTML = was; b.querySelector('button').onclick = sh.onclick; } }, 5000);
    };
    if (S.tab === 'details' || S.open === 'new') bindCustDetails();
    if (S.tab === 'licenses') bindCustLic();
    if (S.tab === 'prices') {
      if (!A.items) load(true);
      const pq = q('#cp-q');
      pq.oninput = () => { S.pq = pq.value; q('#cp-rows').innerHTML = priceRows(S.data); };
      pq.focus();
    }
    if (S.tab === 'notes') {
      const t = q('#cn-text'); t.oninput = () => { S.note = t.value; };
      q('#cn-add').onclick = async () => {
        if (!S.note.trim()) { X.say('Type a note first.', true); return X.render(); }
        try { gotCust(await db.noteAdd(A.cid, S.data.id, S.note), true); S.note = ''; X.say('✓ Note added'); } catch (e) { X.say(e.message, true); }
        X.render();
      };
    }
  }
  function bindCustDetails() {
    const S = A.cu, d = S.ed, bar = q('#cu-bar');
    const upd = () => { if (bar) bar.classList.toggle('hide', !custDirtyDetails()); };
    $$('[data-cuk]').forEach((el) => {
      const k = el.dataset.cuk;
      const set = () => { d[k] = k === 'level' ? +el.value : k === 'tobacco' ? el.value === 'true' : el.value; upd(); };
      if (el.tagName === 'SELECT') el.onchange = set; else el.oninput = set;
    });
    $$('[data-cck]').forEach((el) => { el.oninput = () => { const [i, k] = el.dataset.cck.split('|'); d.contacts[+i][k] = el.value; upd(); }; });
    $$('[data-ccrm]').forEach((b) => { b.onclick = () => { d.contacts.splice(+b.dataset.ccrm, 1); X.render(); }; });
    if (q('#cu-ccadd')) q('#cu-ccadd').onclick = () => { d.contacts.push({ name: '', role: '', phone: '' }); X.render(); };
    if (q('#cu-active')) q('#cu-active').onchange = (e) => { d.active = e.target.checked; upd(); };
    if (S.open === 'new' && q('[data-cuk="name"]') && !d.name) q('[data-cuk="name"]').focus();
    if (q('#cu-undo')) q('#cu-undo').onclick = () => {
      if (S.open === 'new') { S.open = null; } else { S.ed = JSON.parse(S.orig); }
      S.err = ''; X.render();
    };
    if (q('#cu-save')) q('#cu-save').onclick = async () => {
      const p = Object.assign({}, d, { credit_limit: num(d.credit_limit), since: d.since || null, opening: num(d.opening) || 0 });
      if ((co() || {}).role !== 'owner' || (S.open !== 'new' && String(d.opening) === String(JSON.parse(S.orig).opening))) delete p.opening;
      if (p.opening != null && isNaN(p.opening)) { S.err = 'The starting balance isn’t a number.'; const e = q('#cu-err'); e.textContent = S.err; e.className = 'bad'; return; }
      const bad = custCheck(p);
      if (bad) { S.err = bad; const e = q('#cu-err'); e.textContent = bad; e.className = 'bad'; return; }
      if (S.open !== 'new') p.id = S.data.id;
      try {
        const full = await db.customerPut(A.cid, p);
        const isNew = S.open === 'new';
        S.open = full.id; gotCust(full); S.err = ''; S.tab = isNew ? 'overview' : 'details';
        X.refreshCompany && X.refreshCompany();
        X.say('✓ ' + full.name + (isNew ? ' added' : ' saved'));
      } catch (e) { S.err = e.message; }
      X.render();
    };
  }
  function bindCustLic() {
    const S = A.cu, bar = q('#cl-bar');
    $$('[data-lk]').forEach((el) => {
      const [i, k] = el.dataset.lk.split('|');
      const set = () => { S.led[+i][k] = k === 'copy' ? el.checked : el.value; if (bar) bar.classList.toggle('hide', JSON.stringify(S.led) === S.lorig); };
      if (el.type === 'checkbox') el.onchange = set; else el.oninput = set;
    });
    $$('[data-lcadd]').forEach((el) => { el.onchange = async () => {
      const f = el.files && el.files[0], k = el.dataset.lcadd; if (!f) return;
      S.lcBusy = k; X.render();
      try {
        const full = await db.copyAdd(A.cid, S.data.id, k, await readCopy(f));
        S.lcBusy = null; S.tab = 'licenses'; S.lcv = k; S.lcid = null; S.lcRm = null; gotCust(full, true); X.say('✓ Copy of the ' + licName(k).toLowerCase() + ' saved');
      } catch (e) { S.lcBusy = null; X.say(e.message, true); }
      X.render();
    }; });
    $$('[data-lcview]').forEach((b) => { b.onclick = () => { S.lcv = S.lcv === b.dataset.lcview ? null : b.dataset.lcview; S.lcid = null; S.lcRm = null; X.render(); }; });
    $$('[data-lcold]').forEach((b) => { b.onclick = () => { S.lcid = b.dataset.lcold; S.lcRm = null; X.render(); }; });
    if (q('#lc-x')) q('#lc-x').onclick = () => { S.lcv = null; S.lcid = null; S.lcRm = null; X.render(); };
    if (q('#lc-rm1')) q('#lc-rm1').onclick = () => { S.lcRm = (copiesOf(S.data, S.lcv)[0] || {}).id; X.render(); };
    if (q('#lc-rm')) q('#lc-rm').onclick = async () => {
      try { const full = await db.copyRemove(A.cid, S.data.id, S.lcRm); S.lcRm = null; S.lcid = null; gotCust(full, true); if (!copiesOf(full, S.lcv).length) S.lcv = null; X.say('Copy removed'); }
      catch (e) { X.say(e.message, true); }
      X.render();
    };
    if (q('#cu-licrules')) q('#cu-licrules').onclick = () => { if (!leaveCust()) return; A.view = 'settings'; A.stab = 'licenses'; X.render(); };
    if (q('#cl-undo')) q('#cl-undo').onclick = () => { S.led = JSON.parse(S.lorig); S.err = ''; X.render(); };
    const saveLic = async () => {
      const before = JSON.parse(S.lorig);
      const ch = S.led.filter((l, i) => JSON.stringify(l) !== JSON.stringify(before[i]));
      for (const l of ch) { if (l.expires && !/^\d{4}-\d{2}-\d{2}$/.test(l.expires)) { S.err = 'The date on ' + licName(l.kind) + ' doesn’t look right.'; return X.render(); } }
      try {
        let full = null;
        for (const l of ch) full = await db.licensePut(A.cid, S.data.id, l);
        if (full) gotCust(full);
        S.err = ''; X.say('✓ Licenses saved');
      } catch (e) { S.err = e.message; }
      X.render();
    };
    if (q('#cl-save')) q('#cl-save').onclick = saveLic;
    if (q('#lc-save')) q('#lc-save').onclick = saveLic;
  }

  // =====================================================================
  // Settings → Price levels · License rules
  // =====================================================================
  function levelsHtml() {
    const c = co(), mgr = X.isMgr(), ro = !mgr, dis = ro ? ' disabled' : '';
    if (!A.lv) A.lv = lvStart();
    const L = A.lv, dirty = JSON.stringify(L) !== JSON.stringify(lvStart());
    return '<div class="card form"><h2>Price levels</h2><p class="sm gap">Give them your own private codes. Customers never see them.</p>' +
      '<table class="t lvt"><thead><tr><th>Name</th><th class="n">Customers</th><th>New customers start on</th>' + (ro ? '' : '<th></th>') + '</tr></thead><tbody>' +
      L.list.map((l, i) => '<tr><td><input class="bx w" maxlength="20" data-lvn="' + i + '" value="' + esc(l.name) + '"' + dis + ' data-guide="settings-levels-name"></td><td class="n">' + lvCount(l.n) + '</td>' +
        '<td><label class="chk1 in"><input type="radio" name="lvdef" data-lvdef="' + i + '"' + (l.n && l.n === L.def ? ' checked' : '') + (l.n ? '' : ' disabled') + dis + ' data-guide="settings-levels-default"> Default</label></td>' +
        (ro ? '' : '<td><button class="xb" data-lvrm="' + i + '" aria-label="Take off this level" data-guide="settings-levels-remove"' + (lvCount(l.n) || L.list.length < 2 ? ' disabled' : '') + '>×</button></td>') + '</tr>').join('') +
      '</tbody></table>' + (ro ? '<p class="sm">Only owners and managers can change these.</p>' : L.list.length < 6 ? '<button class="btn sm addz" id="lv-add" data-guide="settings-levels-add">+ Add a level</button>' : '') + '</div>' +
      saveBarP(dirty, 'lv', 'settings-levels');
  }
  function lvStart() { const c = co(); return { list: c.levels.map((l) => ({ n: l.n, name: l.name })), def: settingsOf(c).default_level }; }
  // Customers on a level: from the customer list when it's loaded (always up to date), else what the database said.
  function lvCount(n) {
    if (!n) return 0;
    if (A.custs) return A.custs.filter((x) => x.active !== false && x.level === n).length;
    return ((co().levels.find((l) => l.n === n) || {}).customers) || 0;
  }
  function saveBarP(dirty, id, guide) {
    return '<div class="savebar' + (dirty ? '' : ' hide') + '" id="' + id + '-bar"><span id="' + id + '-err">Not saved yet</span><div class="rowr"><button class="btn" id="' + id + '-undo" data-guide="' + guide + '-undo">Undo</button><button class="btn amber" id="' + id + '-save" data-guide="' + guide + '-save">Save</button></div></div>';
  }
  function bindLevels() {
    const L = A.lv, bar = q('#lv-bar');
    if (!A.custs) load();
    const upd = () => bar.classList.toggle('hide', JSON.stringify(L) === JSON.stringify(lvStart()));
    $$('[data-lvn]').forEach((el) => { el.oninput = () => { L.list[+el.dataset.lvn].name = el.value; upd(); }; });
    $$('[data-lvdef]').forEach((el) => { el.onchange = () => { L.def = L.list[+el.dataset.lvdef].n; upd(); }; });
    $$('[data-lvrm]').forEach((b) => { b.onclick = () => { L.list.splice(+b.dataset.lvrm, 1); X.render(); }; });
    if (q('#lv-add')) q('#lv-add').onclick = () => { L.list.push({ n: null, name: '' }); X.render(); const ins = $$('[data-lvn]'); ins[ins.length - 1].focus(); };
    q('#lv-undo').onclick = () => { A.lv = null; X.render(); };
    q('#lv-save').onclick = async () => {
      const bad = levelsCheck(L.list);
      if (bad) { q('#lv-err').textContent = bad; return; }
      try {
        let nc = await db.levelsSet(A.cid, L.list.map((l) => ({ n: l.n, name: l.name.trim() })));
        if (L.def && L.def !== settingsOf(nc).default_level) nc = await db.settingsSet(A.cid, { default_level: L.def });
        X.replaceCo(nc); A.lv = null; A.hist = null; X.say('✓ Price levels saved');
      } catch (e) { X.say(e.message, true); }
      X.render();
    };
  }
  // Settings → License rules: the wholesaler picks which licenses they need in each state, and what happens when
  // one is missing or ended. Selling is never stopped: it's a warning, or a warning that asks for a manager's OK.
  const coStates = () => { const c = co() || {}; return [c.home].concat(c.others || []).filter(Boolean); };
  function lrStart() {
    const s = settingsOf(co()), need = {};
    coStates().forEach((st) => { need[st] = licNeeded(s, st).slice(); });
    return { lic_mode: s.lic_mode === 'ask' ? 'ask' : 'warn', remind_days: s.remind_days, lic_need: need };
  }
  const sameNeed = (a, b) => LICENSES.every(([k]) => a.includes(k) === b.includes(k));
  function lrDirty() {
    const R = A.lr, z = lrStart();
    return R.lic_mode !== z.lic_mode || R.remind_days !== z.remind_days || coStates().some((st) => !sameNeed(R.lic_need[st], z.lic_need[st]));
  }
  function licRulesHtml() {
    const ro = !X.isMgr(), dis = ro ? ' disabled' : '';
    if (!A.lr) A.lr = lrStart();
    const R = A.lr;
    coStates().forEach((st) => { if (!R.lic_need[st]) R.lic_need[st] = licNeeded(settingsOf(co()), st).slice(); });
    const stBlock = (st) => {
      const sug = suggestedLic(st), isSug = sameNeed(R.lic_need[st], sug);
      return '<div class="lrst"><div class="lrsth"><b>' + esc(stateName(st)) + '</b>' +
        (ro || isSug ? '' : '<button class="lnk" data-lrsug="' + st + '" data-guide="settings-licenses-suggested">Use the suggested list</button>') + '</div>' +
        '<p class="sm">' + esc(SUGGEST_NOTE[st] || 'A starting list. Pick what ' + stateName(st) + ' asks for.') + '</p>' +
        '<div class="lrks">' + LICENSES.map(([k, n]) => '<label class="lrk"><input type="checkbox" data-lrk="' + st + '|' + k + '"' + (R.lic_need[st].includes(k) ? ' checked' : '') + dis +
          ' data-guide="settings-licenses-need"><span><b>' + esc(n) + '</b><small>' + esc(LIC_COVER_TEXT[k]) + '</small></span></label>').join('') + '</div></div>';
    };
    return '<div class="card form"><h2>Licenses you need to sell</h2><p class="sm gap">Pick them for each state you sell in. Only these show as needed on your customers.</p>' +
      coStates().map(stBlock).join('') +
      '<h2 class="mt">When a needed license is missing or ended</h2>' +
      '<div class="seg"><button class="' + (R.lic_mode === 'warn' ? 'on' : '') + '" id="lr-warn" data-guide="settings-licenses-warn-only"' + dis + '>Only warn me</button>' +
      '<button class="' + (R.lic_mode === 'ask' ? 'on' : '') + '" id="lr-ask" data-guide="settings-licenses-ask-manager"' + dis + '>Ask for a manager’s OK</button></div>' +
      '<p class="sm">You can always still sell. Every time someone sells anyway, it’s written in the customer’s History.</p>' +
      '<h2 class="mt">Remind me before a license ends</h2><label class="fld narrow"><select id="lr-days" data-guide="settings-licenses-remind"' + dis + '>' +
      [0, 14, 30, 60, 90].map((n) => opt(n, n ? n + ' days before' : 'Don’t remind me', n === R.remind_days)).join('') + '</select></label>' +
      (ro ? '<p class="sm">Only owners and managers can change these.</p>' : '') + '</div>' + saveBarP(lrDirty(), 'lr', 'settings-licenses');
  }
  function bindLicRules() {
    const R = A.lr;
    const upd = () => q('#lr-bar').classList.toggle('hide', !lrDirty());
    $$('[data-lrk]').forEach((el) => { el.onchange = () => {
      const [st, k] = el.dataset.lrk.split('|'), L = R.lic_need[st];
      if (el.checked && !L.includes(k)) L.push(k);
      if (!el.checked && L.includes(k)) L.splice(L.indexOf(k), 1);
      upd();
    }; });
    $$('[data-lrsug]').forEach((b) => { b.onclick = () => { R.lic_need[b.dataset.lrsug] = suggestedLic(b.dataset.lrsug); X.render(); }; });
    q('#lr-warn').onclick = () => { R.lic_mode = 'warn'; X.render(); };
    q('#lr-ask').onclick = () => { R.lic_mode = 'ask'; X.render(); };
    q('#lr-days').onchange = (e) => { R.remind_days = +e.target.value; upd(); };
    q('#lr-undo').onclick = () => { A.lr = null; X.render(); };
    q('#lr-save').onclick = async () => {
      const need = {};
      coStates().forEach((st) => { need[st] = LICENSES.map((l) => l[0]).filter((k) => R.lic_need[st].includes(k)); });
      const bad = licNeedCheck(need, coStates());
      if (bad) { q('#lr-err').textContent = bad; return; }
      try { X.replaceCo(await db.settingsSet(A.cid, { lic_mode: R.lic_mode, remind_days: R.remind_days, lic_need: need })); A.lr = null; A.hist = null; X.say('✓ License rules saved'); } catch (e) { X.say(e.message, true); }
      X.render();
    };
  }

  return { load, itemsHtml, bindItems, custHtml, bindCust, levelsHtml, bindLevels, licRulesHtml, bindLicRules, openCust };
}
