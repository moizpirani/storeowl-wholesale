// "Bring in from your old system": Upload → Check → Bring it in. Columns are matched by themselves;
// only columns StoreOwl couldn't tell are asked about, on the Check page.
// Nothing is saved until "Bring in". Rows already in StoreOwl are left alone, and an import can be taken back.
// Typing never redraws: the old-system total box updates the match line in place.

import { parseCsv, tidy, guessKind, guessMap, fieldsFor, buildItems, buildCustomers } from './importer.js';
import { settingsOf, catName } from './rules.js';

const BATCH = 500;

export function makeImport(X) {
  const { A, db, root, esc, opt } = X;
  const q = (s) => root.querySelector(s);
  const $$ = (s) => Array.from(root.querySelectorAll(s));
  const co = () => X.co();
  const money$ = (v) => (Number(v) < 0 ? '−$' : '$') + Math.abs(Number(v || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const word = (k, n) => (k === 'items' ? (n === 1 ? 'item' : 'items') : (n === 1 ? 'customer' : 'customers'));

  function start(kind, from) {
    A.im = { step: 'pick', kind: kind || 'items', from: from || 'home', file: '', table: null, map: [], built: null, old: '', busy: false, prog: '', err: '', done: null, list: null, undoAsk: null };
    A.view = 'import';
    X.render();
  }
  function S() { if (!A.im) A.im = { step: 'pick', kind: 'items', from: 'home', map: [], old: '', list: null }; return A.im; }

  function rebuild() {
    const s = S(), c = co();
    s.built = s.kind === 'items'
      ? buildItems(s.table, s.map, c.levels, A.items || [])
      : buildCustomers(s.table, s.map, c.levels, A.custs || [], settingsOf(c).default_level);
  }

  // ---------- the page ----------
  function html() {
    const s = S();
    const backTo = s.from === 'customers' ? 'Customers' : s.from === 'items' ? 'Items' : 'Home';
    const steps = [['pick', 'Upload'], ['check', 'Check'], ['done', 'Bring it in']];
    const at = steps.findIndex((x) => x[0] === s.step);
    const bar = '<div class="steps3">' + steps.map((x, i) => '<span class="' + (i < at ? 'done' : i === at ? 'on' : '') + '">' + (i < at ? '✓ ' : '') + x[1] + '</span>').join('') + '</div>';
    let body = '';
    if (s.step === 'pick') body = pickHtml();
    if (s.step === 'check') body = checkHtml();
    if (s.step === 'done') body = doneHtml();
    return '<button class="back" id="im-back" data-guide="import-back"><i>‹</i>Back to ' + backTo + '</button>' +
      '<div class="hdr"><h1>Bring in from your old system</h1></div>' + bar + body;
  }

  function pickHtml() {
    const s = S();
    const list = s.list;
    const fixed = s.from === 'items' || s.from === 'customers';
    return '<div class="imp"><div><div class="card"><h2>' + (fixed ? 'Bring in your ' + word(s.kind, 2) : 'What are you bringing in?') + '</h2>' +
      (fixed ? '' : '<div class="seg"><button class="' + (s.kind === 'items' ? 'on' : '') + '" data-imk="items" data-guide="import-kind">Items</button>' +
      '<button class="' + (s.kind === 'customers' ? 'on' : '') + '" data-imk="customers" data-guide="import-kind">Customers</button></div>') +
      '<label class="drop" id="im-drop"><input type="file" id="im-file" accept=".csv,.txt,.xlsx,.xls" data-guide="import-file">' +
      '<b>' + (s.busy ? 'Reading the file…' : 'Pick a file from your old system') + '</b><span>Excel or CSV · one row for each ' + word(s.kind, 1) + '</span></label>' +
      (s.err ? '<p class="msgline bad">' + esc(s.err) + '</p>' : '') + '</div></div>' +
      '<div><div class="card"><h2>Brought in before</h2>' + (list == null ? '<p class="sm">Loading…</p>' : !list.length ? '<p class="sm">Nothing yet</p>' :
        '<table class="t tsm"><tbody>' + list.slice(0, 8).map((x) => '<tr><td><b>' + esc(x.file || (x.kind === 'items' ? 'Items' : 'Customers')) + '</b><span class="sm">' +
          x.added.toLocaleString() + ' ' + word(x.kind, x.added) + ' · ' + esc(X.when(x.at)) + ' · ' + esc(x.by_name) + '</span></td><td class="r">' +
          (x.undone_at ? '<span class="sm">Taken back</span>' : s.undoAsk === x.id
            ? '<button class="btn sm red" data-imundo="' + x.id + '" data-guide="import-undo-confirm">Take back ' + x.added + '?</button>'
            : '<button class="btn sm" data-imundo1="' + x.id + '" data-guide="import-undo">Take back</button>') + '</td></tr>').join('') + '</tbody></table>') + '</div></div></div>';
  }

  // The columns card on the Check page: one line when every column was understood, else only the ones that weren't.
  function colsHtml() {
    const s = S(), F = fieldsFor(s.kind, co().levels), H = s.table.head;
    const sample = (i) => s.table.rows.slice(0, 2).map((r) => r[i]).filter(Boolean).map((v) => esc(String(v).slice(0, 30))).join(' · ');
    const nm = (f) => (F.find((x) => x[0] === f) || [f, f])[1];
    const unk = H.map((h, i) => i).filter((i) => !s.map[i]);
    const noName = !s.map.includes('name');
    const sel = (i) => '<select class="sel" data-immap="' + i + '" data-guide="import-check-column">' + opt('', 'Leave it out', !s.map[i]) +
      F.map((f) => opt(f[0], f[1], s.map[i] === f[0])).join('') + '</select>';
    const rowsOf = (list) => '<table class="t tsm colst"><tbody>' + list.map((i) => '<tr><td><b>' + esc(H[i]) + '</b><span class="sm">' + (sample(i) || 'empty') + '</span></td><td>' + sel(i) + '</td></tr>').join('') + '</tbody></table>';
    if (noName) {
      return '<div class="card colsask"><h2>Which column has the ' + (s.kind === 'items' ? 'item' : 'customer') + ' name?</h2>' + rowsOf(H.map((h, i) => i)) + '</div>';
    }
    let h = '';
    if (unk.length) {
      h = '<div class="card colsask"><h2>StoreOwl didn’t know ' + (unk.length === 1 ? '1 column' : unk.length + ' columns') + '</h2>' +
        '<p class="sm">' + (unk.length === 1 ? 'It’s' : 'They’re') + ' left out unless you pick what ' + (unk.length === 1 ? 'it is' : 'they are') + '.</p>' + rowsOf(unk) + '</div>';
    }
    const known = H.map((x, i) => i).filter((i) => s.map[i]);
    h += '<div class="colsok"><span>✓ StoreOwl understood ' + (unk.length ? known.length + ' of ' + H.length : 'all ' + H.length) + ' columns in ' + esc(s.file) + '</span>' +
      '<button class="lnk" id="im-cols" data-guide="import-check-columns-see">' + (s.showCols ? 'Hide' : 'See how') + '</button></div>' +
      (s.showCols ? '<div class="card colsall"><table class="t tsm colst"><thead><tr><th>Your file</th><th>Goes to</th><th>First rows</th></tr></thead><tbody>' +
        known.map((i) => '<tr><td><b>' + esc(H[i]) + '</b></td><td>' + sel(i) + '</td><td class="mut">' + (sample(i) || '—') + '</td></tr>').join('') + '</tbody></table></div>' : '');
    return h;
  }

  function checkHtml() {
    const s = S(), b = s.built, K = s.kind;
    if (!b) return '<div class="imp"><div class="card"><p class="sm">Reading ' + esc(s.file) + '…</p></div></div>';
    if (!s.map.includes('name')) return '<div class="imp"><div>' + colsHtml() + '</div><div><div class="card"><h2>' + esc(s.file) + '</h2>' +
      '<div class="chk"><span>Rows in your file</span><b>' + s.table.rows.length.toLocaleString() + '</b></div>' +
      '<div class="rowr"><button class="btn" id="im-mback" data-guide="import-check-back">Pick another file</button></div></div></div></div>';
    const need = b.bad.slice(0, 200);
    const left = '<div>' + colsHtml() + '<div class="tcard"><div class="cch"><b>' + (b.bad.length ? b.bad.length.toLocaleString() + ' rows need a look · they’re left out' : '✓ Every row is ready') + '</b>' +
      (b.skip.length ? '<span class="sm">' + b.skip.length.toLocaleString() + ' already in StoreOwl · left alone</span>' : '') + '</div>' +
      (b.bad.length ? '<table class="t tsm"><thead><tr><th>Row</th><th>Name</th><th>Why</th></tr></thead><tbody>' +
        need.map((x) => '<tr><td class="mut">' + x.row + '</td><td><b>' + esc(x.name) + '</b></td><td class="miss">' + esc(x.why) + '</td></tr>').join('') +
        (b.bad.length > need.length ? '<tr><td colspan="3" class="empty">and ' + (b.bad.length - need.length).toLocaleString() + ' more</td></tr>' : '') + '</tbody></table>'
        : '<p class="emptyc">Fix rows in your file and pick it again any time. Rows already brought in are left alone.</p>') +
      (b.good.length ? '<div class="cch"><b>First rows going in</b></div><table class="t tsm"><tbody>' + b.good.slice(0, 6).map((g) => '<tr><td><b>' + esc(g.name) + '</b></td><td class="mut">' +
        (K === 'items' ? esc(catName(g.category)) + ' · ' + esc(g.sizes[0].name) + (g.sizes[0].n > 1 ? ' · ' + g.sizes[0].n : '') : esc([g.store_no ? '#' + g.store_no : '', g.city].filter(Boolean).join(' · '))) +
        '</td><td class="n">' + (K === 'items' ? (g.sizes[0].upc ? esc(g.sizes[0].upc) : '<span class="miss">No UPC</span>') : money$(g.opening)) + '</td></tr>').join('') + '</tbody></table>' : '') + '</div></div>';
    const row = (l, v, cls) => '<div class="chk"><span>' + l + '</span><b' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</b></div>';
    let right = '<div class="card"><h2>Did everything come over?</h2>' + row('Rows in your file', b.total.toLocaleString()) + row('Ready to bring in', b.good.length.toLocaleString(), 'ok2') +
      row('Need a look', b.bad.length.toLocaleString(), b.bad.length ? 'miss' : '') + (b.skip.length ? row('Already in StoreOwl', b.skip.length.toLocaleString()) : '');
    if (K === 'items') {
      const noUpc = b.good.filter((g) => !g.sizes[0].upc).length, noCost = b.good.filter((g) => g.sizes[0].cost == null).length;
      if (b.fixed) right += '<p class="sm">' + b.fixed + ' UPCs had their first 0 put back (Excel drops it).</p>';
      if (noUpc || noCost) right += '<p class="sm">' + [noUpc ? noUpc + ' with no UPC' : '', noCost ? noCost + ' with no cost' : ''].filter(Boolean).join(' · ') + ': they come in and show under Needs you.</p>';
    } else {
      const noTob = b.good.filter((g) => !g.licenses.some((l) => l.kind === 'tobacco')).length;
      const off = s.old === '' ? null : Math.round((b.balance - Number(String(s.old).replace(/[$,\s]/g, ''))) * 100) / 100;
      right += row('Balances coming in', money$(b.balance)) + (b.outBal ? row('Balances on rows left out', money$(b.outBal)) : '') +
        '<label class="fld"><span>What your old system says customers owe</span><input id="im-old" inputmode="decimal" value="' + esc(s.old) + '" placeholder="Type the total from your old system" data-guide="import-check-old-total"></label>' +
        '<div id="im-match">' + matchLine(off) + '</div>' +
        (noTob ? '<p class="sm">' + noTob + (noTob === 1 ? ' customer has' : ' customers have') + ' no tobacco license # in the file. Tobacco stays stopped for them until one is added.</p>' : '');
    }
    right += (s.err ? '<p class="msgline bad">' + esc(s.err) + '</p>' : '') +
      '<div class="rowr"><button class="btn" id="im-mback" data-guide="import-check-back">Pick another file</button><button class="btn amber" id="im-go" data-guide="import-check-bring-in"' + (b.good.length && !s.busy ? '' : ' disabled') + '>' +
      (s.busy ? esc(s.prog || 'Bringing in…') : 'Bring in ' + b.good.length.toLocaleString() + ' ' + word(K, b.good.length)) + '</button></div></div>';
    return '<div class="imp">' + left + '<div>' + right + '</div></div>';
  }
  function matchLine(off) {
    if (off == null || isNaN(off)) return '';
    if (off === 0) return '<div class="match">✓ Balances match to the cent</div>';
    const ob = (S().built || {}).outBal || 0;
    const hint = ob && Math.round((off + ob) * 100) === 0 ? '<span class="why">That’s the rows that need a look. Fix them in your file and bring it in again.</span>' : '';
    return '<div class="match off">Off by ' + money$(Math.abs(off)) + (off > 0 ? ' · the file has more' : ' · the file has less') + hint + '</div>';
  }

  function doneHtml() {
    const s = S(), d = s.done;
    return '<div class="imp"><div class="card"><h2>✓ Brought in ' + d.added.toLocaleString() + ' ' + word(s.kind, d.added) + '</h2>' +
      '<div class="chk"><span>From</span><b>' + esc(s.file) + '</b></div>' +
      (d.skipped ? '<div class="chk"><span>Already in StoreOwl · left alone</span><b>' + d.skipped.toLocaleString() + '</b></div>' : '') +
      (s.built.bad.length ? '<div class="chk"><span>Left out · needed a look</span><b class="miss">' + s.built.bad.length.toLocaleString() + '</b></div>' : '') +
      (s.kind === 'customers' ? '<div class="chk"><span>Starting balances</span><b>' + money$(d.balance) + '</b></div>' : '') +
      '<div class="rowr"><button class="btn" id="im-more" data-guide="import-done-another">Bring in another file</button>' +
      '<button class="btn amber" id="im-open" data-guide="import-done-open">Open ' + (s.kind === 'items' ? 'Items' : 'Customers') + '</button></div></div>' +
      '<div class="card"><h2>Made a mistake?</h2><p class="sm gap">Take this import back. Everything it added goes away.</p>' +
      (s.undoAsk === d.id ? '<button class="btn red" data-imundo="' + d.id + '" data-guide="import-undo-confirm">Take back ' + d.added.toLocaleString() + ' ' + word(s.kind, d.added) + '?</button>'
        : '<button class="btn" data-imundo1="' + d.id + '" data-guide="import-undo">Take it back</button>') + '</div></div>';
  }

  // ---------- reading the file ----------
  async function readFile(f) {
    const s = S();
    s.busy = true; s.err = ''; X.render();
    try {
      let table;
      if (/\.xlsx?$/i.test(f.name)) {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
        const sh = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(sh, { header: 1, raw: true, defval: '' });
        table = tidy(raw.map((r) => r.map((c) => (typeof c === 'number' && Number.isInteger(c) ? String(c) : c))));
      } else {
        table = parseCsv(await f.text());
      }
      if (!table.rows.length) throw new Error('That file has no rows.');
      if (table.rows.length > 20000) throw new Error('That file has more than 20,000 rows. Split it into smaller files.');
      gotTable(f.name, table);
    } catch (e) {
      s.busy = false; s.err = /zip|corrupt|Unsupported/i.test(e.message) ? 'StoreOwl can’t read that file. Save it as Excel (.xlsx) or CSV and try again.' : e.message;
      X.render();
    }
  }
  function gotTable(name, table) {
    const s = S();
    s.file = name; s.table = table; s.busy = false;
    if (s.from !== 'items' && s.from !== 'customers') s.kind = guessKind(table.head);
    s.map = guessMap(s.kind, table.head, co().levels);
    s.step = 'check'; s.showCols = false; s.err = '';
    const go = () => { rebuild(); X.render(); };
    if (A.items == null || A.custs == null) X.loadAll().then(go); else go();
  }

  async function bringIn() {
    const s = S(), b = s.built, cid = A.cid;
    s.busy = true; s.err = ''; s.prog = 'Starting…'; X.render();
    try {
      const imp = await db.importStart(cid, { kind: s.kind, file: s.file, old_total: s.old === '' ? null : String(s.old).replace(/[$,\s]/g, '') });
      const rows = b.good.map((g) => { const o = Object.assign({}, g); delete o.row; return o; });
      const tot = { added: 0, skipped: 0, balance: 0 };
      for (let i = 0; i < rows.length; i += BATCH) {
        s.prog = 'Bringing in ' + Math.min(i + BATCH, rows.length).toLocaleString() + ' of ' + rows.length.toLocaleString() + '…';
        const btn = q('#im-go'); if (btn) btn.textContent = s.prog;
        const r = s.kind === 'items' ? await db.importItems(cid, imp, rows.slice(i, i + BATCH)) : await db.importCustomers(cid, imp, rows.slice(i, i + BATCH));
        tot.added += r.added; tot.skipped += r.skipped; tot.balance += Number(r.balance || 0);
      }
      await db.importFinish(cid, imp);
      s.done = { id: imp, added: tot.added, skipped: tot.skipped + b.skip.length, balance: Math.round(tot.balance * 100) / 100 };
      s.step = 'done'; s.busy = false; s.undoAsk = null; s.list = null;
      A.items = null; A.custs = null; A.hist = null;
      X.reload();
    } catch (e) { s.busy = false; s.err = e.message; }
    X.render();
  }

  // ---------- binding ----------
  function bind() {
    const s = S();
    q('#im-back').onclick = () => { const to = s.from === 'customers' || s.from === 'items' ? s.from : 'home'; A.im = null; A.view = to; X.render(); };
    if (s.step === 'pick') {
      $$('[data-imk]').forEach((b) => { b.onclick = () => { s.kind = b.dataset.imk; X.render(); }; });
      const f = q('#im-file'); f.onchange = () => { if (f.files[0]) readFile(f.files[0]); };
      const dz = q('#im-drop');
      dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
      dz.ondragleave = () => dz.classList.remove('over');
      dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); const file = e.dataTransfer.files[0]; if (file) readFile(file); };
      if (s.list == null && X.isMgr()) db.imports(A.cid).then((l) => { s.list = l; X.render(); }).catch(() => { s.list = []; X.render(); });
    }
    if (s.step === 'check') {
      const o = q('#im-old');
      if (o && s.built) o.oninput = () => {
        s.old = o.value;
        const v = Number(String(o.value).replace(/[$,\s]/g, ''));
        q('#im-match').innerHTML = matchLine(o.value.trim() === '' || isNaN(v) ? null : Math.round((s.built.balance - v) * 100) / 100);
      };
      q('#im-mback').onclick = () => { s.step = 'pick'; s.table = null; s.built = null; X.render(); };
      $$('[data-immap]').forEach((el) => { el.onchange = () => {
        const i = +el.dataset.immap, v = el.value;
        if (v) s.map = s.map.map((m, j) => (m === v && j !== i ? '' : m));   // one column per field
        s.map[i] = v; rebuild(); X.render();
      }; });
      const sc = q('#im-cols'); if (sc) sc.onclick = () => { s.showCols = !s.showCols; X.render(); };
      const g = q('#im-go'); if (g) g.onclick = bringIn;
    }
    if (s.step === 'done') {
      q('#im-more').onclick = () => { s.step = 'pick'; s.table = null; s.done = null; X.render(); };
      q('#im-open').onclick = () => { const k = s.kind; A.im = null; A.view = k; X.render(); };
    }
    $$('[data-imundo1]').forEach((b) => { b.onclick = () => { s.undoAsk = b.dataset.imundo1; X.render(); }; });
    $$('[data-imundo]').forEach((b) => { b.onclick = async () => {
      try {
        const r = await db.importUndo(A.cid, b.dataset.imundo);
        X.say('✓ Took back ' + r.removed.toLocaleString() + ' ' + word(s.done ? s.kind : ((s.list || []).find((x) => x.id === b.dataset.imundo) || {}).kind, r.removed));
        s.undoAsk = null; s.list = null; A.items = null; A.custs = null; A.hist = null;
        if (s.step === 'done') { s.step = 'pick'; s.done = null; s.table = null; }
        X.reload();
      } catch (e) { X.say(e.message, true); }
      X.render();
    }; });
  }

  return { html, bind, start, gotTable };
}
