// Phase 3, part 1: a store's statement for any dates — what they owed at the start, every invoice, credit memo and
// payment with a running balance (voids left out), what they owe now, past due by age, and their open invoices.
// Pure: printed (Letter), as a PDF for email. Used by the app, the website (api/send.js) and tests.
import { termName, shortDate, dollars, payMethod, addDays } from './rules.js';
import { pdfDoc, fit } from './pdf.js';
import { PRINT_CSS } from './invoice.js';

const r2 = (v) => Math.round((+v || 0) * 100) / 100;
const $ = (v) => dollars(v);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function addrLines(x) {
  const a = [];
  if ((x.addr || '').trim()) a.push(x.addr.trim());
  const csz = [(x.city || '').trim(), [(x.state || '').trim(), (x.zip || '').trim()].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  if (csz) a.push(csz);
  return a;
}

// o = {co, cust, acct (customer_account), from, to, today}
export function stmtModel(o) {
  const { co, cust, acct } = o, c = cust || {};
  const rows = (acct.rows || []).concat(acct.payments || []).filter((r) => r.status === 'posted')
    .sort((x, y) => (x.date === y.date ? (x.kind === 'payment') - (y.kind === 'payment') || x.number - y.number : x.date < y.date ? -1 : 1));
  let bal = r2(acct.before);
  const lines = rows.map((r) => {
    bal = r2(bal + r.total);
    const what = r.kind === 'payment' ? 'Payment · ' + payMethod(r.method) + (r.check_no ? ' #' + r.check_no : '') : r.kind === 'credit' ? 'Credit memo' : 'Invoice';
    return { date: r.date, what, num: r.number, kind: r.kind, charge: r.total > 0 ? r.total : null, credit: r.total < 0 ? -r.total : null, bal,
      due: r.kind === 'invoice' ? addDays(r.date, ({ net7: 7, net10: 10, net14: 14, net30: 30 }[c.terms] || 0)) : null };
  });
  const sum = (k) => r2(rows.filter((r) => r.kind === k).reduce((a, r) => a + r.total, 0));
  const O = acct.open || { invoices: [], aging: { current: 0, d30: 0, d60: 0, d90: 0, over: 0 }, store_credit: 0, past_due: 0 };
  return {
    seller: { name: co.name || '', lines: addrLines(co), phone: co.phone || '', email: co.email || '' },
    buyer: { name: c.name || '', store_no: c.store_no || '', acct_no: c.acct_no || '', lines: addrLines(c) },
    from: o.from, to: o.to, made: o.today || o.to, terms: termName(c.terms),
    before: r2(acct.before), lines, end: bal,
    totals: { invoices: sum('invoice'), credits: sum('credit'), payments: sum('payment') },
    aging: O.aging, past_due: O.past_due, store_credit: O.store_credit,
    open: (O.invoices || []).map((x) => ({ num: x.opening ? 'Starting balance' : String(x.number), date: x.date, due: x.due, total: x.total, open: x.open, late: x.late })),
    note: (o.note != null && String(o.note).trim() ? String(o.note) : ((co.settings || {}).inv || {}).stmt_note || '').trim()
  };
}

const CSS = PRINT_CSS + '.stm .iv-age{display:flex;margin:10px 0;border:1px solid #C7D0DC;border-radius:4px}.stm .iv-age>div{flex:1;padding:5px 8px;border-left:1px solid #C7D0DC}' +
  '.stm .iv-age>div:first-child{border-left:0}.stm .iv-age small{display:block;color:#5B6676;font-size:8.5px;text-transform:uppercase}.stm .iv-age b{font-size:12px}.stm h3{font-size:11px;margin:12px 0 4px}';
export const STMT_CSS = CSS;

export function stmtHtml(M) {
  const head = '<div class="iv-ih"><div><h1>' + esc(M.seller.name) + '</h1>' + M.seller.lines.map((x) => '<div>' + esc(x) + '</div>').join('') +
    '<div>' + esc([M.seller.phone, M.seller.email].filter(Boolean).join(' · ')) + '</div></div>' +
    '<div class="iv-ino">STATEMENT<b>' + esc(shortDate(M.from, true)) + ' – ' + esc(shortDate(M.to, true)) + '</b>Made ' + esc(shortDate(M.made, true)) + '</div></div>';
  const pp = '<div class="iv-pp"><div><small>Statement for</small><b>' + esc(M.buyer.name) + '</b>' + (M.buyer.store_no ? ' · Store #' + esc(M.buyer.store_no) : '') +
    M.buyer.lines.map((x) => '<div>' + esc(x) + '</div>').join('') + (M.buyer.acct_no ? '<div>Customer # ' + esc(M.buyer.acct_no) + '</div>' : '') + '</div>' +
    (M.terms ? '<div><small>Terms</small><b>' + esc(M.terms) + '</b></div>' : '<div></div>') + '<div><small>You owe now</small><b style="font-size:16px">' + $(M.end) + '</b>' +
    (M.past_due > 0 ? '<div>' + $(M.past_due) + ' is past due</div>' : '') + '</div></div>';
  const th = '<tr><th>Date</th><th>What</th><th>#</th><th>Due</th><th class="iv-n">Charges</th><th class="iv-n">Credits &amp; payments</th><th class="iv-n">Balance</th></tr>';
  const rows = '<tr class="iv-cat"><td>' + esc(shortDate(M.from, true)) + '</td><td colspan="5">You owed at the start</td><td class="iv-n">' + $(M.before) + '</td></tr>' +
    M.lines.map((l) => '<tr><td>' + esc(shortDate(l.date, true)) + '</td><td>' + esc(l.what) + '</td><td>' + esc(l.num) + '</td><td>' + (l.due ? esc(shortDate(l.due, true)) : '') + '</td>' +
      '<td class="iv-n">' + (l.charge != null ? $(l.charge) : '') + '</td><td class="iv-n">' + (l.credit != null ? $(l.credit) : '') + '</td><td class="iv-n"><b>' + $(l.bal) + '</b></td></tr>').join('') +
    '<tr class="iv-sub"><td colspan="4">You owe at the end</td><td class="iv-n">' + $(M.totals.invoices) + '</td><td class="iv-n">' + $(-(M.totals.credits + M.totals.payments)) + '</td><td class="iv-n">' + $(M.end) + '</td></tr>';
  const A = M.aging || {};
  const age = '<div class="iv-age">' + [['Current', A.current], ['1–30 days', A.d30], ['31–60', A.d60], ['61–90', A.d90], ['Over 90', A.over]].map(([n, v]) => '<div><small>' + n + '</small><b>' + $(v || 0) + '</b></div>').join('') + '</div>';
  const open = M.open.length ? '<h3>Still open</h3><table><thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th class="iv-n">Invoice total</th><th class="iv-n">Still owed</th></tr></thead><tbody>' +
    M.open.map((x) => '<tr><td>' + esc(x.num) + '</td><td>' + esc(shortDate(x.date, true)) + '</td><td>' + esc(shortDate(x.due, true)) + (x.late ? ' · <span class="iv-short">' + x.late + ' days late</span>' : '') + '</td><td class="iv-n">' + $(x.total) + '</td><td class="iv-n"><b>' + $(x.open) + '</b></td></tr>').join('') + '</tbody></table>' : '';
  const sc = M.store_credit > 0 ? '<div class="iv-tax">Store credit not used yet: ' + $(M.store_credit) + '</div>' : '';
  return '<section class="inv stm">' + head + pp + '<table><thead>' + th + '</thead><tbody>' + rows + '</tbody></table>' + age + open + sc +
    (M.note ? '<div class="iv-ft">' + esc(M.note) + '</div>' : '') + '</section>';
}

export function stmtPdf(M) {
  const d = pdfDoc(612, 792), L = 36, R = 576, NAV = '#0F1B2D', MUT = '#5B6676';
  const cols = [[L + 4, 'Date', 'left'], [104, 'What', 'left'], [262, '#', 'left'], [302, 'Due', 'left'], [430, 'Charges', 'right'], [505, 'Credits & payments', 'right'], [R - 4, 'Balance', 'right']];
  let y = 0;
  const header = () => {
    d.page(); y = 44;
    d.text(L, y, M.seller.name, { size: 15, bold: true }); d.text(R, y, 'STATEMENT', { size: 14, bold: true, align: 'right' });
    y += 14; let yy = y;
    M.seller.lines.concat([[M.seller.phone, M.seller.email].filter(Boolean).join(' · ')]).filter(Boolean).forEach((t) => { d.text(L, yy, t, { size: 9 }); yy += 11; });
    d.text(R, y, shortDate(M.from, true) + ' – ' + shortDate(M.to, true), { size: 10, align: 'right' });
    d.text(R, y + 12, 'Made ' + shortDate(M.made, true), { size: 8.5, color: MUT, align: 'right' });
    y = Math.max(yy, y + 24) + 2; d.line(L, y, R, y, NAV, 1.5); y += 14;
  };
  const tableHead = () => { d.rect(L, y - 9, R - L, 13, NAV); cols.forEach(([x, t, a]) => d.text(x, y, t, { size: 8, bold: true, color: '#FFFFFF', align: a })); y += 14; };
  const room = (h) => { if (y + h > 740) { header(); tableHead(); } };
  header();
  let yy = y; d.text(L, yy, 'STATEMENT FOR', { size: 7, bold: true, color: MUT }); yy += 11;
  [M.buyer.name + (M.buyer.store_no ? ' · Store #' + M.buyer.store_no : '')].concat(M.buyer.lines, M.buyer.acct_no ? ['Customer # ' + M.buyer.acct_no] : [])
    .forEach((t, k) => { d.text(L, yy, fit(t, 9, 250, k === 0), { size: 9, bold: k === 0 }); yy += 11; });
  if (M.terms) { d.text(320, y, 'TERMS', { size: 7, bold: true, color: MUT }); d.text(320, y + 11, M.terms, { size: 9, bold: true }); }
  d.text(R, y, 'YOU OWE NOW', { size: 7, bold: true, color: MUT, align: 'right' }); d.text(R, y + 15, $(M.end), { size: 15, bold: true, align: 'right' });
  if (M.past_due > 0) d.text(R, y + 27, $(M.past_due) + ' is past due', { size: 8.5, color: '#B4570A', align: 'right' });
  y = Math.max(yy, y + 34) + 8; tableHead();
  d.rect(L, y - 9, R - L, 13, '#EEF2F7'); d.text(cols[0][0], y, shortDate(M.from, true), { size: 8.5, bold: true }); d.text(cols[1][0], y, 'You owed at the start', { size: 8.5, bold: true });
  d.text(cols[6][0], y, $(M.before), { size: 8.5, bold: true, align: 'right' }); y += 14;
  M.lines.forEach((l) => {
    room(16);
    d.text(cols[0][0], y, shortDate(l.date, true), { size: 8.5 }); d.text(cols[1][0], y, fit(l.what, 8.5, 150), { size: 8.5 }); d.text(cols[2][0], y, String(l.num), { size: 8.5 });
    d.text(cols[3][0], y, l.due ? shortDate(l.due, true) : '', { size: 8.5 });
    if (l.charge != null) d.text(cols[4][0], y, $(l.charge), { size: 8.5, align: 'right' });
    if (l.credit != null) d.text(cols[5][0], y, $(l.credit), { size: 8.5, align: 'right' });
    d.text(cols[6][0], y, $(l.bal), { size: 8.5, bold: true, align: 'right' });
    y += 4; d.line(L, y, R, y); y += 10;
  });
  room(20); d.text(L + 4, y, 'You owe at the end', { size: 9, bold: true }); d.text(cols[4][0], y, $(M.totals.invoices), { size: 9, bold: true, align: 'right' });
  d.text(cols[5][0], y, $(-(M.totals.credits + M.totals.payments)), { size: 9, bold: true, align: 'right' }); d.text(cols[6][0], y, $(M.end), { size: 9, bold: true, align: 'right' }); y += 20;
  room(40); const A = M.aging || {}, bw = (R - L) / 5;
  [['CURRENT', A.current], ['1–30 DAYS', A.d30], ['31–60', A.d60], ['61–90', A.d90], ['OVER 90', A.over]].forEach(([n, v], i) => {
    const x = L + i * bw; d.rect(x, y - 10, bw - 4, 30, null, '#C7D0DC'); d.text(x + 6, y, n, { size: 7, bold: true, color: MUT }); d.text(x + 6, y + 13, $(v || 0), { size: 10, bold: true });
  });
  y += 36;
  if (M.open.length) {
    room(30); d.text(L, y, 'Still open', { size: 10, bold: true }); y += 14;
    M.open.forEach((x) => { room(14); d.text(L + 4, y, x.num, { size: 8.5 }); d.text(150, y, shortDate(x.date, true), { size: 8.5 });
      d.text(250, y, 'Due ' + shortDate(x.due, true) + (x.late ? ' · ' + x.late + ' days late' : ''), { size: 8.5, color: x.late ? '#B4570A' : NAV });
      d.text(470, y, $(x.total), { size: 8.5, align: 'right' }); d.text(R - 4, y, $(x.open), { size: 8.5, bold: true, align: 'right' }); y += 13; });
    y += 4;
  }
  if (M.store_credit > 0) { room(14); d.text(L, y, 'Store credit not used yet: ' + $(M.store_credit), { size: 9.5, bold: true }); y += 14; }
  if (M.note) M.note.split(/\n+/).forEach((t) => { room(12); d.text(L, y, fit(t, 8.5, R - L), { size: 8.5, color: MUT }); y += 11; });
  return { bytes: d.bytes(), pages: d.count };
}
export const stmtName = (M) => 'Statement-' + String(M.buyer.name || 'Store').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') + '-' + M.to + '.pdf';
export function stmtEmailText(M, co) {
  return { subject: co.name + ' · Statement ' + shortDate(M.from, true) + ' – ' + shortDate(M.to, true) + ' · You owe ' + $(M.end),
    text: 'Hello ' + M.buyer.name + ',\n\nYour statement from ' + co.name + ' is attached.\n\nYou owe now: ' + $(M.end) + (M.past_due > 0 ? '\nPast due: ' + $(M.past_due) : '') +
      (M.terms ? '\nTerms: ' + M.terms : '') + '\n\nQuestions? Reply to this email.\n\n' + co.name + (co.phone ? '\n' + co.phone : '') };
}
