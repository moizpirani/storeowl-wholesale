// Phase 2, piece 3 on the screen: print / email / EDI after a sale, the same on Invoices (Resend), and
// Settings → Invoices. The invoice itself is worked out in src/invoice.js; emails go out from the website (api/send.js).

import { invModel, invoiceHtml, invoicePdf, pdfName, PRINT_CSS, invSettings, INV_DEFAULT, sendChoice, invEmail, ediProblems, ediBlocked, ediFile, ediName, ediCsv, taxText } from './invoice.js';
import { todayIso, shortDate } from './rules.js';

export function makeInvUi(X) {
  const { A, db, root, esc } = X;
  const q = (s) => root.querySelector(s), $$ = (s) => Array.from(root.querySelectorAll(s));
  const co = () => X.co() || {};

  // Lines get the item's photo from the item list (the sale keeps names and prices, not pictures).
  function withPhotos(sale) {
    const ph = {}; (A.items || []).forEach((it) => { ph[it.id] = it.photo_url || ''; });
    return Object.assign({}, sale, { lines: (sale.lines || []).map((l) => Object.assign({}, l, { photo_url: l.photo_url || ph[l.item_id] || '' })) });
  }
  // Everything for one invoice: {sale, cust, M}. fresh = just posted (shows "owed before" and "owe now").
  async function load(saleId, fresh) {
    const d = await db.invoiceData(A.cid, saleId);
    const sale = withPhotos(d.sale);
    return { sale, cust: d.customer, M: invModel({ sale, co: d.company || co(), cust: d.customer, fresh, today: todayIso() }) };
  }

  // ---------- printing: the invoice goes in #printout (outside the app) and the browser prints only that ----------
  function print(M, copies) {
    let box = document.getElementById('printout');
    if (!box) { box = document.createElement('div'); box.id = 'printout'; document.body.appendChild(box); }
    const one = invoiceHtml(M);
    box.innerHTML = '<style>@media screen{#printout{display:none}}@media print{body>*:not(#printout){display:none!important}#printout{display:block}}' + PRINT_CSS + '</style>' +
      Array.from({ length: Math.max(1, copies || 1) }, () => one).join('');
    try { if (typeof window.print === 'function' && !/jsdom/i.test(navigator.userAgent)) window.print(); } catch (e) { /* the page still has it */ }
  }
  function download(name, data, type) {
    const blob = new Blob([data], { type });
    const a = document.createElement('a');
    try { a.href = URL.createObjectURL(blob); } catch (e) { return; }
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch (e) { /* gone */ } }, 4000);
  }

  // ---------- what to send: one box per way, with where it goes or why it can't ----------
  // P = {print, copies, email, edi}; I = {sale, cust}
  function choicesHtml(P, I, pre) {
    const c = I.cust || {}, mail = invEmail(c), probs = ediProblems(I.sale, c), block = ediBlocked(I.sale, c);
    const box = (k, label, sub, ok, extra) => '<label class="ivch' + (P[k] && ok ? ' on' : '') + (ok ? '' : ' off') + '"><input type="checkbox" data-ivk="' + k + '"' + (P[k] && ok ? ' checked' : '') + (ok ? '' : ' disabled') +
      ' data-guide="' + pre + '-' + k + '"><span><b>' + label + '</b><small>' + sub + '</small>' + (extra || '') + '</span></label>';
    const copies = '<select class="ivcp" id="' + pre + '-copies" data-guide="' + pre + '-copies">' + [1, 2, 3, 4, 5].map((n) => '<option value="' + n + '"' + (n === P.copies ? ' selected' : '') + '>' + n + (n === 1 ? ' copy' : ' copies') + '</option>').join('') + '</select>';
    const ediSub = !c.edi_email ? 'No EDI email for this store · add it on the customer’s Details' : 'To ' + esc(c.edi_email) + ' · ' + esc(ediName(I.sale, c));
    const ediNote = c.edi_email && probs.length ? '<span class="ivprob">' + probs.map((p) => esc(p.t)).join('<br>') + '</span>' : '';
    return '<div class="ivchs">' +
      box('print', 'Print', 'Letter paper', true, copies) +
      box('email', (I.sale && I.sale.kind === 'credit') ? 'Email the credit memo' : 'Email the invoice', mail ? 'PDF to ' + esc(mail) : 'No email for this store · add it on the customer’s Details', !!mail) +
      box('edi', 'Email the EDI file', ediSub, !!c.edi_email && !block, ediNote) + '</div>';
  }
  function bindChoices(P, pre, onChange) {
    $$('[data-ivk]').forEach((el) => { el.onchange = () => { P[el.dataset.ivk] = el.checked; el.closest('.ivch').classList.toggle('on', el.checked); if (onChange) onChange(); }; });
    const cp = q('#' + pre + '-copies'); if (cp) cp.onchange = () => { P.copies = +cp.value; };
  }
  // Do what's ticked. Returns the messages (good and bad) in plain words.
  async function run(P, I) {
    const said = [], bad = [];
    if (P.print) {
      print(I.M, P.copies);
      try { I.sale = Object.assign(I.sale, await db.saleSent(A.cid, I.sale.id, { kind: 'print', to: P.copies + (P.copies === 1 ? ' copy' : ' copies') })); } catch (e) { /* printing still happened */ }
      said.push('printed');
    }
    if (P.email || P.edi) {
      try {
        const r = await db.sendInvoice(A.cid, I.sale.id, { email: !!P.email, edi: !!P.edi });
        (r.sent || []).forEach((s) => { if (s.ok) said.push((s.kind === 'edi' ? 'EDI file' : 'invoice') + ' emailed to ' + s.to); else bad.push((s.kind === 'edi' ? 'EDI file' : 'Invoice') + ' didn’t go to ' + s.to + ': ' + (s.err || 'try again')); });
        if (r.sale) I.sale = Object.assign(I.sale, r.sale);
      } catch (e) { bad.push('The email didn’t go: ' + e.message + ' Resend it from Invoices.'); }
    }
    return { said, bad };
  }

  // ---------- after Complete sale ----------
  // C.done = {sale (from sale_save), I (loaded), P (choices)}
  function doneHtml(C) {
    const D = C.done, s = D.sale;
    const cr = s.kind === 'credit';
    const head = '<div class="ctok">✓</div><h2>' + (cr ? 'Credit memo ' : 'Invoice ') + esc(s.number) + ' posted</h2><p>' + X.money(s.total) + (cr ? ' · taken off what they owe' : ' · charged to account') + '</p>';
    if (!D.I) return '<h1>Counter</h1><div class="card ctdone">' + head + '<p class="sm">Getting the invoice ready…</p></div>';
    const any = D.P.print || D.P.email || D.P.edi;
    return '<h1>Counter</h1><div class="card ctdone">' + head + '<h3 class="ivh">Send it</h3>' + choicesHtml(D.P, D.I, 'counter-done') +
      '<div class="rowr rowc"><button class="btn" id="ct-home" data-guide="counter-done-home">Back to Counter</button>' +
      '<button class="btn amber" id="ct-next" data-guide="counter-done-next">' + (any ? 'Send and start next sale' : 'Next sale') + '</button></div></div>';
  }
  function bindDone(C, next, home) {
    const D = C.done;
    if (!D.I && !D.loading) {
      D.loading = true;
      load(D.sale.id, true).then((I) => { D.I = I; D.P = Object.assign({ copies: invSettings(co()).copies }, sendChoice(co(), I.cust)); D.P.edi = D.P.edi && !ediBlocked(I.sale, I.cust); if (A.view === 'counter') X.render(); })
        .catch((e) => { X.say(e.message, true); D.I = { sale: D.sale, cust: {}, M: null }; D.P = { print: false, email: false, edi: false, copies: 1 }; X.render(); });
    }
    if (!D.I) return;
    const nb = q('#ct-next');
    bindChoices(D.P, 'counter-done', () => { if (nb) nb.textContent = D.P.print || D.P.email || D.P.edi ? 'Send and start next sale' : 'Next sale'; });
    const go = async (after) => {
      if (!(D.P.print || D.P.email || D.P.edi) || !D.I.M) return after();
      nb.disabled = true; nb.textContent = 'Sending…';
      const r = await run(D.P, D.I);
      after();
      const nm = (D.sale.kind === 'credit' ? 'Credit memo ' : 'Invoice ');
      if (r.bad.length) X.say(nm + D.sale.number + (r.said.length ? ' ' + r.said.join(', ') + '. ' : '. ') + r.bad.join(' '), true);
      else X.say('✓ ' + nm + D.sale.number + ' ' + r.said.join(', '));
      A.ivs = null; X.render();
    };
    if (nb) nb.onclick = () => go(next);
    const hb = q('#ct-home'); if (hb) hb.onclick = () => go(home);
  }

  // ---------- Invoices: the panel for one invoice (print again, Resend, downloads, what went out) ----------
  const KIND = { print: 'Printed', email: 'Invoice emailed', edi: 'EDI file emailed', pdf: 'PDF downloaded', file: 'EDI file downloaded' };
  function sentHtml(s) {
    const L = (s.sends || []).slice().reverse();
    if (!L.length) return '<p class="sm">Not printed or emailed yet.</p>';
    return '<ul class="ivsent">' + L.slice(0, 8).map((x) => '<li class="' + (x.ok === false ? 'bad' : '') + '">' + (x.ok === false ? '✗ ' : '✓ ') + esc(KIND[x.kind] || x.kind) +
      (x.to ? ' · ' + esc(x.to) : '') + '<small>' + esc(X.when(x.at)) + ' · ' + esc(x.by || '') + (x.err ? ' · ' + esc(x.err) : '') + '</small></li>').join('') + '</ul>';
  }
  function panelHtml(sel) {
    const V = A.ivp && A.ivp.id === sel.id ? A.ivp : null;
    const base = '<h3 class="ivh">Print or send</h3>';
    if (!V || !V.I) return base + '<p class="sm">Getting the invoice ready…</p>';
    const was = (k) => (V.I.sale.sends || []).some((x) => x.kind === k && x.ok !== false);
    const btn = (id, t, g, amber) => '<button class="btn' + (amber ? ' amber' : '') + ' sm" id="' + id + '" data-guide="invoices-invoice-' + g + '">' + t + '</button>';
    const any = V.P.print || V.P.email || V.P.edi;
    return base + choicesHtml(V.P, V.I, 'invoices-invoice') +
      '<div class="rowr ivbtns">' + btn('ivd-pdf', 'Download PDF', 'download-pdf') + (ediBlocked(V.I.sale, V.I.cust) ? '' : btn('ivd-edi', 'EDI file', 'download-edi') + btn('ivd-csv', 'Spreadsheet', 'download-spreadsheet')) +
      '<button class="btn amber sm" id="ivd-go" data-guide="invoices-invoice-send"' + (any ? '' : ' disabled') + '>' + (was('email') || was('edi') || was('print') ? 'Send again' : 'Send') + '</button></div>' +
      '<h3 class="ivh">What went out</h3>' + sentHtml(V.I.sale);
  }
  function bindPanel(sel) {
    if (!A.ivp || A.ivp.id !== sel.id) {
      A.ivp = { id: sel.id, I: null, P: { print: false, email: false, edi: false, copies: invSettings(co()).copies } };
      const id = sel.id;
      load(id, false).then((I) => { if (!A.ivp || A.ivp.id !== id) return; A.ivp.I = I; if (A.view === 'invoices') X.render(); }).catch((e) => X.say(e.message, true));
      return;
    }
    const V = A.ivp; if (!V.I) return;
    const gb = q('#ivd-go');
    bindChoices(V.P, 'invoices-invoice', () => { if (gb) gb.disabled = !(V.P.print || V.P.email || V.P.edi); });
    const note = async (kind) => { try { V.I.sale = Object.assign(V.I.sale, await db.saleSent(A.cid, V.I.sale.id, { kind })); } catch (e) { /* only a note */ } };
    const pd = q('#ivd-pdf'); if (pd) pd.onclick = async () => { download(pdfName(V.I.M), invoicePdf(V.I.M).bytes, 'application/pdf'); await note('pdf'); X.render(); };
    const ed = q('#ivd-edi'); if (ed) ed.onclick = async () => { download(ediName(V.I.sale, V.I.cust), ediFile(V.I.sale, V.I.cust), 'text/plain'); await note('file'); X.render(); };
    const cs = q('#ivd-csv'); if (cs) cs.onclick = () => download('Invoice-' + V.I.sale.number + '.csv', ediCsv(V.I.sale), 'text/csv');
    if (gb) gb.onclick = async () => {
      gb.disabled = true; gb.textContent = 'Sending…';
      const r = await run(V.P, V.I);
      V.P.print = V.P.email = V.P.edi = false;
      const row = (A.ivs.list || []).find((x) => x.id === V.I.sale.id); if (row) row.sends = V.I.sale.sends;
      if (r.bad.length) X.say(r.bad.join(' '), true); else X.say('✓ Invoice ' + V.I.sale.number + ' ' + r.said.join(', '));
      X.render();
    };
  }

  // ---------- Settings → Invoices ----------
  function setStart() { const s = invSettings(co()); return JSON.parse(JSON.stringify(s)); }
  const setDirty = () => JSON.stringify(A.invs) !== JSON.stringify(setStart());
  function settingsHtml() {
    if (!A.invs) A.invs = setStart();
    const S = A.invs, ro = !X.isMgr(), dis = ro ? ' disabled' : '';
    const chk = (k, t, sub, path) => { const v = path ? S[path][k] : S[k];
      return '<label class="lrk"><input type="checkbox" data-isk="' + (path ? path + '.' : '') + k + '"' + (v ? ' checked' : '') + dis + ' data-guide="settings-invoices-' + (path ? path + '-' : '') + k.replace('_', '-') + '"><span><b>' + t + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span></label>'; };
    const tax = taxText(co(), Object.assign({}, S, { tax_line: true }));
    return '<div class="cgrid2"><div class="card form2"><h2>At the top of every invoice</h2>' +
      '<label class="fld"><span>Your license numbers (one per line)</span><textarea rows="3" data-isv="lic" placeholder="TN Tobacco Distributor #12345" data-guide="settings-invoices-licenses"' + dis + '>' + esc(S.lic) + '</textarea></label>' +
      '<label class="fld"><span>MSA / directory ID</span><input data-isv="msa" value="' + esc(S.msa) + '" data-guide="settings-invoices-msa"' + dis + '></label>' +
      '<h2 class="mt">What the invoice shows</h2><div class="lrks">' + chk('photos', 'Item photos') + chk('barcodes', 'Barcodes', 'A real UPC barcode for each line') +
      chk('owes', 'What the store owes', 'Before and after this invoice') + chk('sign', 'Signature line') +
      chk('tax_line', 'Tobacco tax paid line', 'Only on invoices with cigarettes') + '</div>' +
      '<label class="fld"><span>Tax paid line</span><input data-isv="tax_text" value="' + esc(S.tax_text) + '" placeholder="' + esc(tax || 'Type your state’s words') + '" data-guide="settings-invoices-tax-text"' + dis + '></label>' +
      '<label class="fld"><span>At the bottom (your policy)</span><textarea rows="3" data-isv="footer" data-guide="settings-invoices-footer"' + dis + '>' + esc(S.footer) + '</textarea></label></div>' +
      '<div class="card form2"><h2>After a sale</h2><p class="sm">Ticked to start. A store can have its own choice on its Details.</p><div class="lrks">' +
      chk('print', 'Print', '', 'after') + chk('email', 'Email the invoice', 'PDF to the store’s invoice email', 'after') + chk('edi', 'Email the EDI file', 'To the store’s EDI email, for its back office', 'after') + '</div>' +
      '<label class="fld narrow"><span>Copies to print</span><select data-isv="copies" data-guide="settings-invoices-copies"' + dis + '>' + [1, 2, 3, 4, 5].map((n) => '<option value="' + n + '"' + (n === S.copies ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' +
      '<h2 class="mt">How emails go out</h2><p class="sm">From <b>invoices@storeowl.app</b> with your company name. When a store replies, it goes to ' + esc(co().email || 'your company email (Settings → Company)') + '.</p>' +
      (ro ? '<p class="sm">Only owners and managers can change these.</p>' : '') + '</div></div>' +
      (ro ? '' : '<div class="savebar wide' + (setDirty() ? '' : ' hide') + '" id="is-bar"><span id="is-err">Not saved yet</span><div class="rowr"><button class="btn" id="is-undo" data-guide="settings-invoices-undo">Undo</button>' +
        '<button class="btn amber" id="is-save" data-guide="settings-invoices-save">Save</button></div></div>');
  }
  function bindSettings() {
    const S = A.invs, bar = q('#is-bar');
    const upd = () => { if (bar) bar.classList.toggle('hide', !setDirty()); };
    $$('[data-isk]').forEach((el) => { el.onchange = () => { const [a, b] = el.dataset.isk.split('.'); if (b) S[a][b] = el.checked; else S[a] = el.checked; upd(); }; });
    $$('[data-isv]').forEach((el) => { const k = el.dataset.isv; const set = () => { S[k] = k === 'copies' ? +el.value : el.value; upd(); }; if (el.tagName === 'SELECT') el.onchange = set; else el.oninput = set; });
    const u = q('#is-undo'); if (u) u.onclick = () => { A.invs = null; X.render(); };
    const sv = q('#is-save'); if (sv) sv.onclick = async () => {
      const p = {}; Object.keys(INV_DEFAULT).forEach((k) => { p[k] = S[k]; });
      try { X.replaceCo(await db.settingsSet(A.cid, { inv: p })); A.invs = null; A.hist = null; X.say('✓ Invoice settings saved'); } catch (e) { const er = q('#is-err'); if (er) er.textContent = e.message; return; }
      X.render();
    };
  }

  return { load, print, doneHtml, bindDone, panelHtml, bindPanel, settingsHtml, bindSettings, shortDate };
}
