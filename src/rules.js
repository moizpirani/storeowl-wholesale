// Phase 1 rules in one place (pure: no screens, no database). Used by the screens, the pretend backend and tests.

export const CATEGORIES = [
  ['cigarettes', 'Cigarettes'], ['cigars', 'Cigars'], ['otp', 'Other tobacco'], ['snuff', 'Moist snuff'],
  ['vapor', 'Vapor'], ['pouches', 'Nicotine pouches'], ['hemp', 'Hemp / cannabinoid'], ['beer', 'Beer'], ['other', 'Grocery and other']
];
export const catName = (k) => (CATEGORIES.find((c) => c[0] === k) || [k, 'Grocery and other'])[1];
export const SIZE_NAMES = ['Pack', 'Carton', 'Case', 'Box', 'Can', 'Roll', 'Each', 'Bottle', 'Bag', 'Tin', 'Sleeve', 'Pouch', 'Display'];

export const TERMS = [['cod', 'Cash or check on delivery'], ['advance', 'Pay in advance'], ['net7', 'Net 7'], ['net10', 'Net 10'], ['net14', 'Net 14'], ['net30', 'Net 30']];
export const termName = (k) => (TERMS.find((t) => t[0] === k) || ['', ''])[1];  // '' = no terms

export const LICENSES = [
  ['resale', 'Resale certificate'], ['location', 'State location number'], ['tobacco', 'Tobacco license'],
  ['vapor', 'Vapor license'], ['hemp', 'Hemp license'], ['beer', 'Beer permit']
];
export const licName = (k) => (LICENSES.find((l) => l[0] === k) || [k, k])[1];
export const LIC_KINDS = LICENSES.map((l) => l[0]);

// What each license covers. 'all' = every sale (the state needs it on file for the store).
export const LIC_COVERS = {
  resale: 'all', location: 'all', tobacco: ['cigarettes', 'cigars', 'otp', 'snuff', 'pouches'],
  vapor: ['vapor'], hemp: ['hemp'], beer: ['beer']
};
export const LIC_COVER_TEXT = {
  resale: 'Every sale', location: 'Every sale', tobacco: 'Cigarettes, cigars, other tobacco, snuff, pouches',
  vapor: 'Vapor', hemp: 'Hemp / cannabinoid', beer: 'Beer'
};
// The wholesaler decides which licenses they need in each state. These are only the starting suggestion.
// Tennessee (2026): stores need no state license to sell tobacco or vapor; hemp stores need a state retail license.
const SUGGEST = { TN: ['resale', 'location', 'hemp'] };
export const SUGGEST_NOTE = { TN: 'Tennessee doesn’t license stores to sell tobacco or vapor. Hemp stores need a state license.' };
export function suggestedLic(state) { return (SUGGEST[state] || ['resale', 'tobacco']).slice(); }
// Licenses that only matter when that item is on the invoice: missing ones aren't flagged on the customer page.
const AT_SALE_ONLY = ['hemp', 'beer'];

export const DEFAULT_SETTINGS = { lic_mode: 'warn', lic_need: {}, remind_days: 30, default_level: 1 };
export function settingsOf(company) { return Object.assign({}, DEFAULT_SETTINGS, (company && company.settings) || {}); }

export function cleanUpc(s) { return String(s || '').replace(/\D/g, ''); }
export function upcShow(u) {
  u = cleanUpc(u);
  if (u.length === 12) return u[0] + ' ' + u.slice(1, 6) + ' ' + u.slice(6, 11) + ' ' + u[11];
  if (u.length === 13) return u.slice(0, 2) + ' ' + u.slice(2, 7) + ' ' + u.slice(7, 12) + ' ' + u[12];
  return u;
}
export function num(v) { if (v === '' || v == null) return null; const n = Number(String(v).replace(/[$,\s]/g, '')); return isFinite(n) ? n : NaN; }
// $ in front, minus before the $ (a credit shows −$78.40, never $-78.40).
export function dollars(v) { if (v == null || v === '' || !isFinite(v)) return ''; const n = Number(v); return (n < 0 && Math.abs(n) >= 0.005 ? '-$' : '$') + money(Math.abs(n)); }
export function money(v) { return v == null || v === '' || !isFinite(v) ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
export function margin(cost, price) { return cost == null || !price ? null : Math.round((1 - cost / price) * 1000) / 10; }

// Days from `today` (YYYY-MM-DD) to `iso`. Negative = in the past.
export function daysTo(iso, today) {
  if (!iso) return null;
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((b - a) / 86400000);
}
export function todayIso(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
export function shortDate(iso, year) {
  if (!iso) return '';
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  return d.toLocaleDateString('en-US', Object.assign({ month: 'short', day: 'numeric', timeZone: 'UTC' }, year ? { year: 'numeric' } : {}));
}

// One license's state: none (nothing on file) | ok | soon (ends within remind days) | ended.
export function licState(lic, today, remind) {
  if (!lic || !String(lic.number || '').trim()) return 'none';
  const d = daysTo(lic.expires, today);
  if (d == null) return 'ok';
  if (d < 0) return 'ended';
  return d <= remind ? 'soon' : 'ok';
}

// The licenses the wholesaler needs in a state (their own pick, or the suggestion until they pick).
export function licNeeded(settings, state) {
  const n = ((settings || {}).lic_need || {})[state];
  return Array.isArray(n) ? n.filter((k) => LIC_KINDS.includes(k)) : suggestedLic(state);
}
// Which state's rules a customer falls under: their store's state, else the wholesaler's home state.
export const custStateOf = (c, home) => (c && c.state) || home || '';
// The licenses this customer needs. Tobacco and vapor only for customers who buy tobacco.
export function custNeeds(c, settings, home) {
  return licNeeded(settings, custStateOf(c, home)).filter((k) => !(['tobacco', 'vapor'].includes(k) && c.tobacco === false));
}
// Needed licenses that are missing or ended. Nothing here stops a sale: the wholesaler is warned and decides.
export function licProblems(c, settings, today, home, all) {
  const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
  const out = [];
  custNeeds(c, s, home).forEach((k) => {
    const l = (c.licenses || []).find((x) => x.kind === k), st = licState(l, today, s.remind_days);
    if (st === 'ended') out.push({ kind: k, st, expires: l.expires });
    if (st === 'none' && (all || !AT_SALE_ONLY.includes(k))) out.push({ kind: k, st });
  });
  return out;
}
export function problemText(p, year) {
  if (p.st === 'ended') return licName(p.kind) + ' ended ' + shortDate(p.expires, year);
  return p.kind === 'resale' ? 'No resale number' : p.kind === 'location' ? 'No location number' : 'No ' + licName(p.kind).toLowerCase();
}
// The license problems that matter when selling an item of this category (the Counter warns with these).
export function saleWarnings(c, category, settings, today, home) {
  return licProblems(c, settings, today, home, true).filter((p) => { const cv = LIC_COVERS[p.kind]; return cv === 'all' || cv.includes(category); });
}

// What needs the wholesaler's attention on a customer. tone: or = needs a look (nothing stops a sale).
export function custIssues(c, settings, today, home) {
  const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
  const out = licProblems(c, s, today, home).map((p) => ({ k: p.kind, tone: 'or', t: problemText(p) }));
  (c.licenses || []).forEach((l) => {
    if (out.some((x) => x.k === l.kind)) return;
    const st = licState(l, today, s.remind_days);
    if (st === 'ended') out.push({ k: l.kind, tone: 'or', t: licName(l.kind) + ' ended ' + shortDate(l.expires) });
    if (st === 'soon') out.push({ k: l.kind, tone: 'or', t: licName(l.kind) + ' ends ' + shortDate(l.expires) });
  });
  if (c.credit_limit != null && (c.owes || 0) > c.credit_limit) out.push({ k: 'credit', tone: 'or', t: 'Over credit limit' });
  return out;
}

// Check the license list a wholesaler picked before it's saved.
export function licNeedCheck(need, states) {
  for (const st of Object.keys(need || {})) {
    if (!(states || []).includes(st)) return 'You don’t sell in ' + st + '.';
    if (!Array.isArray(need[st]) || need[st].some((k) => !LIC_KINDS.includes(k))) return 'Pick licenses from the list.';
  }
  return '';
}

// What needs a look on an item.
export function itemIssues(it, levels) {
  const out = [];
  const sizes = it.sizes || [];
  if (!sizes.some((z) => cleanUpc(z.upc))) out.push({ k: 'upc', t: 'No UPC' });
  else if (!singleUpc(it)) out.push({ k: 'pack', t: 'No single-pack barcode' });
  const sold = sizes.filter(sells);   // a size kept only for the store's barcode needs no cost or price
  if (it.cost_hidden !== true && sold.some((z) => z.cost == null)) out.push({ k: 'cost', t: 'No cost' });
  if (sold.some((z) => (levels || []).some((l) => z.prices == null || z.prices[l.n] == null))) out.push({ k: 'price', t: 'Price missing' });
  if (sold.some((z) => z.cost != null && (levels || []).some((l) => z.prices && z.prices[l.n] != null && z.prices[l.n] < z.cost))) out.push({ k: 'below', t: 'Price below cost' });
  return out;
}

// "You sell it" (Phase 4): a size with sells = false (usually the single pack) is only there for the store's barcode
// on the EDI file. It's never sold, received or offered as a size; scanning its barcode means the main size you sell.
export const sells = (z) => !!z && z.sells !== false;
export function sellSizes(it) { return ((it && it.sizes) || []).filter(sells); }
// Every barcode a size answers to: its main UPC and any extra ones (packaging changes).
export function sizeUpcs(z) { return [z && z.upc].concat((z && z.upcs) || []).map(cleanUpc).filter(Boolean); }
// The size an item is listed by: the one people buy most often is usually the carton/box, so the first size you sell.
export function mainSize(it) { return sellSizes(it)[0] || (it.sizes || [])[0] || null; }
// The single pack / can / each: the size with 1 unit in it. Its barcode is the one the store's register scans,
// so it's the barcode sent in the EDI file (the store's back office matches on it).
export function singleSize(it) { return (it.sizes || []).find((z) => +z.n === 1) || null; }
export function singleUpc(it) { const z = singleSize(it); return z && cleanUpc(z.upc) ? cleanUpc(z.upc) : ''; }
export function sizeLine(z, unit) {
  if (!z) return '';
  const u = unit || 'each';
  return z.name + (z.n > 1 ? ' · ' + z.n + ' ' + plural(u, z.n) : '');
}
export function plural(w, n) { w = String(w || ''); if (n === 1 || !w) return w; return /(s|x|ch|sh)$/i.test(w) ? w + 'es' : w + 's'; }

// Check an item before it is saved. Returns a plain-words problem or ''.
export function itemCheck(p) {
  if (!String(p.name || '').trim()) return 'Type the item name.';
  const sizes = p.sizes || [];
  if (!sizes.length) return 'Add at least one size.';
  const seen = {};
  for (const z of sizes) {
    if (!String(z.name || '').trim()) return 'Every size needs a name, like Carton or Box.';
    if (!(Number.isInteger(+z.n) && +z.n >= 1)) return 'How many in a ' + (z.name || 'size') + '? Type a whole number, 1 or more.';
    for (const u of sizeUpcs(z)) {
      if (u.length < 6 || u.length > 14) return 'The barcode ' + u + ' on ' + z.name + ' should be 6 to 14 digits.';
      if (seen[u]) return 'Barcode ' + u + ' is typed twice on this item.';
      seen[u] = 1;
    }
    if (z.cost != null && (isNaN(z.cost) || z.cost < 0)) return 'The cost on ' + z.name + ' isn’t a number.';
    for (const k of Object.keys(z.prices || {})) {
      const v = z.prices[k];
      if (v != null && (isNaN(v) || v < 0)) return 'A price on ' + z.name + ' isn’t a number.';
    }
    const bk = breaksCheck(z); if (bk) return bk;
  }
  if (!sizes.some(sells)) return 'At least one size has to be one you sell.';
  return '';
}

export function custCheck(p) {
  if (!String(p.name || '').trim()) return 'Type the customer’s name.';
  if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) return 'The email doesn’t look right.';
  if (p.credit_limit != null && (isNaN(p.credit_limit) || p.credit_limit < 0)) return 'The credit limit isn’t a number.';
  return '';
}

export function levelsCheck(list) {
  if (!list.length) return 'Keep at least one price level.';
  if (list.length > 6) return 'Up to 6 price levels.';
  const seen = {};
  for (const l of list) {
    const n = String(l.name || '').trim();
    if (!n) return 'Every price level needs a name.';
    if (n.length > 20) return 'Keep level names short (20 letters or less).';
    if (seen[n.toLowerCase()]) return 'Two price levels have the same name.';
    seen[n.toLowerCase()] = 1;
  }
  return '';
}

export function initials(name) {
  const w = String(name || '').replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  return ((w[0] || '?')[0] + (w[1] ? w[1][0] : '')).toUpperCase();
}

// Same UPC written another way: leading zeros dropped, or the last (check) digit left off (old systems print 10–11 digits).
export function upcSame(a, b) {
  a = cleanUpc(a); b = cleanUpc(b);
  if (!a || !b) return false;
  const z = (s) => s.replace(/^0+/, '');
  if (z(a) === z(b)) return true;
  if (b.length >= 12 && z(b.slice(0, -1)) === z(a)) return true;
  if (a.length >= 12 && z(a.slice(0, -1)) === z(b)) return true;
  return false;
}
// Which item a photo file is for, from its name: the UPC of any size, or the item #. null = the person picks.
export function photoMatch(fileName, items) {
  const base = String(fileName || '').replace(/\.[a-z0-9]+$/i, '').trim();
  const digits = base.replace(/[\s-]/g, '');
  if (/^\d{6,14}$/.test(digits)) {
    const it = (items || []).find((i) => (i.sizes || []).some((s) => upcSame(digits, s.upc)));
    if (it) return { id: it.id, how: 'upc' };
  }
  const it2 = base && (items || []).find((i) => i.item_no && i.item_no.trim().toLowerCase() === base.toLowerCase());
  return it2 ? { id: it2.id, how: 'item' } : null;
}

// ---------- Quantity breaks: buys at least `min` of a size → `off` dollars off each, at every price level ----------
export function breakOff(breaks, qty) {
  let off = 0;
  (breaks || []).forEach((b) => { if (qty >= b.min && b.off > off) off = b.off; });
  return off;
}
export function breakPrice(price, breaks, qty) { return price == null ? null : Math.round((price - breakOff(breaks, qty)) * 100) / 100; }
// "5+ $33.90 · 10+ $33.60" for one price.
export function breakLine(price, breaks) {
  if (price == null || !(breaks || []).length) return '';
  return breaks.slice().sort((a, b) => a.min - b.min).map((b) => b.min + '+ $' + money(price - b.off)).join(' · ');
}
// Plain-words problem with one size's breaks, or ''. prices = that size's prices by level.
export function breaksCheck(z) {
  const bs = z.breaks || [], seen = {};
  if (bs.length > 10) return 'Up to 10 breaks on a ' + z.name + '.';
  let last = 0;
  for (const b of bs.slice().sort((a, c) => (+a.min) - (+c.min))) {
    if (!(Number.isInteger(+b.min) && +b.min >= 2) || b.min === '') return 'A break on ' + z.name + ' needs “buys at least” as a whole number, 2 or more.';
    if (b.off == null || isNaN(b.off) || b.off <= 0) return 'A break on ' + z.name + ' needs an amount off.';
    if (seen[+b.min]) return 'Two breaks on ' + z.name + ' start at ' + b.min + '.';
    if (b.off < last) return 'On ' + z.name + ', buying more should take off at least as much.';
    for (const k of Object.keys(z.prices || {})) { const p = z.prices[k]; if (p != null && !isNaN(p) && p - b.off <= 0) return 'The break on ' + z.name + ' takes off more than the price.'; }
    seen[+b.min] = 1; last = b.off;
  }
  return '';
}

// ---------- Sales (Counter) ----------
// Prices a sale the same way the database does. lines = [{size_id, ordered, shipped}], level = the customer's price level.
// Quantity breaks count every line of the same size, and of items in the same "count together" group (by size name).
export function priceSale(lines, items, level) {
  const ix = {};
  (items || []).forEach((it) => (it.sizes || []).forEach((z) => { ix[z.id] = { it, z }; }));
  const key = (it, z) => ((it.break_group || '').trim() ? 'g:' + it.break_group.trim().toLowerCase() + '|' + z.name.trim().toLowerCase() : 's:' + z.id);
  const gq = {};
  (lines || []).forEach((l) => { const f = ix[l.size_id]; if (f) { const k = key(f.it, f.z); gq[k] = (gq[k] || 0) + (+l.shipped || 0); } });
  let total = 0, count = 0;
  const out = (lines || []).map((l) => {
    const f = ix[l.size_id];
    if (!f) return Object.assign({}, l, { missing: 'gone' });
    const { it, z } = f, k = key(it, z), q = gq[k] || 0;
    const price = z.prices && z.prices[level] != null ? +z.prices[level] : null;
    const off = breakOff(z.breaks, q);
    const unit = price == null ? null : Math.round((price - off) * 100) / 100;
    const sh = +l.shipped || 0, tot = unit == null ? null : Math.round(unit * sh * 100) / 100;
    if (tot != null) total += tot;
    count += sh;
    return { size_id: z.id, item_id: it.id, name: it.name, size: z.name, n: z.n, unit_name: it.unit, upc: z.upc, category: it.category, photo_url: it.photo_url || '',
      item_no: it.item_no || '', single_upc: singleUpc(it),
      sizes: sellSizes(it).map((y) => ({ id: y.id, name: y.name })), ordered: +l.ordered || 0, shipped: sh, price, off, unit_price: unit, total: tot,
      group_qty: q, group: (it.break_group || '').trim(), missing: !sells(z) ? 'notsold' : price == null ? 'price' : '' };
  });
  return { lines: out, total: Math.round(total * 100) / 100, count };
}
// Plain-words problem with a sale before it's saved, or ''.
export function saleCheck(sale) {
  if (!sale.lines.length) return 'Scan at least one item.';
  const np = sale.lines.find((l) => l.missing === 'price');
  if (np) return np.name + ' (' + np.size + ') has no price for this customer’s level.';
  if (sale.lines.find((l) => l.missing === 'gone')) return 'An item on this sale isn’t in your list any more. Take it off.';
  const ns = sale.lines.find((l) => l.missing === 'notsold');
  if (ns) return ns.name + ' (' + ns.size + ') isn’t a size you sell. Take it off.';
  const bad = sale.lines.find((l) => !(Number.isInteger(l.ordered) && l.ordered >= 0 && Number.isInteger(l.shipped) && l.shipped >= 0));
  if (bad) return 'Quantities are whole numbers.';
  if (!sale.lines.some((l) => l.shipped > 0)) return 'Nothing is shipped on this sale.';
  return '';
}
// Find the size a barcode belongs to (any way the UPC is written).
export function findUpc(items, code) {
  const c = cleanUpc(code);
  if (c.length < 6) return null;
  for (const it of items || []) {
    if (it.active === false) continue;
    for (const z of it.sizes || []) if (sizeUpcs(z).some((u) => upcSame(c, u))) return { it, z };
  }
  return null;
}
// What a scanned barcode means for selling or receiving: a size you don't sell (the pack kept for the store's barcode)
// turns into the item's main size you sell, with pack = true so the screen can say so.
export function scanSize(items, code) {
  const f = findUpc(items, code);
  if (!f) return null;
  if (sells(f.z)) return { it: f.it, z: f.z, pack: false };
  const m = sellSizes(f.it)[0];
  return m ? { it: f.it, z: m, pack: true, scanned: f.z } : null;
}

// ---------- Returns and credits (Phase 2, piece 4) ----------
export const CREDIT_WHY = [['damaged', 'Damaged'], ['expired', 'Expired'], ['wrong', 'Wrong item'], ['notordered', 'Didn’t order'], ['other', 'Other']];
export const creditWhy = (k) => (CREDIT_WHY.find((x) => x[0] === k) || [k, k || ''])[1];
// A credit memo's lines: [{size_id, qty, reason}] for items coming back, or [{other: true, desc, amount, reason}] for money only.
// Each item is credited at what this store last paid for that size (paid = {size_id: price}), else their price level today.
// Credit lines are kept as minus quantities and minus amounts, the way a store's back office reads a credit.
export function priceCredit(lines, items, level, paid) {
  const ix = {};
  (items || []).forEach((it) => (it.sizes || []).forEach((z) => { ix[z.id] = { it, z }; }));
  let total = 0, count = 0;
  const out = (lines || []).map((l) => {
    const why = l.reason || '';
    if (l.other) {
      const a = num(l.amount), amt = a == null || isNaN(a) ? null : Math.round(a * 100) / 100;
      if (amt != null) total -= amt;
      return { other: true, size_id: null, item_id: null, name: String(l.desc || '').trim(), desc: l.desc || '', size: '', n: 1, unit_name: '', upc: '', category: 'credit', item_no: '', single_upc: '',
        sizes: [], ordered: -1, shipped: -1, qty: 1, price: amt, off: 0, unit_price: amt, total: amt == null ? null : -amt, reason: why, from: 'other',
        missing: !String(l.desc || '').trim() ? 'desc' : amt == null || amt <= 0 ? 'amount' : '' };
    }
    const f = ix[l.size_id];
    const qty = Math.trunc(+l.qty || 0);
    if (!f) return Object.assign({}, l, { qty, missing: 'gone' });
    const { it, z } = f;
    const last = paid && paid[z.id] != null ? +paid[z.id] : null;
    const price = last != null ? last : z.prices && z.prices[level] != null ? +z.prices[level] : null;
    const tot = price == null ? null : Math.round(price * qty * 100) / 100;
    if (tot != null) total -= tot;
    count += qty;
    return { size_id: z.id, item_id: it.id, name: it.name, size: z.name, n: z.n, unit_name: it.unit, upc: z.upc, category: it.category, photo_url: it.photo_url || '',
      item_no: it.item_no || '', single_upc: singleUpc(it), sizes: sellSizes(it).map((y) => ({ id: y.id, name: y.name })),
      ordered: -qty, shipped: -qty, qty, price, off: 0, unit_price: price, total: tot == null ? null : -tot, reason: why, from: last != null ? 'paid' : 'level',
      missing: price == null ? 'price' : '' };
  });
  return { lines: out, total: Math.round(total * 100) / 100, count };
}
// Plain-words problem with a credit memo before it's saved, or ''.
export function creditCheck(cr) {
  if (!cr.lines.length) return 'Scan what’s coming back, or add a credit without an item.';
  if (cr.lines.find((l) => l.missing === 'gone')) return 'An item on this credit isn’t in your list any more. Take it off.';
  const np = cr.lines.find((l) => l.missing === 'price'); if (np) return np.name + ' (' + np.size + ') has no price to credit.';
  if (cr.lines.find((l) => l.missing === 'desc')) return 'Say what the credit without an item is for.';
  if (cr.lines.find((l) => l.missing === 'amount')) return 'Type the amount of the credit without an item.';
  if (cr.lines.find((l) => !l.other && !(Number.isInteger(l.qty) && l.qty >= 1))) return 'How many came back? Whole numbers, 1 or more.';
  const nr = cr.lines.find((l) => !l.reason); if (nr) return 'Pick why ' + (nr.other ? 'the credit is given' : nr.name + ' came back') + '.';
  return '';
}

// ---------- Phase 3: payments, open invoices, store credit, aging (same rules as _open_items in the database) ----------
export const PAY_METHODS = [['cash', 'Cash'], ['check', 'Check'], ['card', 'Card'], ['ach', 'Bank transfer'], ['other', 'Other']];
export const payMethod = (k) => (PAY_METHODS.find((m) => m[0] === k) || ['', '—'])[1];
export const dueDays = (t) => ({ net7: 7, net10: 10, net14: 14, net30: 30 }[t] || 0);
const r2 = (v) => Math.round(v * 100) / 100;
const dayN = (iso) => Math.floor(new Date(String(iso).slice(0, 10) + 'T12:00:00Z').getTime() / 864e5);
export const addDays = (iso, n) => new Date((dayN(iso) + n) * 864e5).toISOString().slice(0, 10);
// cust {id, opening, terms, created_at}; sales / pays / applies for that customer.
export function openItems(cust, sales, pays, applies, today) {
  const posted = (id) => sales.find((s) => s.id === id && s.status === 'posted');
  const payOk = (id) => pays.find((p) => p.id === id && p.status === 'posted');
  const live = applies.filter((a) => (!a.from_pay || payOk(a.from_pay)) && (!a.from_sale || posted(a.from_sale)) && (!a.to_sale || posted(a.to_sale)));
  const sum = (l) => r2(l.reduce((a, x) => a + Number(x.amount), 0));
  const t = dayN(today), d = dueDays(cust.terms);
  const op = r2((cust.opening || 0) - sum(live.filter((a) => !a.to_sale)));
  const opd = String(cust.created_at || today).slice(0, 10);
  const invoices = [];
  if (op > 0.004) invoices.push({ id: null, number: null, opening: true, date: opd, due: opd, total: cust.opening, paid: r2(cust.opening - op), open: op, late: Math.max(0, t - dayN(opd)) });
  sales.filter((s) => s.status === 'posted' && (s.kind || 'invoice') === 'invoice').sort((a, b) => (a.invoice_date === b.invoice_date ? a.number - b.number : a.invoice_date < b.invoice_date ? -1 : 1)).forEach((s) => {
    const paid = sum(live.filter((a) => a.to_sale === s.id)), open = r2(s.total - paid), due = addDays(s.invoice_date, d);
    if (open > 0.004) invoices.push({ id: s.id, number: s.number, date: s.invoice_date, due, total: s.total, paid, open, late: Math.max(0, t - dayN(due)) });
  });
  const credits = [];
  if (op < -0.004) credits.push({ kind: 'opening', id: null, number: null, date: opd, left: -op });
  sales.filter((s) => s.status === 'posted' && s.kind === 'credit').forEach((s) => { const left = r2(-s.total - sum(live.filter((a) => a.from_sale === s.id))); if (left > 0.004) credits.push({ kind: 'credit', id: s.id, number: s.number, date: s.invoice_date, left }); });
  pays.filter((p) => p.status === 'posted').forEach((p) => { const left = r2(p.amount - sum(live.filter((a) => a.from_pay === p.id))); if (left > 0.004) credits.push({ kind: 'payment', id: p.id, number: p.number, date: p.received, left }); });
  const ag = { current: 0, d30: 0, d60: 0, d90: 0, over: 0 };
  invoices.forEach((x) => { const k = x.late === 0 ? 'current' : x.late <= 30 ? 'd30' : x.late <= 60 ? 'd60' : x.late <= 90 ? 'd90' : 'over'; ag[k] = r2(ag[k] + x.open); });
  return { invoices, credits, aging: ag, past_due: r2(ag.d30 + ag.d60 + ag.d90 + ag.over), store_credit: r2(credits.reduce((a, x) => a + x.left, 0)),
    held: r2(pays.filter((p) => p.status === 'held').reduce((a, p) => a + p.amount, 0)) };
}
// Fill a payment over the open invoices, oldest first (what the screen suggests; anyone can change it).
export function fillOldest(invoices, amount) {
  let left = r2(Number(amount) || 0);
  return invoices.map((x) => { const take = r2(Math.min(left, x.open)); left = r2(left - take); return take; });
}
