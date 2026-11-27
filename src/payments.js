// Phase 3: the Payments page (payments list, post-dated checks, Take to the bank, Deposits) and the "Take a payment"
// window, which opens from the Payments page, a customer's page or the Counter. Rules live in the database
// (payment_save / _open_items); src/rules.js has the same rules for the pretend database and the screen's numbers.
import { dollars, money, shortDate, todayIso, PAY_METHODS, payMethod, fillOldest } from './rules.js';

export function makePayments(X) {
  const { A, db, root, esc } = X;
  const q = (s) => root.querySelector(s);
  const $$ = (s) => Array.from(root.querySelectorAll(s));
  const $ = (v) => (v == null ? '—' : dollars(v));
  const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, '')); return isFinite(n) ? r2(n) : 0; };
  const today = () => A.today || todayIso();
  const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const ago = (n) => { const d = new Date(today() + 'T12:00:00'); d.setDate(d.getDate() - n); return ymd(d); };
  const howText = (p) => payMethod(p.method) + (p.method === 'check' && p.check_no ? ' #' + p.check_no : '');

  // ===================== Take a payment (a window over any page) =====================
  // open({cust?: {id, name}, from: 'payments'|'customer'|'counter', sale?: {id, number, total}, onDone?})
  function open(o) {
    A.pay = { cust: o.cust || null, cq: '', hits: [], amount: o.sale ? money(o.sale.total).replace(/,/g, '') : '', method: 'cash', check_no: '', check_date: '', received: today(), note: '',
      oi: null, pay: {}, use: {}, edited: false, busy: false, err: '', from: o.from || 'payments', sale: o.sale || null, onDone: o.onDone || null };
    if (A.pay.cust) loadOpen();
    X.render();
    setTimeout(() => { const b = q(A.pay && A.pay.cust ? '#pm-amt' : '#pm-cq'); if (b) { b.focus(); if (b.select) b.select(); } }, 0);
  }
  const key = (x) => (x.id == null ? 'start' : x.id);
  function loadOpen() {
    const T = A.pay, cid = A.cid, id = T.cust.id;
    T.oi = null;
    db.customerOpen(cid, id).then((oi) => {
      if (!A.pay || A.pay.cust.id !== id) return;
      T.oi = oi;
      if (T.sale) { T.pay = {}; T.pay[T.sale.id] = String(T.amount); T.edited = true; }
      else autofill();
      X.render();
    }).catch((e) => { if (A.pay) { T.err = e.message; X.render(); } });
  }
  // Oldest first, from the money typed plus any credit ticked.
  function autofill() {
    const T = A.pay; if (!T.oi) return;
    const have = num(T.amount) + Object.values(T.use).reduce((a, v) => a + num(v), 0);
    const f = fillOldest(T.oi.invoices, have);
    T.pay = {}; T.oi.invoices.forEach((x, i) => { if (f[i] > 0) T.pay[key(x)] = money(f[i]).replace(/,/g, ''); });
  }
  function sums() {
    const T = A.pay, paying = r2(Object.values(T.pay).reduce((a, v) => a + num(v), 0)), credit = r2(Object.values(T.use).reduce((a, v) => a + num(v), 0));
    const money_ = num(T.amount), left = r2(money_ + credit - paying);
    return { paying, credit, money: money_, left };
  }
  function sumLine() {
    const T = A.pay, s = sums();
    if (!T.cust) return '';
    const held = T.method === 'check' && T.check_date && T.check_date > today();
    let tail;
    if (s.left < -0.004) tail = '<b class="bad">' + $(-s.left) + ' more than you have to pay with</b>';
    else if (s.left > 0.004) tail = '<b class="ok2">' + $(s.left) + ' left over · kept as store credit</b>';
    else tail = '<b class="ok2">✓ All of it pays invoices</b>';
    return 'Paying ' + $(s.paying) + ' on invoices' + (s.credit ? ' · ' + $(s.credit) + ' from store credit' : '') + ' · ' + tail +
      (held ? '<br><span class="miss">Post-dated check: it waits until ' + esc(shortDate(T.check_date, true)) + ', then goes in Take to the bank. It counts once it’s in a deposit.</span>' : '');
  }
  function modalHtml() {
    const T = A.pay; if (!T) return '';
    const custBox = T.cust
      ? '<div class="pmcust"><b>' + esc(T.cust.name) + '</b>' + (T.from === 'payments' ? '<button class="lnk" id="pm-chg" data-guide="payments-take-change-customer">Change</button>' : '') + '</div>'
      : '<label class="fld"><span>Customer</span><input class="inp" id="pm-cq" autocomplete="off" placeholder="Type the store’s name or store #" value="' + esc(T.cq) + '" data-guide="payments-take-customer"></label><div id="pm-hits" class="pmhits">' + hitsHtml() + '</div>';
    const meth = '<div class="seg pmseg">' + PAY_METHODS.map(([k, n]) => '<button class="' + (T.method === k ? 'on' : '') + '" data-pmm="' + k + '" data-guide="payments-take-method">' + n + '</button>').join('') + '</div>';
    const check = T.method === 'check' ? '<div class="pmrow"><label class="fld"><span>Check #</span><input class="inp" id="pm-cno" value="' + esc(T.check_no) + '" data-guide="payments-take-check-number"></label>' +
      '<label class="fld"><span>Date on the check</span><input type="date" class="inp" id="pm-cdate" value="' + esc(T.check_date) + '" data-guide="payments-take-check-date"><small class="sm">Leave it for today. A later date = post-dated.</small></label></div>' : '';
    const amt = '<div class="pmrow"><label class="fld pmamt"><span>Amount</span><input class="inp" id="pm-amt" inputmode="decimal" placeholder="0.00" value="' + esc(T.amount) + '" data-guide="payments-take-amount"></label>' +
      '<label class="fld"><span>Received</span><input type="date" class="inp" id="pm-rec" value="' + esc(T.received) + '" max="' + esc(today()) + '" data-guide="payments-take-received"></label></div>';
    let items = '';
    if (T.cust && !T.oi) items = '<p class="sm">Loading what they owe…</p>';
    if (T.cust && T.oi) {
      const O = T.oi;
      const rows = O.invoices.map((x) => '<tr><td>' + (x.opening ? '<b>Starting balance</b><small>From your old system</small>' : '<b>Invoice ' + x.number + '</b><small>' + esc(shortDate(x.date, true)) + '</small>') + '</td>' +
        '<td>' + (x.late ? '<span class="tag need">' + x.late + ' days past due</span>' : '<span class="tag ok">Due ' + esc(shortDate(x.due)) + '</span>') + '</td>' +
        '<td class="n">' + $(x.open) + '</td><td class="n"><input class="inp pmpay" inputmode="decimal" data-pmto="' + key(x) + '" value="' + esc(T.pay[key(x)] || '') + '" placeholder="0.00" data-guide="payments-take-pay-invoice"></td></tr>').join('');
      items = '<div class="pmhd"><b>Pays these</b>' + (O.invoices.length ? '<button class="lnk" id="pm-fill" data-guide="payments-take-fill-oldest">Fill oldest first</button>' : '') + '</div>' +
        (O.invoices.length ? '<table class="t tsm pmtab"><thead><tr><th>What</th><th></th><th class="n">Still owed</th><th class="n">Pay</th></tr></thead><tbody>' + rows + '</tbody></table>'
          : '<p class="sm">Nothing open. The whole amount is kept as store credit.</p>');
      if (O.credits.length) {
        items += '<div class="pmhd"><b>Use their store credit</b></div><table class="t tsm pmtab"><tbody>' + O.credits.map((c) => {
          const k = c.kind + ':' + (c.id || ''), nm = c.kind === 'credit' ? 'Credit memo ' + c.number : c.kind === 'payment' ? 'Left over from payment ' + c.number : 'Credit from your old system';
          return '<tr><td><b>' + esc(nm) + '</b><small>' + esc(shortDate(c.date, true)) + '</small></td><td class="n">' + $(c.left) + ' left</td><td class="n"><input class="inp pmpay" inputmode="decimal" data-pmuse="' + esc(k) + '" value="' + esc(T.use[k] || '') + '" placeholder="0.00" data-guide="payments-take-use-credit"></td></tr>';
        }).join('') + '</tbody></table>';
      }
    }
    const note = T.cust ? '<label class="fld"><span>Note (optional)</span><input class="inp" id="pm-note" value="' + esc(T.note) + '" data-guide="payments-take-note"></label>' : '';
    return '<div class="ctmodal pmmodal"><div class="card ctpan pmpan"><div class="hdr"><h2>Take a payment' + (T.sale ? ' · invoice ' + T.sale.number : '') + '</h2><button class="x" id="pm-x" aria-label="Close" data-guide="payments-take-close">×</button></div>' +
      custBox + (T.cust ? meth + check + amt + items + note + '<p class="pmsum" id="pm-sum">' + sumLine() + '</p>' : '') +
      '<p class="fmsg" id="pm-err">' + esc(T.err) + '</p><div class="rowr"><button class="btn" id="pm-cancel" data-guide="payments-take-cancel">' + (T.sale ? 'Charge to account instead' : 'Cancel') + '</button>' +
      (T.cust ? '<button class="btn amber" id="pm-save" data-guide="payments-take-save"' + (T.busy ? ' disabled' : '') + '>Save payment</button>' : '') + '</div></div></div>';
  }
  function hitsHtml() {
    const T = A.pay, t = T.cq.trim().toLowerCase();
    if (!t) return '';
    const L = (A.custs || []).filter((c) => c.active !== false && ((c.name || '').toLowerCase().includes(t) || String(c.store_no || '').toLowerCase().includes(t))).slice(0, 6);
    T.hits = L;
    return L.length ? L.map((c, i) => '<button class="pmhit" data-pmc="' + c.id + '" data-guide="payments-take-pick-customer"><b>' + esc(c.name) + '</b><small>' + esc([c.store_no ? 'Store #' + c.store_no : '', c.city].filter(Boolean).join(' · ')) + '</small></button>').join('')
      : '<p class="sm">No store matches</p>';
  }
  function updSum() { const s = q('#pm-sum'); if (s) s.innerHTML = sumLine(); }
  function bindModal() {
    const T = A.pay; if (!T) return;
    const close = () => { A.pay = null; X.render(); };
    const x = q('#pm-x'); if (x) x.onclick = () => (T.from === 'counter' && T.onDone ? T.onDone(null) : close());
    const cn = q('#pm-cancel'); if (cn) cn.onclick = () => (T.from === 'counter' && T.onDone ? T.onDone(null) : close());
    const cq = q('#pm-cq');
    if (cq) {
      cq.oninput = () => { T.cq = cq.value; q('#pm-hits').innerHTML = hitsHtml(); bindHits(); };
      cq.onkeydown = (e) => { if (e.key === 'Enter' && T.hits[0]) { e.preventDefault(); pick(T.hits[0]); } };
      bindHits();
    }
    function bindHits() { $$('[data-pmc]').forEach((b) => { b.onclick = () => pick((A.custs || []).find((c) => c.id === b.dataset.pmc)); }); }
    function pick(c) { if (!c) return; T.cust = { id: c.id, name: c.name }; T.err = ''; loadOpen(); X.render(); setTimeout(() => { const a = q('#pm-amt'); if (a) a.focus(); }, 0); }
    const ch = q('#pm-chg'); if (ch) ch.onclick = () => { T.cust = null; T.oi = null; T.pay = {}; T.use = {}; X.render(); };
    $$('[data-pmm]').forEach((b) => { b.onclick = () => { T.method = b.dataset.pmm; X.render(); }; });
    const amt = q('#pm-amt');
    if (amt) {
      amt.oninput = () => {
        T.amount = amt.value;
        if (!T.edited && T.oi) { autofill(); $$('[data-pmto]').forEach((b) => { b.value = T.pay[b.dataset.pmto] || ''; }); }
        updSum();
      };
      amt.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); const s = q('#pm-save'); if (s) s.click(); } };
    }
    const fld = (id, k, ev) => { const b = q(id); if (b) b[ev || 'oninput'] = () => { T[k] = b.value; updSum(); }; };
    fld('#pm-cno', 'check_no'); fld('#pm-note', 'note');
    const cd = q('#pm-cdate'); if (cd) cd.onchange = () => { T.check_date = cd.value; updSum(); };
    const rc = q('#pm-rec'); if (rc) rc.onchange = () => { T.received = rc.value; };
    $$('[data-pmto]').forEach((b) => { b.oninput = () => { T.pay[b.dataset.pmto] = b.value; T.edited = true; updSum(); }; });
    $$('[data-pmuse]').forEach((b) => { b.oninput = () => { T.use[b.dataset.pmuse] = b.value; if (!T.edited) { autofill(); $$('[data-pmto]').forEach((y) => { y.value = T.pay[y.dataset.pmto] || ''; }); } updSum(); }; });
    const fl = q('#pm-fill'); if (fl) fl.onclick = () => { T.edited = false; autofill(); $$('[data-pmto]').forEach((y) => { y.value = T.pay[y.dataset.pmto] || ''; }); updSum(); };
    const sv = q('#pm-save');
    if (sv) sv.onclick = async () => {
      const s = sums(), e = q('#pm-err');
      if (s.money <= 0 && s.credit <= 0) { e.textContent = 'Type how much they paid.'; return; }
      if (s.left < -0.004) { e.textContent = 'You’re paying ' + $(s.paying) + ' but have ' + $(s.money + s.credit) + ' to pay with.'; return; }
      if (T.method === 'check' && !T.check_no.trim()) { e.textContent = 'Type the check number.'; return; }
      const p = { customer_id: T.cust.id, method: T.method, amount: s.money, check_no: T.check_no, check_date: T.method === 'check' ? T.check_date : '', received: T.received, note: T.note,
        sale_id: T.sale ? T.sale.id : null,
        pay: Object.entries(T.pay).filter(([, v]) => num(v) > 0).map(([k, v]) => ({ to: k === 'start' ? null : k, amount: num(v) })),
        use: Object.entries(T.use).filter(([, v]) => num(v) > 0).map(([k, v]) => ({ kind: k.split(':')[0], id: k.split(':')[1] || null, amount: num(v) })) };
      T.busy = true; sv.disabled = true;
      try {
        const r = await db.paymentSave(A.cid, p);
        const done = T.onDone; A.pay = null; if (A.pm) reset();
        if (A.cu) { A.cu.acc = null; A.cu.oi = null; }
        X.reloadCust && X.reloadCust(T.cust.id);
        X.say('✓ Payment ' + r.number + ' saved · ' + $(r.amount) + ' from ' + r.customer.name + (r.status === 'held' ? ' · post-dated, waiting' : ''));
        if (done) done(r); else X.render();
      } catch (er) { T.busy = false; sv.disabled = false; e.textContent = er.message; }
    };
  }

  // ===================== Payments page =====================
  const PRES = [['today', 'Today'], ['week', 'Last 7 days'], ['month', 'This month'], ['last', 'Last month'], ['custom', 'Custom']];
  function range(P) {
    const t = today(), d = new Date(t + 'T12:00:00');
    if (P.pre === 'today') return [t, t];
    if (P.pre === 'week') return [ago(6), t];
    if (P.pre === 'month') return [t.slice(0, 8) + '01', t];
    if (P.pre === 'last') return [ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ymd(new Date(d.getFullYear(), d.getMonth(), 0))];
    return [P.from || t, P.to || t];
  }
  function st() { if (!A.pm) A.pm = { tab: 'list', pre: 'month', from: '', to: '', q: '', sel: null, data: null, key: '', err: '', vo: null,
    bank: null, bkErr: '', off: {}, made_on: '', busy: false, dpre: 'month', dfrom: '', dto: '', deps: null, dkey: '', dErr: '', dsel: null, undo: false, rb: null }; return A.pm; }
  // Forget what's loaded so every tab asks again (after a payment, a deposit or a change).
  function reset() { A.bankWait = null; const P = st(); P.data = null; P.key = ''; P.bank = null; P.deps = null; P.dkey = ''; }
  function load() {
    const P = st(), [f, t] = range(P), k = A.cid + '|' + f + '|' + t, cid = A.cid;
    if (!(P.key === k && (P.data || P.err))) {
      P.key = k; P.data = null; P.err = '';
      db.payments(cid, f, t).then((d) => { if (A.cid !== cid || P.key !== k) return; P.data = d; if (A.view === 'payments') X.render(); })
        .catch((e) => { if (P.key !== k) return; P.err = e.message; if (A.view === 'payments') X.render(); });
    }
    if (!P.bank && !P.bkLoading) {
      P.bkLoading = true; P.bkErr = '';
      db.bankTodo(cid).then((l) => { P.bkLoading = false; if (A.cid !== cid) return; P.bank = l; if (A.view === 'payments') X.render(); })
        .catch((e) => { P.bkLoading = false; P.bkErr = e.message; P.bank = []; if (A.view === 'payments') X.render(); });
    }
    if (P.tab === 'deps') {
      const [df, dt] = range({ pre: P.dpre, from: P.dfrom, to: P.dto }), dk = cid + '|' + df + '|' + dt;
      if (!(P.dkey === dk && (P.deps || P.dErr))) {
        P.dkey = dk; P.deps = null; P.dErr = '';
        db.deposits(cid, df, dt).then((d) => { if (P.dkey !== dk) return; P.deps = d; if (A.view === 'payments') X.render(); })
          .catch((e) => { if (P.dkey !== dk) return; P.dErr = e.message; if (A.view === 'payments') X.render(); });
      }
    }
  }
  function tag(p) {
    if (p.status === 'void') return '<span class="tag bad">Void</span>';
    if (p.status === 'held') return '<span class="tag need">Post-dated · ' + esc(shortDate(p.check_date)) + '</span>';
    return '';
  }
  const paidText = (p) => {
    const n = Array.from(new Set(p.applied.map((a) => (a.number ? '#' + a.number : 'Starting balance'))));
    const left = r2(Number(p.amount) - p.applied.filter((a) => !a.from_sale).reduce((a, x) => a + Number(x.amount), 0));
    const pre = p.status === 'held' ? 'Once deposited, pays ' : 'Pays ';
    if (!n.length) return p.status === 'void' ? 'Paid nothing' : 'Kept as store credit';
    return pre + n.join(', ') + (left > 0.004 && p.status !== 'void' ? ' · ' + $(left) + ' store credit' : '');
  };
  function html() {
    const P = st(); load();
    const held = P.data ? P.data.held : [];
    const dueNow = held.filter((p) => p.check_date <= today()).length;
    const nb = (P.bank || []).length;
    const tabs = '<nav class="ctabs">' + [['list', 'Payments'], ['held', 'Post-dated checks' + (held.length ? '<em' + (dueNow ? '' : ' class="g"') + '>' + held.length + '</em>' : '')],
      ['bank', 'Take to the bank' + (nb ? '<em>' + nb + '</em>' : '')], ['deps', 'Deposits']]
      .map(([k, n]) => '<button class="' + (P.tab === k ? 'on' : '') + '" data-pmtab="' + k + '" data-guide="payments-page-tab">' + n + '</button>').join('') + '</nav>';
    const head = '<div class="hdr"><h1>Payments</h1><button class="btn amber" id="pm-new" data-guide="payments-page-take">+ Take a payment</button></div>';
    if (P.err) return head + tabs + '<div class="card"><p class="sm bad">' + esc(P.err) + '</p></div>';
    if (!P.data) return head + tabs + '<div class="card"><p class="sm">Loading…</p></div>';
    let body = '';
    if (P.tab === 'list') body = listHtml(P);
    if (P.tab === 'held') body = heldHtml(held);
    if (P.tab === 'bank') body = bankHtml(P);
    if (P.tab === 'deps') body = depsHtml(P);
    return head + tabs + body;
  }
  function listHtml(P) {
    const [f, t] = range(P), rows = P.data.rows.filter((p) => p.received >= f && p.received <= t);
    const live = rows.filter((p) => p.status === 'posted'), by = (m) => r2(live.filter((p) => p.method === m).reduce((a, p) => a + Number(p.amount), 0));
    const top = '<div class="acbar"><div class="seg">' + PRES.map(([k, n]) => '<button class="' + (P.pre === k ? 'on' : '') + '" data-pmpre="' + k + '" data-guide="payments-list-dates">' + n + '</button>').join('') + '</div>' +
      (P.pre === 'custom' ? '<span class="acdt"><input type="date" class="inp" id="pm-from" value="' + esc(f) + '" data-guide="payments-list-from"><span>to</span><input type="date" class="inp" id="pm-to" value="' + esc(t) + '" data-guide="payments-list-to"></span>'
        : '<span class="acwhen">' + esc(f === t ? shortDate(f, true) : shortDate(f, true) + ' – ' + shortDate(t, true)) + '</span>') +
      '<input class="inp acq pmq" id="pm-q" type="search" placeholder="Store or payment #" value="' + esc(P.q) + '" data-guide="payments-list-search"></div>';
    const boxes = '<div class="kpis ackpis"><div class="kb nv"><span>Received</span><b>' + $(live.reduce((a, p) => a + Number(p.amount), 0)) + '</b><small>' + live.length + ' ' + (live.length === 1 ? 'payment' : 'payments') + '</small></div>' +
      '<div class="kb"><span>Cash</span><b>' + $(by('cash')) + '</b></div><div class="kb"><span>Checks</span><b>' + $(by('check')) + '</b></div>' +
      '<div class="kb"><span>Card · bank transfer</span><b>' + $(r2(by('card') + by('ach'))) + '</b></div>' +
      '<div class="kb"><span>Post-dated waiting</span><b>' + $(r2(P.data.held.reduce((a, p) => a + Number(p.amount), 0))) + '</b><small>' + P.data.held.length + ' ' + (P.data.held.length === 1 ? 'check' : 'checks') + '</small></div></div>';
    const tr = rows.map((p) => '<tr class="pmr' + (p.status === 'void' ? ' acvoid' : '') + (P.sel === p.id ? ' sel' : '') + '" data-pmopen="' + p.id + '" data-s="' + esc((p.customer.name + ' ' + (p.customer.store_no || '') + ' ' + p.number).toLowerCase()) + '">' +
      '<td>' + esc(shortDate(p.received, true)) + '</td><td class="acnum">' + p.number + '</td><td><b>' + esc(p.customer.name) + '</b><small>' + esc(p.customer.store_no ? 'Store #' + p.customer.store_no : '') + '</small></td>' +
      '<td>' + esc(howText(p)) + ' ' + tag(p) + '</td><td class="acsub">' + esc(paidText(p)) + '</td><td class="n"><b>' + $(p.amount) + '</b></td><td class="acsub">' + esc(p.by_name) + '</td></tr>').join('');
    const table = '<div class="cc"><table class="t tsm actab"><thead><tr><th>Received</th><th>#</th><th>Store</th><th>How</th><th>What it paid</th><th class="n">Amount</th><th>By</th></tr></thead><tbody id="pm-rows">' +
      (rows.length ? tr : '<tr><td colspan="7" class="empty">No payments in these dates</td></tr>') + '</tbody></table><p class="fmsg" id="pm-none" hidden>No payment matches</p></div>';
    const sel = P.sel && P.data.rows.concat(P.data.held).find((p) => p.id === P.sel);
    return top + boxes + (sel ? '<div class="wrap2">' + table + panelHtml(sel) + '</div>' : table);
  }
  function panelHtml(p) {
    const V = P2().vo && P2().vo.id === p.id ? P2().vo : null;
    const lines = p.applied.map((a) => '<tr><td>' + (a.to ? 'Invoice ' + esc(a.number) : 'Starting balance') + (a.from_sale ? '<small>From credit memo</small>' : '') + '</td><td class="n">' + $(a.amount) + '</td></tr>').join('');
    const left = r2(Number(p.amount) - p.applied.filter((a) => !a.from_sale).reduce((s, a) => s + Number(a.amount), 0));
    const voidBox = p.status === 'void' ? '<div class="ivvoidbar"><b>Void</b> · ' + esc(p.void_by) + ' · ' + esc(X.when(p.void_at)) + '<br>' + esc(p.void_why) + '<span class="sm">Kept for your records. What it paid is owed again.</span></div>' : '';
    const inDep = p.deposit && p.deposit.status !== 'undone', back = !!(V && V.back);
    let voidAsk = '';
    if (p.status !== 'void' && X.isMgr()) {
      if (V) voidAsk = '<div class="card ivvoidask"><b>' + (back ? 'Check #' + esc(p.check_no) + ' came back?' : 'Void payment ' + p.number + '?') + '</b><p class="sm">' +
          (back ? 'What it paid is owed again, and deposit #' + p.deposit.number + ' shows ' + $(p.amount) + ' less.' : 'What it paid is owed again. Use this for a mistake.') + '</p>' +
          '<label class="fld"><span>Why?</span><input id="pm-vwhy" value="' + esc(V.why) + '" placeholder="' + (back ? 'e.g. not enough money' : 'e.g. typed the wrong store') + '" data-guide="payments-payment-void-why"></label><p class="fmsg" id="pm-verr"></p>' +
          '<div class="rowr"><button class="btn" id="pm-vno" data-guide="payments-payment-void-cancel">Keep it</button><button class="btn red" id="pm-vyes" data-guide="payments-payment-void-confirm">' + (back ? 'It came back' : 'Void it') + '</button></div></div>';
      else if (inDep && p.method === 'check') voidAsk = '<button class="btn sm pmback" id="pm-back" data-guide="payments-payment-check-came-back">Check came back…</button>';
      else if (inDep) voidAsk = '<p class="sm mut">It’s in deposit #' + p.deposit.number + '. To void it, undo that deposit first.</p>';
      else voidAsk = '<button class="lnk bad ivvoidlnk" id="pm-void" data-guide="payments-payment-void">Void this payment…</button>';
    }
    const dtag = (d) => d.status === 'confirmed' ? '<span class="tag ok">✓ Confirmed by the bank</span>' : '<span class="tag grey">Waiting for the bank</span>';
    let bankLine = '';
    if (p.method === 'card' || p.method === 'ach' || p.method === 'other') bankLine = 'Reaches the bank by itself (' + esc(payMethod(p.method).toLowerCase()) + ')';
    else if (p.bounced && p.deposit) bankLine = '<span class="bad">Came back</span> · was in deposit #' + p.deposit.number + ' · ' + esc(shortDate(p.deposit.made_on, true));
    else if (inDep) bankLine = '<button class="lnk" data-pmdepopen="' + p.deposit.id + '" data-pmdepdate="' + esc(p.deposit.made_on) + '" data-guide="payments-payment-open-deposit">Deposit #' + p.deposit.number + '</button> · ' +
      esc(shortDate(p.deposit.made_on, true)) + ' · made by ' + esc(p.deposit.by) + ' ' + dtag(p.deposit);
    else if (p.status === 'held') bankLine = 'Waits until ' + esc(shortDate(p.check_date, true)) + ', then goes in Take to the bank';
    else if (p.status === 'posted') bankLine = '<span class="miss">Not deposited yet</span>';
    return '<aside class="card panel ivpan"><div class="hdr"><h2>Payment ' + p.number + '</h2><button class="x" id="pm-px" aria-label="Close" data-guide="payments-payment-close">×</button></div>' +
      '<p class="sm">' + esc(p.customer.name) + ' · ' + esc(shortDate(p.received, true)) + ' · ' + esc(howText(p)) + (p.check_date ? ' · dated ' + esc(shortDate(p.check_date, true)) : '') + ' · by ' + esc(p.by_name) + '</p>' + voidBox +
      '<table class="t"><tbody>' + (lines || '<tr><td class="empty">Paid no invoice</td><td></td></tr>') +
      (left > 0.004 ? '<tr><td>Left over · store credit</td><td class="n">' + $(left) + '</td></tr>' : '') +
      '<tr><td><b>Amount</b></td><td class="n"><b>' + $(p.amount) + '</b></td></tr></tbody></table>' +
      (bankLine ? '<p class="sm pmbank"><b>Bank</b> · ' + bankLine + '</p>' : '') +
      (p.note ? '<p class="sm">Note: ' + esc(p.note) + '</p>' : '') + voidAsk + '</aside>';
  }
  const P2 = () => st();
  function heldHtml(held) {
    if (!held.length) return '<div class="card"><p class="emptyc">No post-dated checks waiting</p></div>';
    return '<div class="cc"><table class="t tsm actab"><thead><tr><th>Date on the check</th><th>Check #</th><th>Store</th><th>What it pays</th><th class="n">Amount</th><th></th></tr></thead><tbody>' +
      held.map((p) => { const due = p.check_date <= today();
        return '<tr><td>' + esc(shortDate(p.check_date, true)) + (due ? ' <span class="tag need">Ready to deposit</span>' : '') + '</td><td class="acnum">' + esc(p.check_no) + '</td><td><b>' + esc(p.customer.name) + '</b></td>' +
          '<td class="acsub">' + esc(paidText(p)) + '</td><td class="n"><b>' + $(p.amount) + '</b></td><td class="n">' +
          (due ? '<button class="lnk" data-pmtab="bank" data-guide="payments-held-to-bank">In Take to the bank ›</button>' : '<span class="mut sm">Waits</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  // ----- Take to the bank: every cash and check payment not in a deposit yet -----
  const daysAgo = (d) => Math.round((new Date(today() + 'T12:00:00') - new Date(d + 'T12:00:00')) / 864e5);
  const waitTag = (p) => { const d = daysAgo(p.status === 'held' || p.deposited_at ? (p.check_date || p.received) : p.received);
    return d >= 2 ? '<span class="tag need">' + d + ' days</span>' : '<span class="mut sm">' + (d === 1 ? '1 day' : 'Today') + (p.status === 'held' ? ' · was post-dated' : '') + '</span>'; };
  const ticked = (P) => (P.bank || []).filter((p) => !P.off[p.id]);
  const sumOf = (l, m) => r2(l.filter((p) => !m || p.method === m).reduce((a, p) => a + Number(p.amount), 0));
  function bankHtml(P) {
    if (P.bkErr) return '<div class="card"><p class="sm bad">' + esc(P.bkErr) + '</p></div>';
    if (!P.bank) return '<div class="card"><p class="sm">Loading…</p></div>';
    const L = P.bank;
    if (!L.length) return '<div class="card"><p class="emptyc">✓ Nothing waiting. Every cash and check payment is in a deposit.</p></div>';
    const old = L.reduce((m, p) => Math.max(m, daysAgo(p.received)), 0), nCash = L.filter((p) => p.method === 'cash').length, nChk = L.length - nCash;
    const boxes = '<div class="kpis ackpis"><div class="kb nv"><span>Not deposited yet</span><b>' + $(sumOf(L)) + '</b><small>' + L.length + ' ' + (L.length === 1 ? 'payment' : 'payments') + (old ? ' · oldest ' + old + (old === 1 ? ' day' : ' days') : '') + '</small></div>' +
      '<div class="kb"><span>Cash</span><b>' + $(sumOf(L, 'cash')) + '</b><small>' + nCash + ' ' + (nCash === 1 ? 'payment' : 'payments') + '</small></div>' +
      '<div class="kb"><span>Checks</span><b>' + $(sumOf(L, 'check')) + '</b><small>' + nChk + ' ' + (nChk === 1 ? 'check' : 'checks') + '</small></div>' +
      '<div class="kb"><span>Ticked for this deposit</span><b id="bk-tsum">' + $(sumOf(ticked(P))) + '</b><small id="bk-tn">' + ticked(P).length + ' of ' + L.length + '</small></div></div>';
    const all = !L.some((p) => P.off[p.id]);
    const rows = L.map((p) => '<tr class="' + (daysAgo(p.received) >= 2 ? 'bklate' : '') + '"><td class="ck"><input type="checkbox" class="bkck" data-bkp="' + p.id + '"' + (P.off[p.id] ? '' : ' checked') + ' data-guide="payments-bank-tick"></td>' +
      '<td>' + esc(shortDate(p.received, true)) + '</td><td><b>' + esc(p.customer.name) + '</b>' + (p.customer.store_no ? ' <small class="mut">· #' + esc(p.customer.store_no) + '</small>' : '') + '</td>' +
      '<td>' + esc(payMethod(p.method)) + '</td><td class="acnum">' + esc(p.check_no || '') + '</td><td class="n"><b>' + $(p.amount) + '</b></td><td>' + waitTag(p) + '</td></tr>').join('');
    const table = '<div class="cc"><table class="t tsm actab bktab"><thead><tr><th class="ck"><input type="checkbox" id="bk-all"' + (all ? ' checked' : '') + ' data-guide="payments-bank-tick-all"></th>' +
      '<th>Received</th><th>Store</th><th>How</th><th>Check #</th><th class="n">Amount</th><th>Waiting</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    const T = ticked(P);
    const bar = '<div class="ctbar bkbar"><span id="bk-line"><b>' + T.length + ' ticked</b> · Cash ' + $(sumOf(T, 'cash')) + ' · Checks ' + $(sumOf(T, 'check')) + '</span><span class="sp"></span>' +
      '<label class="fld bkdate"><span>Deposit date</span><input type="date" class="inp" id="bk-date" value="' + esc(P.made_on || today()) + '" max="' + esc(today()) + '" data-guide="payments-bank-date"></label>' +
      '<button class="btn" id="bk-print" data-guide="payments-bank-print">Print the list</button>' +
      '<button class="btn amber" id="bk-make" data-guide="payments-bank-make"' + (T.length && !P.busy ? '' : ' disabled') + '>Make deposit · ' + $(sumOf(T)) + '</button></div><p class="fmsg" id="bk-err"></p>';
    return boxes + table + bar;
  }
  // Update the totals in place when a tick changes (nothing redraws).
  function bankUpd() {
    const P = st(), T = ticked(P), L = P.bank || [];
    const set = (id, h) => { const e = q(id); if (e) e.innerHTML = h; };
    set('#bk-tsum', $(sumOf(T))); set('#bk-tn', T.length + ' of ' + L.length);
    set('#bk-line', '<b>' + T.length + ' ticked</b> · Cash ' + $(sumOf(T, 'cash')) + ' · Checks ' + $(sumOf(T, 'check')));
    const mk = q('#bk-make'); if (mk) { mk.textContent = 'Make deposit · ' + $(sumOf(T)); mk.disabled = !T.length; }
    const al = q('#bk-all'); if (al) al.checked = !L.some((p) => P.off[p.id]);
  }

  // ----- Deposits -----
  const depTag = (d, short) => d.status === 'undone' ? '<span class="tag grey">Undone</span>' : Number(d.came_back) > 0 ? '<span class="tag bad">A check came back</span>'
    : d.status === 'confirmed' ? '<span class="tag ok">✓ ' + (short ? 'Confirmed' : 'Confirmed by the bank') + '</span>' : '<span class="tag grey">' + (short ? 'Waiting for the bank' : 'Made · waiting for the bank') + '</span>';
  function depsHtml(P) {
    const R = { pre: P.dpre, from: P.dfrom, to: P.dto }, [f, t] = range(R);
    const top = '<div class="acbar"><div class="seg">' + PRES.map(([k, n]) => '<button class="' + (P.dpre === k ? 'on' : '') + '" data-dppre="' + k + '" data-guide="payments-deposits-dates">' + n + '</button>').join('') + '</div>' +
      (P.dpre === 'custom' ? '<span class="acdt"><input type="date" class="inp" id="dp-from" value="' + esc(f) + '" data-guide="payments-deposits-from"><span>to</span><input type="date" class="inp" id="dp-to" value="' + esc(t) + '" data-guide="payments-deposits-to"></span>'
        : '<span class="acwhen">' + esc(f === t ? shortDate(f, true) : shortDate(f, true) + ' – ' + shortDate(t, true)) + '</span>') + '</div>';
    if (P.dErr) return top + '<div class="card"><p class="sm bad">' + esc(P.dErr) + '</p></div>';
    if (!P.deps) return top + '<div class="card"><p class="sm">Loading…</p></div>';
    const rows = P.deps.rows, live = rows.filter((d) => d.status !== 'undone'), wait = P.deps.waiting, back = live.filter((d) => Number(d.came_back) > 0);
    const boxes = '<div class="kpis ackpis"><div class="kb nv"><span>Deposited</span><b>' + $(r2(live.reduce((a, d) => a + Number(d.total), 0))) + '</b><small>' + live.length + ' ' + (live.length === 1 ? 'deposit' : 'deposits') + '</small></div>' +
      '<div class="kb"><span>Waiting for the bank</span><b>' + $(r2(wait.reduce((a, d) => a + Number(d.total), 0))) + '</b><small>' + (wait.length ? wait.length + ' not confirmed' : 'All confirmed') + '</small></div>' +
      '<div class="kb"><span>Checks came back</span><b' + (back.length ? ' class="bad"' : '') + '>' + $(r2(back.reduce((a, d) => a + Number(d.came_back), 0))) + '</b><small>' + (back.length ? 'In ' + back.map((d) => '#' + d.number).join(', ') : 'None') + '</small></div></div>';
    const tr = rows.map((d) => '<tr class="pmr' + (d.status === 'undone' ? ' acvoid' : '') + (P.dsel === d.id ? ' sel' : '') + '" data-dpopen="' + d.id + '"><td class="acnum"><b>#' + d.number + '</b></td><td>' + esc(shortDate(d.made_on)) + '</td><td class="acsub">' + esc(d.by_name) + '</td>' +
      '<td class="n">' + $(d.cash) + '</td><td class="n">' + $(d.checks) + '</td><td class="n"><b>' + $(d.total) + '</b></td><td class="nw">' + depTag(d, !!P.dsel) + '</td></tr>').join('');
    const table = '<div class="cc"><table class="t tsm actab"><thead><tr><th>Deposit</th><th>Date</th><th>By</th><th class="n">Cash</th><th class="n">Checks</th><th class="n">Total</th><th>Status</th></tr></thead><tbody>' +
      (rows.length ? tr : '<tr><td colspan="7" class="empty">No deposits in these dates</td></tr>') + '</tbody></table></div>';
    const sel = P.dsel && (rows.concat(wait)).find((d) => d.id === P.dsel);
    return top + boxes + (sel ? '<div class="wrap2">' + table + depPanel(sel, P) + '</div>' : table);
  }
  function depPanel(d, P) {
    const chk = d.payments.filter((p) => p.method === 'check'), cash = d.payments.filter((p) => p.method === 'cash'), mgr = X.isMgr();
    const line = (p, t) => '<tr' + (p.bounced ? ' class="acvoid"' : '') + '><td>' + t + (p.bounced ? ' <span class="tag bad">Came back</span>' : '') + '</td><td class="n">' + $(p.amount) + '</td></tr>';
    const ur = d.status === 'undone' ? '<p class="sm">Undone by ' + esc(d.undone_by) + ' · ' + esc(X.when(d.undone_at)) + '. Its payments went back to Take to the bank.</p>' : '';
    const conf = d.status === 'confirmed' ? '<p class="sm ok2">✓ Confirmed by ' + esc(d.confirmed_by) + ' · ' + esc(X.when(d.confirmed_at)) + '</p>' : '';
    let btns = '<button class="btn" id="dp-print" data-guide="payments-deposit-print-slip">Print slip</button>';
    if (d.status === 'made' && mgr) btns = (P.undo ? '<button class="btn red" id="dp-undo2" data-guide="payments-deposit-undo-confirm">Tap again to undo</button>' : '<button class="btn" id="dp-undo" data-guide="payments-deposit-undo">Undo deposit</button>') +
      btns + '<button class="btn amber" id="dp-conf" data-guide="payments-deposit-confirm">It’s on the statement ✓</button>';
    if (d.status === 'confirmed' && mgr) btns += '<button class="lnk" id="dp-unconf" data-guide="payments-deposit-unconfirm">Not confirmed after all</button>';
    return '<aside class="card panel ivpan dppan"><div class="hdr"><h2>Deposit #' + d.number + '</h2><button class="x" id="dp-x" aria-label="Close" data-guide="payments-deposit-close">×</button></div>' +
      '<p class="sm">' + esc(shortDate(d.made_on, true)) + ' · made by ' + esc(d.by_name) + ' · ' + d.payments.length + ' ' + (d.payments.length === 1 ? 'payment' : 'payments') + ' ' + depTag(d) + '</p>' + ur + conf +
      (d.status === 'undone' ? '' : '<h3 class="dph">Checks · ' + chk.length + '</h3><table class="t tsm"><tbody>' + (chk.map((p) => line(p, '#' + esc(p.check_no) + ' ' + esc(p.customer.name))).join('') || '<tr><td class="empty">No checks</td><td></td></tr>') + '</tbody></table>' +
        '<h3 class="dph">Cash · ' + cash.length + (cash.length === 1 ? ' store' : ' stores') + '</h3><table class="t tsm"><tbody>' + cash.map((p) => line(p, esc(p.customer.name))).join('') +
        '<tr><td><b>Deposit total</b></td><td class="n"><b>' + $(d.total) + '</b></td></tr>' + (Number(d.came_back) > 0 ? '<tr><td class="bad">Less checks that came back</td><td class="n bad">−' + $(d.came_back) + '</td></tr>' : '') + '</tbody></table>' +
        '<label class="fld"><span>Bank receipt # (optional)</span><input class="inp" id="dp-ref" value="' + esc(d.bank_ref || '') + '" placeholder="Type it from the bank’s receipt" data-guide="payments-deposit-bank-receipt"></label>') +
      '<p class="fmsg" id="dp-err"></p><div class="rowr">' + btns + '</div></aside>';
  }
  function printSlip(d) {
    let box = document.getElementById('printout');
    if (!box) { box = document.createElement('div'); box.id = 'printout'; document.body.appendChild(box); }
    const co = X.co() || {}, chk = d ? d.payments.filter((p) => p.method === 'check') : ticked(st()).filter((p) => p.method === 'check');
    const cash = d ? Number(d.cash) : sumOf(ticked(st()), 'cash'), total = d ? Number(d.total) : sumOf(ticked(st()));
    box.innerHTML = '<style>@media screen{#printout{display:none}}@media print{body>*:not(#printout){display:none!important}#printout{display:block;font:12px Arial}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ccc;padding:4px;text-align:left}.n{text-align:right}}</style>' +
      '<h2>' + esc(co.name || '') + ' · ' + (d ? 'Deposit #' + d.number + ' · ' + esc(shortDate(d.made_on, true)) : 'Cash and checks to deposit · ' + esc(shortDate(today(), true))) + '</h2>' +
      '<table><tr><th>Check #</th><th>Store</th><th class="n">Amount</th></tr>' +
      chk.map((p) => '<tr><td>' + esc(p.check_no) + '</td><td>' + esc(p.customer.name) + '</td><td class="n">' + $(p.amount) + '</td></tr>').join('') +
      '<tr><td colspan="2"><b>Checks · ' + chk.length + '</b></td><td class="n">' + $(r2(chk.reduce((a, p) => a + Number(p.amount), 0))) + '</td></tr><tr><td colspan="2"><b>Cash</b></td><td class="n">' + $(cash) + '</td></tr>' +
      '<tr><td colspan="2"><b>Total</b></td><td class="n"><b>' + $(total) + '</b></td></tr></table>' + (d ? '<p>Bank receipt #: ' + esc(d.bank_ref || '________________') + '</p><p>Made by ' + esc(d.by_name) + '</p>' : '');
    try { if (typeof window.print === 'function' && !/jsdom/i.test(navigator.userAgent)) window.print(); } catch (e) { /* the page still has it */ }
  }
  function bind() {
    const P = st();
    const nw = q('#pm-new'); if (nw) nw.onclick = () => open({ from: 'payments' });
    $$('[data-pmtab]').forEach((b) => { b.onclick = () => { P.tab = b.dataset.pmtab; P.sel = null; P.dsel = null; P.undo = false; X.render(); }; });
    $$('[data-pmpre]').forEach((b) => { b.onclick = () => { if (b.dataset.pmpre === 'custom' && P.pre !== 'custom') { const [f, t] = range(P); P.from = f; P.to = t; } P.pre = b.dataset.pmpre; P.sel = null; X.render(); }; });
    const fr = q('#pm-from'), to = q('#pm-to');
    const pickDates = () => { if (fr.value && to.value && to.value >= fr.value) { P.from = fr.value; P.to = to.value; X.render(); } };
    if (fr) fr.onchange = pickDates; if (to) to.onchange = pickDates;
    const box = q('#pm-q');
    const filt = () => { const v = box.value.trim().toLowerCase(); P.q = box.value; let any = 0; $$('#pm-rows tr.pmr').forEach((r) => { const ok = !v || r.dataset.s.includes(v); r.hidden = !ok; if (ok) any++; }); const nn = q('#pm-none'); if (nn) nn.hidden = !(v && !any); };
    if (box) { box.oninput = filt; if (P.q) filt(); }
    $$('[data-pmopen]').forEach((r) => { r.onclick = () => { P.sel = r.dataset.pmopen; P.vo = null; X.render(); }; });
    const px = q('#pm-px'); if (px) px.onclick = () => { P.sel = null; P.vo = null; X.render(); };
    const vb = q('#pm-void'); if (vb) vb.onclick = () => { P.vo = { id: P.sel, why: '' }; X.render(); const w = q('#pm-vwhy'); if (w) w.focus(); };
    const bk = q('#pm-back'); if (bk) bk.onclick = () => { P.vo = { id: P.sel, why: '', back: true }; X.render(); const w = q('#pm-vwhy'); if (w) w.focus(); };
    const vw = q('#pm-vwhy'); if (vw) vw.oninput = () => { P.vo.why = vw.value; };
    const vn = q('#pm-vno'); if (vn) vn.onclick = () => { P.vo = null; X.render(); };
    const vy = q('#pm-vyes');
    if (vy) vy.onclick = async () => {
      const back = !!P.vo.back;
      if (!P.vo.why.trim()) { q('#pm-verr').textContent = back ? 'Say why it came back. It goes in History.' : 'Say why it’s void. It goes in History.'; return; }
      vy.disabled = true;
      try {
        const r = back ? await db.paymentReturned(A.cid, P.vo.id, P.vo.why) : await db.paymentVoid(A.cid, P.vo.id, P.vo.why);
        P.vo = null; reset();
        X.say(back ? '✓ Check #' + r.check_no + ' came back · ' + $(r.amount) + ' is owed again by ' + r.customer.name : '✓ Payment ' + r.number + ' is void'); X.render();
      }
      catch (e) { vy.disabled = false; q('#pm-verr').textContent = e.message; }
    };
    $$('[data-pmdepopen]').forEach((b) => { b.onclick = () => openDeposit(b.dataset.pmdepopen, b.dataset.pmdepdate); });
    // Take to the bank
    $$('[data-bkp]').forEach((c) => { c.onchange = () => { if (c.checked) delete P.off[c.dataset.bkp]; else P.off[c.dataset.bkp] = 1; bankUpd(); }; });
    const ba = q('#bk-all'); if (ba) ba.onchange = () => { P.off = {}; if (!ba.checked) (P.bank || []).forEach((p) => { P.off[p.id] = 1; }); $$('[data-bkp]').forEach((c) => { c.checked = ba.checked; }); bankUpd(); };
    const bd = q('#bk-date'); if (bd) bd.onchange = () => { P.made_on = bd.value; };
    const bpr = q('#bk-print'); if (bpr) bpr.onclick = () => printSlip(null);
    const mk = q('#bk-make');
    if (mk) mk.onclick = async () => {
      const T = ticked(P); if (!T.length) return;
      P.busy = true; mk.disabled = true;
      try {
        const d = await db.depositMake(A.cid, { ids: T.map((p) => p.id), made_on: P.made_on || today() });
        P.busy = false; P.off = {}; reset(); P.tab = 'deps'; P.dpre = 'month'; P.dsel = d.id; P.undo = false;
        X.say('✓ Deposit #' + d.number + ' made · ' + $(d.total) + ' · print the slip for the bank'); X.render();
      } catch (e) { P.busy = false; mk.disabled = false; q('#bk-err').textContent = e.message; }
    };
    // Deposits
    $$('[data-dppre]').forEach((b) => { b.onclick = () => { if (b.dataset.dppre === 'custom' && P.dpre !== 'custom') { const [f, t] = range({ pre: P.dpre }); P.dfrom = f; P.dto = t; } P.dpre = b.dataset.dppre; P.dsel = null; X.render(); }; });
    const df = q('#dp-from'), dt = q('#dp-to');
    const dpick = () => { if (df.value && dt.value && dt.value >= df.value) { P.dfrom = df.value; P.dto = dt.value; X.render(); } };
    if (df) df.onchange = dpick; if (dt) dt.onchange = dpick;
    $$('[data-dpopen]').forEach((r) => { r.onclick = () => { P.dsel = r.dataset.dpopen; P.undo = false; X.render(); }; });
    const dx = q('#dp-x'); if (dx) dx.onclick = () => { P.dsel = null; P.undo = false; X.render(); };
    const cur = () => P.deps && P.deps.rows.concat(P.deps.waiting).find((d) => d.id === P.dsel);
    const dpp = q('#dp-print'); if (dpp) dpp.onclick = () => printSlip(cur());
    const set = async (p, msg) => {
      try { const d = await db.depositSet(A.cid, P.dsel, p); reset(); P.undo = false; P.dsel = d.id; if (msg) X.say(msg(d)); X.render(); }
      catch (e) { const er = q('#dp-err'); if (er) er.textContent = e.message; }
    };
    const rf = q('#dp-ref'); if (rf) rf.onchange = () => set({ action: 'ref', bank_ref: rf.value }, (d) => '✓ Bank receipt # saved on deposit #' + d.number);
    const un = q('#dp-undo'); if (un) un.onclick = () => { P.undo = true; X.render(); };
    const un2 = q('#dp-undo2'); if (un2) un2.onclick = () => set({ action: 'undo' }, (d) => '✓ Deposit #' + d.number + ' undone · its payments are back in Take to the bank');
    const cf = q('#dp-conf'); if (cf) cf.onclick = () => set({ action: 'confirm' }, (d) => '✓ Deposit #' + d.number + ' confirmed by the bank');
    const uc = q('#dp-unconf'); if (uc) uc.onclick = () => set({ action: 'unconfirm' }, (d) => 'Deposit #' + d.number + ' is waiting for the bank again');
  }
  function openDeposit(id, d) { const P = st(); P.tab = 'deps'; P.dpre = 'custom'; P.dfrom = d || today(); P.dto = d || today(); P.dsel = id; P.undo = false; P.deps = null; P.dkey = ''; X.render(); }
  // Open one payment on the Payments page (from a customer's Invoices & payments tab).
  function show(id, d) { const P = st(); P.tab = 'list'; P.pre = 'custom'; P.from = d || today(); P.to = d || today(); P.sel = id; P.vo = null; reset(); P.q = ''; X.render(); }
  return { open, modalHtml, bindModal, html, bind, howText, show, reset, tab: (k) => { const P = st(); P.tab = k; P.sel = null; P.dsel = null; } };
}
