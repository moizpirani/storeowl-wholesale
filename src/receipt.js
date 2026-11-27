// Phase 3, part 3: a payment receipt — printed at the counter or emailed to the store as a PDF.
// Pure: used by the app, the website (api/send.js) and tests.
import { shortDate, dollars, payMethod } from './rules.js';
import { pdfDoc, fit } from './pdf.js';
import { PRINT_CSS } from './invoice.js';

const $ = (v) => dollars(v);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function addrLines(x) {
  const a = [];
  if ((x.addr || '').trim()) a.push(x.addr.trim());
  const csz = [(x.city || '').trim(), [(x.state || '').trim(), (x.zip || '').trim()].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  if (csz) a.push(csz);
  return a;
}

// o = {co, pay (_pay_json), cust (_cust_json, with owes)}
export function receiptModel(o) {
  const { co = {}, pay = {}, cust = {} } = o;
  const how = payMethod(pay.method) + (pay.method === 'check' && pay.check_no ? ' #' + pay.check_no : '') +
    (pay.status === 'held' && pay.check_date ? ' · dated ' + shortDate(pay.check_date, true) : '');
  const pays = [], credits = [];
  (pay.applied || []).forEach((a) => {
    if (a.from_sale) return;                                   // a credit memo paying an invoice isn't this payment
    pays.push({ what: a.to ? 'Invoice #' + a.number : 'Starting balance', amount: +a.amount || 0 });
  });
  const used = pays.reduce((s, x) => s + x.amount, 0);
  const left = Math.round(((+pay.amount || 0) - used) * 100) / 100;
  if (left > 0.004 && pay.status === 'posted') credits.push({ what: 'Kept as store credit', amount: left });
  return {
    seller: { name: co.name || '', lines: addrLines(co), phone: co.phone || '', email: co.email || '' },
    buyer: { name: cust.name || (pay.customer || {}).name || '', store_no: cust.store_no || '', lines: addrLines(cust) },
    number: pay.number, date: pay.received, amount: +pay.amount || 0, how, note: (pay.note || '').trim(),
    held: pay.status === 'held', void: pay.status === 'void',
    pays, credits, owes: cust.owes == null ? null : +cust.owes, by: pay.by_name || ''
  };
}

export const receiptName = (M) => 'Receipt-' + M.number + '-' + String(M.buyer.name || 'store').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.pdf';

const CSS = PRINT_CSS + '.rcp{max-width:520px}.rcp .iv-pp{grid-template-columns:1fr 1fr!important}.rcp .rc-amt{font-size:22px;font-weight:700;margin:6px 0 2px}.rcp .rc-line{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #E3E6EB}' +
  '.rcp .rc-owe{display:flex;justify-content:space-between;margin-top:10px;font-weight:700;font-size:13px}.rcp .rc-thx{margin-top:14px;color:#5B6676}';
export const RECEIPT_CSS = CSS;

export function receiptHtml(M) {
  const head = '<div class="iv-ih"><div><h1>' + esc(M.seller.name) + '</h1>' + M.seller.lines.map((x) => '<div>' + esc(x) + '</div>').join('') +
    '<div>' + esc([M.seller.phone, M.seller.email].filter(Boolean).join(' · ')) + '</div></div>' +
    '<div class="iv-ino">PAYMENT RECEIPT<b>#' + esc(M.number) + '</b>' + esc(shortDate(M.date, true)) + '</div></div>';
  const from = '<div class="iv-pp"><div><small>Received from</small><b>' + esc(M.buyer.name) + '</b>' + (M.buyer.store_no ? ' · Store #' + esc(M.buyer.store_no) : '') +
    M.buyer.lines.map((x) => '<div>' + esc(x) + '</div>').join('') + '</div><div><small>How they paid</small><b>' + esc(M.how) + '</b></div></div>';
  const lines = M.pays.concat(M.credits).map((x) => '<div class="rc-line"><span>' + (M.credits.includes(x) ? '' : 'Pays ') + esc(x.what) + '</span><b>' + $(x.amount) + '</b></div>').join('');
  return '<section class="inv rcp">' + head + from + (M.void ? '<div class="iv-void">VOID</div>' : '') +
    '<div class="rc-amt">' + $(M.amount) + '</div>' + (M.held ? '<div>Post-dated check: it pays your invoices once it is deposited.</div>' : '') + lines +
    (M.note ? '<div class="rc-line"><span>' + esc(M.note) + '</span></div>' : '') +
    (M.owes != null ? '<div class="rc-owe"><span>You owe now</span><span>' + $(M.owes) + '</span></div>' : '') +
    '<div class="rc-thx">' + (M.by ? 'Taken by ' + esc(M.by) + ' · ' : '') + 'Thank you!</div></section>';
}

export function receiptPdf(M) {
  const d = pdfDoc(612, 792), L = 36, R = 576, NAV = '#0F1B2D', MUT = '#5B6676';
  d.page(); let y = 44;
  d.text(L, y, M.seller.name, { size: 15, bold: true }); d.text(R, y, 'PAYMENT RECEIPT', { size: 14, bold: true, align: 'right' });
  y += 14; let yy = y;
  M.seller.lines.concat([[M.seller.phone, M.seller.email].filter(Boolean).join(' · ')]).filter(Boolean).forEach((t) => { d.text(L, yy, t, { size: 9 }); yy += 11; });
  d.text(R, y, '#' + M.number + ' · ' + shortDate(M.date, true), { size: 10, align: 'right' });
  y = Math.max(yy, y + 14) + 2; d.line(L, y, R, y, NAV, 1.5); y += 16;
  d.text(L, y, 'RECEIVED FROM', { size: 7, bold: true, color: MUT }); d.text(330, y, 'HOW THEY PAID', { size: 7, bold: true, color: MUT }); y += 12;
  d.text(330, y, fit(M.how, 10, 240, true), { size: 10, bold: true });
  [M.buyer.name + (M.buyer.store_no ? ' · Store #' + M.buyer.store_no : '')].concat(M.buyer.lines).forEach((t, k) => { d.text(L, y, fit(t, 9.5, 280, k === 0), { size: 9.5, bold: k === 0 }); y += 12; });
  y += 10; d.text(L, y, $(M.amount) + (M.void ? '   VOID' : ''), { size: 20, bold: true, color: M.void ? '#B42318' : NAV }); y += 18;
  if (M.held) { d.text(L, y, 'Post-dated check: it pays your invoices once it is deposited.', { size: 9, color: MUT }); y += 14; }
  M.pays.concat(M.credits).forEach((x) => {
    d.text(L, y, fit((M.credits.includes(x) ? '' : 'Pays ') + x.what, 10, 360), { size: 10 }); d.text(R, y, $(x.amount), { size: 10, bold: true, align: 'right' });
    y += 5; d.line(L, y, R, y); y += 12;
  });
  if (M.note) { d.text(L, y, fit(M.note, 9.5, R - L), { size: 9.5, color: MUT }); y += 14; }
  if (M.owes != null) { y += 4; d.text(L, y, 'You owe now', { size: 11, bold: true }); d.text(R, y, $(M.owes), { size: 11, bold: true, align: 'right' }); y += 18; }
  d.text(L, y, (M.by ? 'Taken by ' + M.by + ' · ' : '') + 'Thank you!', { size: 9.5, color: MUT });
  return { bytes: d.bytes(), pages: d.count };
}

export function receiptEmailText(M, co) {
  return { subject: co.name + ' · Payment receipt #' + M.number + ' · ' + $(M.amount),
    text: 'Hello ' + M.buyer.name + ',\n\nThank you for your payment of ' + $(M.amount) + ' (' + M.how + ') on ' + shortDate(M.date, true) + '. The receipt is attached.' +
      (M.owes != null ? '\n\nYou owe now: ' + $(M.owes) : '') + '\n\nQuestions? Reply to this email.\n\n' + co.name + (co.phone ? '\n' + co.phone : '') };
}
