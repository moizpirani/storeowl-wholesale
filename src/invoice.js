// Phase 2, piece 3: the invoice the store gets — printed (Letter), as a PDF in an email, and as an EDI file
// for the store's back office. Pure: no screens, no database. Used by the app, the website (api/send.js) and tests.
//
// The EDI file is the same fixed-width text file the big regional wholesalers email to stores (Moiz: "It has to work
// just like Hackney"), so any back office that already reads theirs reads ours the same way:
//   A + customer # (6) + invoice # (10) + MMDDYY + ±total in cents (9) + customer # (6)          = one invoice
//   B + UPC of the SINGLE pack without its check digit (11) + name (24) + item # (7) + case cost in cents (6)
//     + unit type (2) + units in a case (6) + ±cases (4) + suggested retail in cents (5) + retail for how many (3)
//   C + code (3) + name + amount in cents (8)                                                      = a charge
// The barcode is always the single pack's (what the store's register scans), never the carton's.

import { catName, termName, licName, plural, shortDate, cleanUpc, money } from './rules.js';
import { pdfDoc, fit } from './pdf.js';

// ---------- Settings → Invoices ----------
export const INV_DEFAULT = {
  lic: '',            // your license numbers, one per line ("TN Tobacco Distributor #12345")
  msa: '',            // MSA / directory ID
  photos: true, barcodes: true, owes: true, sign: false,
  tax_line: true, tax_text: '', // the tobacco-tax-paid line; '' = the state's usual words
  footer: 'Please check your order before signing. Returns within 7 days with this invoice.',
  after: { print: true, email: false, edi: false },
  copies: 1
};
const TAX_TEXT = { TN: 'Tennessee Dept of Revenue Tobacco Tax Paid Invoice' };
export function invSettings(co) {
  const s = Object.assign({}, INV_DEFAULT, ((co && co.settings) || {}).inv || {});
  s.after = Object.assign({}, INV_DEFAULT.after, s.after || {});
  s.copies = Math.min(Math.max(parseInt(s.copies, 10) || 1, 1), 5);
  return s;
}
export function taxText(co, s) {
  s = s || invSettings(co);
  if (!s.tax_line) return '';
  return (s.tax_text || '').trim() || TAX_TEXT[(co && co.home) || ''] || '';
}
// What a store normally gets after a sale: its own choice, else the company's.
export function sendChoice(co, cust) {
  const a = invSettings(co).after, g = (cust && cust.gets) || {};
  const pick = (k) => (g[k] == null ? !!a[k] : !!g[k]);
  return { print: pick('print'), email: pick('email') && !!invEmail(cust), edi: pick('edi') && !!(cust && cust.edi_email) };
}
export const invEmail = (c) => ((c && (c.inv_email || c.email)) || '').trim();

// ---------- the invoice, worked out once for print, PDF and email ----------
const CIG = 'cigarettes';
export function sizeText(l) { return l.size + (l.n > 1 ? ' · ' + l.n + ' ' + plural(l.unit_name || 'each', l.n) : ''); }
export function invModel(o) {
  const { sale, co, cust } = o, s = invSettings(co), c = cust || sale.customer || {};
  const lines = (sale.lines || []).map((l) => Object.assign({}, l, { short: Math.max((+l.ordered || 0) - (+l.shipped || 0), 0) }));
  const groups = [];
  lines.forEach((l) => {
    let g = groups.find((x) => x.cat === l.category);
    if (!g) { g = { cat: l.category, name: catName(l.category), lines: [], sub: 0, units: 0 }; groups.push(g); }
    g.lines.push(l); g.sub = r2(g.sub + (+l.total || 0)); g.units += +l.shipped || 0;
  });
  const cig = r2(lines.filter((l) => l.category === CIG).reduce((a, l) => a + (+l.total || 0), 0));
  const total = r2(+sale.total || lines.reduce((a, l) => a + (+l.total || 0), 0));
  const owesNow = c.owes == null ? null : r2(+c.owes);
  const fresh = !!o.fresh && owesNow != null;
  const lic = (c.licenses || []).filter((x) => (x.number || '').trim()).map((x) => ({ name: licName(x.kind), number: x.number, expires: x.expires }));
  return {
    num: sale.number, date: sale.invoice_date, soldBy: sale.posted_by || sale.by_name || '',
    seller: { name: co.name || '', lines: addrLines(co), phone: co.phone || '', email: co.email || '',
      lic: String(s.lic || '').split(/\n+/).map((x) => x.trim()).filter(Boolean), msa: (s.msa || '').trim() },
    buyer: { name: c.name || '', store_no: c.store_no || '', lines: addrLines(c), ship_to: c.ship_to || '', lic },
    terms: termName(c.terms), groups, lines,
    sums: { cig, other: r2(total - cig), total, units: lines.reduce((a, l) => a + (+l.shipped || 0), 0) },
    owes: s.owes && owesNow != null ? (fresh ? { before: r2(owesNow - total), now: owesNow } : { asOf: o.today || '', now: owesNow }) : null,
    tax: cig > 0 ? taxText(co, s) : '', footer: (s.footer || '').trim(), sign: !!s.sign,
    show: { photos: !!s.photos, barcodes: !!s.barcodes }, lic_reason: sale.lic_reason || ''
  };
}
const r2 = (v) => Math.round((+v || 0) * 100) / 100;
function addrLines(x) {
  const a = [];
  if ((x.addr || '').trim()) a.push(x.addr.trim());
  const csz = [(x.city || '').trim(), [(x.state || '').trim(), (x.zip || '').trim()].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  if (csz) a.push(csz);
  return a;
}
const $ = (v) => '$' + money(v);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- UPC-A barcode (a real one a scanner reads) ----------
const LC = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
export function checkDigit(d11) { let s = 0; for (let i = 0; i < 11; i++) s += (+d11[i]) * (i % 2 === 0 ? 3 : 1); return (10 - (s % 10)) % 10; }
// The 12-digit UPC-A for a barcode (11 digits get their check digit; a 13-digit one starting with 0 drops it), else ''.
export function upc12(u) {
  u = cleanUpc(u);
  if (u.length === 14 && u.startsWith('00')) u = u.slice(2);
  if (u.length === 13 && u.startsWith('0')) u = u.slice(1);
  if (u.length === 11) return u + checkDigit(u);
  if (u.length === 12 && checkDigit(u) === +u[11]) return u;
  return '';
}
export function barcodeSvg(u, h) {
  const d = upc12(u); if (!d) return '';
  let bits = '101';
  for (let i = 0; i < 6; i++) bits += LC[+d[i]];
  bits += '01010';
  for (let i = 6; i < 12; i++) bits += LC[+d[i]].replace(/./g, (b) => (b === '1' ? '0' : '1'));
  bits += '101';
  h = h || 22; let r = '';
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') r += '<rect x="' + i + '" y="0" width="1" height="' + h + '"/>';
  return '<svg class="iv-bc" viewBox="0 0 95 ' + h + '" preserveAspectRatio="none" aria-label="Barcode ' + d + '">' + r + '</svg>';
}

// ---------- printed invoice (Letter) ----------
export const PRINT_CSS = '@page{size:letter;margin:.45in}.inv{font:10px/1.3 "Public Sans",Arial,sans-serif;color:#0F1B2D;font-variant-numeric:tabular-nums}' +
  '.inv+.inv{break-before:page}.inv .iv-ih{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #0F1B2D;padding-bottom:8px}' +
  '.inv h1{font-size:18px;margin:0}.inv .iv-ino{text-align:right}.inv .iv-ino b{font-size:20px;display:block}.inv .iv-lic{font-size:9px;color:#3A4658}' +
  '.inv .iv-pp{display:flex;gap:16px;margin:10px 0}.inv .iv-pp>div{flex:1;border:1px solid #C7D0DC;border-radius:4px;padding:6px 8px}.inv .iv-pp small{display:block;color:#5B6676;font-size:8.5px;text-transform:uppercase;letter-spacing:.04em}' +
  '.inv table{width:100%;border-collapse:collapse}.inv th{background:#0F1B2D;color:#fff;font-size:8.5px;text-align:left;padding:4px 5px;font-weight:600}' +
  '.inv td{padding:3px 5px;border-bottom:1px solid #E3E6EB;vertical-align:middle}.inv .iv-n{text-align:right;white-space:nowrap}.inv .iv-cat td{background:#EEF2F7;font-weight:700}' +
  '.inv .iv-sub td{font-weight:700;border-bottom:1px solid #9AA6B5}.inv img.iv-ph{width:26px;height:26px;object-fit:contain}.inv .iv-bc{width:78px;height:16px;display:block;fill:#000}' +
  '.inv .iv-was{text-decoration:line-through;color:#7A8493;font-size:8.5px;display:block}.inv .iv-short{color:#B4570A;font-weight:600}.inv .iv-up{font-size:8.5px;color:#3A4658}' +
  '.inv .iv-sums{display:flex;justify-content:space-between;gap:16px;margin-top:10px}.inv .iv-sums table{width:auto;min-width:230px}.inv .iv-sums td{border:0;padding:2px 5px}' +
  '.inv .iv-tot td{font-size:13px;font-weight:800;border-top:2px solid #0F1B2D}.inv .iv-tax{margin-top:8px;font-weight:700}.inv .iv-ft{margin-top:10px;font-size:9px;color:#3A4658;white-space:pre-line}' +
  '.inv .iv-sig{margin-top:22px;display:flex;gap:30px}.inv .iv-sig span{flex:1;border-top:1px solid #0F1B2D;padding-top:2px;font-size:8.5px}';

export function invoiceHtml(M) {
  const seller = '<div><h1>' + esc(M.seller.name) + '</h1>' + M.seller.lines.map((x) => '<div>' + esc(x) + '</div>').join('') +
    '<div>' + esc([M.seller.phone, M.seller.email].filter(Boolean).join(' · ')) + '</div>' +
    (M.seller.lic.length || M.seller.msa ? '<div class="iv-lic">' + M.seller.lic.map(esc).join('<br>') + (M.seller.msa ? (M.seller.lic.length ? '<br>' : '') + 'MSA ID ' + esc(M.seller.msa) : '') + '</div>' : '') + '</div>';
  const head = '<div class="iv-ih">' + seller + '<div class="iv-ino">INVOICE<b>#' + esc(M.num) + '</b>' + esc(shortDate(M.date, true)) + '</div></div>';
  const buyer = '<div><small>Sold to</small><b>' + esc(M.buyer.name) + '</b>' + (M.buyer.store_no ? ' · Store #' + esc(M.buyer.store_no) : '') +
    M.buyer.lines.map((x) => '<div>' + esc(x) + '</div>').join('') + (M.buyer.ship_to ? '<div>Ships to: ' + esc(M.buyer.ship_to) + '</div>' : '') + '</div>';
  const lic = '<div><small>Store licenses on file</small>' + (M.buyer.lic.length ? M.buyer.lic.map((l) => '<div>' + esc(l.name) + ' ' + esc(l.number) + (l.expires ? ' · ends ' + esc(shortDate(l.expires, true)) : '') + '</div>').join('') : '<div>None on file</div>') + '</div>';
  const terms = '<div><small>Terms</small><b>' + esc(M.terms) + '</b><div>Charged to account</div><small style="margin-top:4px">Sold by</small>' + esc(M.soldBy || '—') + '</div>';
  const ph = M.show.photos && M.lines.some((l) => l.photo_url), bc = M.show.barcodes;
  const th = '<tr>' + (ph ? '<th style="width:30px"></th>' : '') + '<th>Item</th><th>Item #</th><th>UPC</th><th>Size</th><th class="iv-n">Ordered</th><th class="iv-n">Shipped</th><th class="iv-n">Price</th><th class="iv-n">Amount</th></tr>';
  const cols = 8 + (ph ? 1 : 0);
  const row = (l) => '<tr>' + (ph ? '<td>' + (l.photo_url ? '<img class="iv-ph" src="' + esc(l.photo_url) + '" alt="">' : '') + '</td>' : '') +
    '<td><b>' + esc(l.name) + '</b></td><td>' + esc(l.item_no || '') + '</td><td>' + (bc ? barcodeSvg(l.upc) : '') + '<span class="iv-up">' + esc(l.upc || '') + '</span></td>' +
    '<td>' + esc(sizeText(l)) + '</td><td class="iv-n">' + l.ordered + '</td><td class="iv-n">' + l.shipped + (l.short ? '<br><span class="iv-short">' + l.short + ' short</span>' : '') + '</td>' +
    '<td class="iv-n">' + (+l.off > 0 ? '<span class="iv-was">' + $(l.price) + '</span>' : '') + $(l.unit_price) + '</td><td class="iv-n"><b>' + $(l.total) + '</b></td></tr>';
  const body = M.groups.map((g) => '<tr class="iv-cat"><td colspan="' + cols + '">' + esc(g.name) + '</td></tr>' + g.lines.map(row).join('') +
    '<tr class="iv-sub"><td colspan="' + (cols - 3) + '">' + esc(g.name) + ' subtotal</td><td class="iv-n">' + g.units + '</td><td></td><td class="iv-n">' + $(g.sub) + '</td></tr>').join('');
  const owes = M.owes ? '<table>' + (M.owes.before != null ? '<tr><td>You owed before this invoice</td><td class="iv-n">' + $(M.owes.before) + '</td></tr><tr><td>This invoice</td><td class="iv-n">' + $(M.sums.total) + '</td></tr>' +
    '<tr class="iv-tot"><td>You owe now</td><td class="iv-n">' + $(M.owes.now) + '</td></tr>' : '<tr class="iv-tot"><td>You owe' + (M.owes.asOf ? ' as of ' + esc(shortDate(M.owes.asOf, true)) : '') + '</td><td class="iv-n">' + $(M.owes.now) + '</td></tr>') + '</table>' : '<div></div>';
  const sums = '<table><tr><td>Cigarettes</td><td class="iv-n">' + $(M.sums.cig) + '</td></tr><tr><td>All other</td><td class="iv-n">' + $(M.sums.other) + '</td></tr>' +
    '<tr><td>Items shipped</td><td class="iv-n">' + M.sums.units + '</td></tr><tr class="iv-tot"><td>Invoice total</td><td class="iv-n">' + $(M.sums.total) + '</td></tr></table>';
  return '<section class="inv">' + head + '<div class="iv-pp">' + buyer + lic + terms + '</div><table><thead>' + th + '</thead><tbody>' + body + '</tbody></table>' +
    '<div class="iv-sums">' + owes + sums + '</div>' + (M.tax ? '<div class="iv-tax">' + esc(M.tax) + '</div>' : '') +
    (M.footer ? '<div class="iv-ft">' + esc(M.footer) + '</div>' : '') +
    (M.sign ? '<div class="iv-sig"><span>Received by (print name)</span><span>Signature</span><span>Date</span></div>' : '') + '</section>';
}

// ---------- the same invoice as a PDF (for email) ----------
export function invoicePdf(M) {
  const d = pdfDoc(612, 792), L = 36, R = 576, NAV = '#0F1B2D', MUT = '#5B6676';
  const cols = [[L + 4, 'Item', 'left'], [272, 'Item #', 'left'], [322, 'UPC', 'left'], [400, 'Size', 'left'], [470, 'Ord', 'right'], [500, 'Ship', 'right'], [538, 'Price', 'right'], [R - 4, 'Amount', 'right']];
  let y = 0, pages = [];
  const header = () => {
    d.page(); pages.push(d); y = 44;
    d.text(L, y, M.seller.name, { size: 15, bold: true });
    d.text(R, y, 'INVOICE #' + M.num, { size: 14, bold: true, align: 'right' });
    y += 14; let yy = y;
    M.seller.lines.concat([[M.seller.phone, M.seller.email].filter(Boolean).join(' · ')]).filter(Boolean).forEach((t) => { d.text(L, yy, t, { size: 9 }); yy += 11; });
    M.seller.lic.concat(M.seller.msa ? ['MSA ID ' + M.seller.msa] : []).forEach((t) => { d.text(L, yy, t, { size: 8, color: MUT }); yy += 10; });
    d.text(R, y, shortDate(M.date, true), { size: 10, align: 'right' });
    y = Math.max(yy, y + 12) + 4; d.line(L, y, R, y, NAV, 1.5); y += 14;
  };
  const tableHead = () => { d.rect(L, y - 9, R - L, 13, NAV); cols.forEach(([x, t, a]) => d.text(x, y, t, { size: 8, bold: true, color: '#FFFFFF', align: a })); y += 14; };
  const room = (h) => { if (y + h > 740) { header(); tableHead(); } };
  header();
  const boxW = (R - L - 20) / 3, bx = [L, L + boxW + 10, L + 2 * (boxW + 10)];
  const box = (i, title, rows) => { let yy = y; d.text(bx[i], yy, title.toUpperCase(), { size: 7, color: MUT, bold: true }); yy += 11;
    rows.forEach((t, k) => { d.text(bx[i], yy, fit(t, 9, boxW, k === 0), { size: 9, bold: k === 0 }); yy += 11; }); return yy; };
  const b1 = box(0, 'Sold to', [M.buyer.name + (M.buyer.store_no ? ' · Store #' + M.buyer.store_no : '')].concat(M.buyer.lines, M.buyer.ship_to ? ['Ships to: ' + M.buyer.ship_to] : []));
  const b2 = box(1, 'Store licenses on file', M.buyer.lic.length ? M.buyer.lic.map((l) => l.name + ' ' + l.number) : ['None on file']);
  const b3 = box(2, 'Terms', [M.terms, 'Charged to account', 'Sold by ' + (M.soldBy || '—')]);
  y = Math.max(b1, b2, b3) + 8; tableHead();
  M.groups.forEach((g) => {
    room(30); d.rect(L, y - 9, R - L, 13, '#EEF2F7'); d.text(L + 4, y, g.name, { size: 8.5, bold: true }); y += 14;
    g.lines.forEach((l) => {
      room(16 + (+l.off > 0 || l.short ? 9 : 0));
      d.text(cols[0][0], y, fit(l.name, 8.5, 222, true), { size: 8.5, bold: true });
      d.text(cols[1][0], y, fit(l.item_no || '', 8, 46), { size: 8 });
      d.text(cols[2][0], y, l.upc || '', { size: 8 });
      d.text(cols[3][0], y, fit(sizeText(l), 8, 66), { size: 8 });
      d.text(cols[4][0], y, String(l.ordered), { size: 8.5, align: 'right' });
      d.text(cols[5][0], y, String(l.shipped), { size: 8.5, align: 'right' });
      d.text(cols[6][0], y, $(l.unit_price), { size: 8.5, align: 'right' });
      d.text(cols[7][0], y, $(l.total), { size: 8.5, bold: true, align: 'right' });
      let extra = 0;
      if (+l.off > 0) { d.text(cols[6][0], y + 9, 'was ' + $(l.price), { size: 7, color: MUT, align: 'right' }); extra = 9; }
      if (l.short) { d.text(cols[5][0], y + 9, l.short + ' short', { size: 7, color: '#B4570A', align: 'right' }); extra = 9; }
      y += 4 + extra; d.line(L, y, R, y); y += 10;
    });
    room(16); d.text(L + 4, y, g.name + ' subtotal', { size: 8.5, bold: true }); d.text(cols[5][0], y, String(g.units), { size: 8.5, bold: true, align: 'right' });
    d.text(cols[7][0], y, $(g.sub), { size: 8.5, bold: true, align: 'right' }); y += 16;
  });
  room(90); y += 4;
  const sumRows = [['Cigarettes', $(M.sums.cig)], ['All other', $(M.sums.other)], ['Items shipped', String(M.sums.units)]];
  let ys = y; sumRows.forEach(([a, b]) => { d.text(400, ys, a, { size: 9 }); d.text(R - 4, ys, b, { size: 9, align: 'right' }); ys += 12; });
  d.line(400, ys - 8, R, ys - 8, NAV, 1.5); ys += 4; d.text(400, ys, 'Invoice total', { size: 12, bold: true }); d.text(R - 4, ys, $(M.sums.total), { size: 12, bold: true, align: 'right' });
  let yo = y;
  if (M.owes) {
    const rows = M.owes.before != null ? [['You owed before this invoice', $(M.owes.before)], ['This invoice', $(M.sums.total)], ['You owe now', $(M.owes.now)]]
      : [['You owe' + (M.owes.asOf ? ' as of ' + shortDate(M.owes.asOf, true) : ''), $(M.owes.now)]];
    rows.forEach(([a, b], i) => { const last = i === rows.length - 1; d.text(L, yo, a, { size: last ? 11 : 9, bold: last }); d.text(300, yo, b, { size: last ? 11 : 9, bold: last, align: 'right' }); yo += last ? 14 : 12; });
  }
  y = Math.max(ys, yo) + 18;
  if (M.tax) { room(14); d.text(L, y, M.tax, { size: 9.5, bold: true }); y += 14; }
  if (M.footer) M.footer.split(/\n+/).forEach((t) => { room(12); d.text(L, y, fit(t, 8.5, R - L), { size: 8.5, color: MUT }); y += 11; });
  if (M.sign) { room(36); y += 24; [[L, 'Received by (print name)'], [L + 190, 'Signature'], [L + 380, 'Date']].forEach(([x, t]) => { d.line(x, y, x + 170, y, NAV); d.text(x, y + 10, t, { size: 8 }); }); }
  return { bytes: d.bytes(), pages: d.count };
}
export const pdfName = (M) => 'Invoice-' + M.num + '-' + String(M.buyer.name || 'Store').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') + '.pdf';

// ---------- EDI file (the fixed-width layout above) ----------
// 11 digits for the B line: a UPC-A without its check digit. '' when the barcode can't be written that way.
export function upc11(u) { const d = upc12(u); return d ? d.slice(0, 11) : ''; }
export const ediAcct = (c) => {
  const a = cleanUpc((c && c.acct_no) || ''); if (a) return a;
  const s = String((c && c.store_no) || '').trim(); return /^\d+$/.test(s) ? s : '';
};
// A stable 7-digit item # when the wholesaler's own isn't 1–7 digits (never starts with 99 = the charge lines).
export function ediItemNo(l) {
  const own = String(l.item_no || '').trim();
  if (/^\d{1,7}$/.test(own) && !/^99\d{5}$/.test(own.padStart(7, '0'))) return own.padStart(7, '0');
  let h = 0; const s = String(l.item_id || l.size_id || l.name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return String(1 + (h % 8)) + String(h % 1000000).padStart(6, '0');
}
// Units in a case for the single pack: a carton of 10 packs = 10; a single = 1.
const packsIn = (l) => Math.max(1, Math.round(+l.n || 1));
const cents = (v) => Math.round(Math.abs(+v || 0) * 100);
const pad = (s, n) => String(s).padStart(n, '0');
const fix = (s, n) => String(s || '').toUpperCase().replace(/[^\x20-\x7E]/g, ' ').slice(0, n).padEnd(n, ' ');
const mmddyy = (iso) => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(iso || ''); return m ? m[2] + m[3] + m[1].slice(2) : '000000'; };

// What would stop the file being read right, in plain words. [] = it can go.
export function ediProblems(sale, cust) {
  const out = [], acct = ediAcct(cust);
  if (!acct) out.push({ k: 'acct', t: 'Type this store’s customer # (numbers only) on the customer’s Details.' });
  else if (acct.length > 6) out.push({ k: 'acct', t: 'The customer # can be at most 6 digits for the EDI file.' });
  if (String(sale.number || '').length > 10) out.push({ k: 'num', t: 'The invoice # is longer than 10 digits.' });
  const nob = (sale.lines || []).filter((l) => +l.shipped > 0 && !upc11(l.single_upc || (+l.n === 1 ? l.upc : '')));
  if (nob.length) out.push({ k: 'pack', t: nob.length + ' line' + (nob.length > 1 ? 's have' : ' has') + ' no single-pack barcode: ' + nob.slice(0, 3).map((l) => l.name).join(', ') + (nob.length > 3 ? '…' : '') + '. The store will match ' + (nob.length > 1 ? 'them' : 'it') + ' by hand.', soft: true, names: nob.map((l) => l.name) });
  const big = (sale.lines || []).find((l) => cents(l.unit_price) > 999999 || Math.abs(+l.shipped) > 9999);
  if (big) out.push({ k: 'big', t: big.name + ': the price or quantity is too big for the EDI file.' });
  return out;
}
export const ediBlocked = (sale, cust) => ediProblems(sale, cust).some((p) => !p.soft);

export function ediFile(sale, cust) {
  const acct = pad(ediAcct(cust).slice(0, 6), 6), lines = (sale.lines || []).filter((l) => +l.shipped !== 0);
  let tot = 0;
  const B = lines.map((l) => {
    const n = packsIn(l), u = upc11(l.single_upc || (n === 1 ? l.upc : ''));
    const amt = Math.round((+l.unit_price || 0) * (+l.shipped || 0) * 100); tot += amt;
    const q = +l.shipped || 0;
    return 'B' + (u || ' '.repeat(11)) + fix(l.name, 24) + ediItemNo(l) + pad(cents(l.unit_price), 6) + '01' + pad(n, 6) +
      (q < 0 ? '-' : '+') + pad(Math.abs(q), 4) + '00000' + '001';
  });
  const A = 'A' + acct + pad(String(sale.number || 0).slice(-10), 10) + mmddyy(sale.invoice_date) + (tot < 0 ? '-' : '+') + pad(Math.abs(tot), 9) + acct;
  return [A].concat(B).join('\r\n') + '\r\n';
}
export const ediName = (sale, cust) => 'LOC ' + pad(ediAcct(cust).slice(0, 6) || '0', 6) + ' ' + mmddyy(sale.invoice_date) + ' ' + sale.number + '.txt';
export const ediSubject = (co, cust, sale) => (co.name || 'Invoices') + ' Invoices ' + (ediAcct(cust) || '') + ' · Invoice #' + sale.number;

// A spreadsheet of the same lines (to download), with the pack barcode, packs in a case and the cost of one pack.
export function ediCsv(sale) {
  const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const rows = [['Invoice #', 'Date', 'Item #', 'Pack barcode', 'Item', 'Size', 'Packs in a case', 'Cases shipped', 'Case cost', 'Pack cost', 'Line total']];
  (sale.lines || []).filter((l) => +l.shipped !== 0).forEach((l) => {
    const n = packsIn(l);
    rows.push([sale.number, sale.invoice_date, l.item_no || '', upc12(l.single_upc || (n === 1 ? l.upc : '')) || '', l.name, sizeText(l), n, l.shipped,
      (+l.unit_price).toFixed(2), (Math.round((+l.unit_price / n) * 10000) / 10000).toFixed(4), (+l.total).toFixed(2)]);
  });
  return rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}

// The email for the invoice PDF / the EDI file (plain words, reply goes to the wholesaler).
export function invEmailText(kind, M, co) {
  if (kind === 'edi') return { subject: '', text: 'Invoice #' + M.num + ' from ' + co.name + ' as an EDI file for your back office.\n\n' + 'Total: ' + $(M.sums.total) + '\n\nQuestions? Reply to this email.' };
  return { subject: co.name + ' · Invoice #' + M.num + ' · ' + $(M.sums.total),
    text: 'Hello ' + M.buyer.name + ',\n\nYour invoice #' + M.num + ' from ' + co.name + ' is attached.\n\nInvoice total: ' + $(M.sums.total) +
      (M.owes ? '\nYou owe now: ' + $(M.owes.now) : '') + '\nTerms: ' + M.terms + ' · charged to account\n\nQuestions? Reply to this email.\n\n' + co.name +
      (co.phone ? '\n' + co.phone : '') };
}
