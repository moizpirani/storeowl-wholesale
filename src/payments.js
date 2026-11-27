// Phase 3, part 1: the Payments page (payments list, post-dated checks, today's deposit) and the "Take a payment"
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
      (held ? '<br><span class="miss">Post-dated check: it waits until ' + esc(shortDate(T.check_date, true)) + ' and counts when you deposit it.</span>' : '');
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
        const done = T.onDone; A.pay = null; A.pm = A.pm ? Object.assign(A.pm, { data: null, key: '' }) : A.pm;
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
  function st() { if (!A.pm) A.pm = { tab: 'list', pre: 'month', from: '', to: '', q: '', sel: null, data: null, key: '', err: '', dep: '', vo: null }; return A.pm; }
  function load() {
    const P = st(), [f, t] = range(P), dep = P.dep || today();
    const lo = f < dep ? f : dep, k = A.cid + '|' + lo + '|' + t;
    if (P.key === k && (P.data || P.err)) return;
    P.key = k; P.data = null; P.err = '';
    const cid = A.cid;
    db.payments(cid, lo, t > dep ? t : dep).then((d) => { if (A.cid !== cid || P.key !== k) return; P.data = d; if (A.view === 'payments') X.render(); })
      .catch((e) => { if (P.key !== k) return; P.err = e.message; if (A.view === 'payments') X.render(); });
  }
  function tag(p) {
    if (p.status === 'void') return '<span class="tag bad">Void</span>';
    if (p.status === 'held') return '<span class="tag need">Post-dated · ' + esc(shortDate(p.check_date)) + '</span>';
    return '';
  }
  const paidText = (p) => {
    const n = Array.from(new Set(p.applied.map((a) => (a.number ? '#' + a.number : 'Starting balance'))));
    const left = r2(Number(p.amount) - p.applied.filter((a) => !a.from_sale).reduce((a, x) => a + Number(x.amount), 0));
    const pre = p.status === 'held' ? 'When deposited, pays ' : 'Pays ';
    if (!n.length) return p.status === 'void' ? 'Paid nothing' : 'Kept as store credit';
    return pre + n.join(', ') + (left > 0.004 && p.status !== 'void' ? ' · ' + $(left) + ' store credit' : '');
  };
  function html() {
    const P = st(); load();
    const held = P.data ? P.data.held : [];
    const dueNow = held.filter((p) => p.check_date <= today()).length;
    const tabs = '<nav class="ctabs">' + [['list', 'Payments'], ['held', 'Post-dated checks' + (held.length ? '<em' + (dueNow ? '' : ' class="g"') + '>' + held.length + '</em>' : '')], ['deposit', 'Deposit']]
      .map(([k, n]) => '<button class="' + (P.tab === k ? 'on' : '') + '" data-pmtab="' + k + '" data-guide="payments-page-tab">' + n + '</button>').join('') + '</nav>';
    const head = '<div class="hdr"><h1>Payments</h1><button class="btn amber" id="pm-new" data-guide="payments-page-take">+ Take a payment</button></div>';
    if (P.err) return head + tabs + '<div class="card"><p class="sm bad">' + esc(P.err) + '</p></div>';
    if (!P.data) return head + tabs + '<div class="card"><p class="sm">Loading…</p></div>';
    let body = '';
    if (P.tab === 'list') body = listHtml(P);
    if (P.tab === 'held') body = heldHtml(held);
    if (P.tab === 'deposit') body = depositHtml(P);
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
    const voidAsk = p.status !== 'void' && X.isMgr() ? (V ? '<div class="card ivvoidask"><b>Void payment ' + p.number + '?</b><p class="sm">What it paid is owed again. Use this for a mistake or a check that came back.</p>' +
        '<label class="fld"><span>Why?</span><input id="pm-vwhy" value="' + esc(V.why) + '" placeholder="e.g. check came back" data-guide="payments-payment-void-why"></label><p class="fmsg" id="pm-verr"></p>' +
        '<div class="rowr"><button class="btn" id="pm-vno" data-guide="payments-payment-void-cancel">Keep it</button><button class="btn red" id="pm-vyes" data-guide="payments-payment-void-confirm">Void it</button></div></div>'
      : '<button class="lnk bad ivvoidlnk" id="pm-void" data-guide="payments-payment-void">Void this payment…</button>') : '';
    return '<aside class="card panel ivpan"><div class="hdr"><h2>Payment ' + p.number + '</h2><button class="x" id="pm-px" aria-label="Close" data-guide="payments-payment-close">×</button></div>' +
      '<p class="sm">' + esc(p.customer.name) + ' · ' + esc(shortDate(p.received, true)) + ' · ' + esc(howText(p)) + (p.check_date ? ' · dated ' + esc(shortDate(p.check_date, true)) : '') + ' · by ' + esc(p.by_name) + '</p>' + voidBox +
      '<table class="t"><tbody>' + (lines || '<tr><td class="empty">Paid no invoice</td><td></td></tr>') +
      (left > 0.004 ? '<tr><td>Left over · store credit</td><td class="n">' + $(left) + '</td></tr>' : '') +
      '<tr><td><b>Amount</b></td><td class="n"><b>' + $(p.amount) + '</b></td></tr></tbody></table>' +
      (p.note ? '<p class="sm">Note: ' + esc(p.note) + '</p>' : '') + voidAsk + '</aside>';
  }
  const P2 = () => st();
  function heldHtml(held) {
    if (!held.length) return '<div class="card"><p class="emptyc">No post-dated checks waiting</p></div>';
    return '<div class="cc"><table class="t tsm actab"><thead><tr><th>Date on the check</th><th>Check #</th><th>Store</th><th>What it pays</th><th class="n">Amount</th><th></th></tr></thead><tbody>' +
      held.map((p) => { const due = p.check_date <= today();
        return '<tr><td>' + esc(shortDate(p.check_date, true)) + (due ? ' <span class="tag need">Deposit now</span>' : '') + '</td><td class="acnum">' + esc(p.check_no) + '</td><td><b>' + esc(p.customer.name) + '</b></td>' +
          '<td class="acsub">' + esc(paidText(p)) + '</td><td class="n"><b>' + $(p.amount) + '</b></td><td class="n">' +
          (due ? '<button class="btn sm" data-pmdep="' + p.id + '" data-guide="payments-held-deposit">Deposited</button>' : '<span class="mut sm">Waits</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function depositHtml(P) {
    const d = P.dep || today(), all = P.data.rows.filter((p) => p.status === 'posted' && (p.method === 'cash' || p.method === 'check') &&
      ((p.received === d && !p.deposited_at) || (p.deposited_at && String(p.deposited_at).slice(0, 10) === d)));
    const cash = all.filter((p) => p.method === 'cash'), chk = all.filter((p) => p.method === 'check');
    const sum = (l) => r2(l.reduce((a, p) => a + Number(p.amount), 0));
    return '<div class="acbar"><label class="fld pmdep"><span>Deposit for</span><input type="date" class="inp" id="pm-dep" value="' + esc(d) + '" max="' + esc(today()) + '" data-guide="payments-deposit-day"></label>' +
      '<button class="btn" id="pm-dprint" data-guide="payments-deposit-print">Print deposit list</button></div>' +
      '<div class="kpis ackpis pmdk"><div class="kb"><span>Cash</span><b>' + $(sum(cash)) + '</b><small>' + cash.length + ' ' + (cash.length === 1 ? 'payment' : 'payments') + '</small></div>' +
      '<div class="kb"><span>Checks</span><b>' + $(sum(chk)) + '</b><small>' + chk.length + ' ' + (chk.length === 1 ? 'check' : 'checks') + '</small></div>' +
      '<div class="kb nv"><span>To deposit</span><b>' + $(sum(all)) + '</b></div></div>' +
      '<div class="cc"><table class="t tsm actab"><thead><tr><th>Check #</th><th>Store</th><th>Payment</th><th class="n">Amount</th></tr></thead><tbody>' +
      (chk.length ? chk.map((p) => '<tr><td class="acnum">' + esc(p.check_no) + '</td><td>' + esc(p.customer.name) + '</td><td>#' + p.number + '</td><td class="n">' + $(p.amount) + '</td></tr>').join('') : '<tr><td colspan="4" class="empty">No checks</td></tr>') +
      '<tr><td colspan="3"><b>Cash</b></td><td class="n"><b>' + $(sum(cash)) + '</b></td></tr><tr><td colspan="3"><b>Total</b></td><td class="n"><b>' + $(sum(all)) + '</b></td></tr></tbody></table></div>';
  }
  function printDeposit() {
    const P = st(), d = P.dep || today();
    const all = P.data.rows.filter((p) => p.status === 'posted' && (p.method === 'cash' || p.method === 'check') && ((p.received === d && !p.deposited_at) || (p.deposited_at && String(p.deposited_at).slice(0, 10) === d)));
    const chk = all.filter((p) => p.method === 'check'), cash = r2(all.filter((p) => p.method === 'cash').reduce((a, p) => a + Number(p.amount), 0));
    let box = document.getElementById('printout');
    if (!box) { box = document.createElement('div'); box.id = 'printout'; document.body.appendChild(box); }
    const co = X.co() || {};
    box.innerHTML = '<style>@media screen{#printout{display:none}}@media print{body>*:not(#printout){display:none!important}#printout{display:block;font:12px Arial}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ccc;padding:4px;text-align:left}.n{text-align:right}}</style>' +
      '<h2>' + esc(co.name || '') + ' · Deposit ' + esc(shortDate(d, true)) + '</h2><table><tr><th>Check #</th><th>Store</th><th class="n">Amount</th></tr>' +
      chk.map((p) => '<tr><td>' + esc(p.check_no) + '</td><td>' + esc(p.customer.name) + '</td><td class="n">' + $(p.amount) + '</td></tr>').join('') +
      '<tr><td colspan="2"><b>Checks</b></td><td class="n">' + $(r2(chk.reduce((a, p) => a + Number(p.amount), 0))) + '</td></tr><tr><td colspan="2"><b>Cash</b></td><td class="n">' + $(cash) + '</td></tr>' +
      '<tr><td colspan="2"><b>Total</b></td><td class="n"><b>' + $(r2(all.reduce((a, p) => a + Number(p.amount), 0))) + '</b></td></tr></table>';
    try { if (typeof window.print === 'function' && !/jsdom/i.test(navigator.userAgent)) window.print(); } catch (e) { /* the page still has it */ }
  }
  function bind() {
    const P = st();
    const nw = q('#pm-new'); if (nw) nw.onclick = () => open({ from: 'payments' });
    $$('[data-pmtab]').forEach((b) => { b.onclick = () => { P.tab = b.dataset.pmtab; P.sel = null; X.render(); }; });
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
    const vw = q('#pm-vwhy'); if (vw) vw.oninput = () => { P.vo.why = vw.value; };
    const vn = q('#pm-vno'); if (vn) vn.onclick = () => { P.vo = null; X.render(); };
    const vy = q('#pm-vyes');
    if (vy) vy.onclick = async () => {
      if (!P.vo.why.trim()) { q('#pm-verr').textContent = 'Say why it’s void. It goes in History.'; return; }
      vy.disabled = true;
      try { const r = await db.paymentVoid(A.cid, P.vo.id, P.vo.why); P.vo = null; P.data = null; P.key = ''; X.say('✓ Payment ' + r.number + ' is void'); X.render(); }
      catch (e) { vy.disabled = false; q('#pm-verr').textContent = e.message; }
    };
    $$('[data-pmdep]').forEach((b) => { b.onclick = async () => {
      b.disabled = true;
      try { const r = await db.paymentDeposit(A.cid, b.dataset.pmdep); P.data = null; P.key = ''; X.say('✓ Check ' + r.check_no + ' deposited · ' + $(r.amount) + ' taken off what ' + r.customer.name + ' owes'); X.render(); }
      catch (e) { b.disabled = false; X.say(e.message, true); }
    }; });
    const dp = q('#pm-dep'); if (dp) dp.onchange = () => { P.dep = dp.value; X.render(); };
    const pr = q('#pm-dprint'); if (pr) pr.onclick = printDeposit;
  }
  // Open one payment on the Payments page (from a customer's Invoices & payments tab).
  function show(id, d) { const P = st(); P.tab = 'list'; P.pre = 'custom'; P.from = d || today(); P.to = d || today(); P.sel = id; P.vo = null; P.data = null; P.key = ''; P.q = ''; X.render(); }
  return { open, modalHtml, bindModal, html, bind, howText, show };
}
