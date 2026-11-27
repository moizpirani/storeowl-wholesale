// Phase 1 rules in one place (pure: no screens, no database). Used by the screens, the pretend backend and tests.

export const CATEGORIES = [
  ['cigarettes', 'Cigarettes'], ['cigars', 'Cigars'], ['otp', 'Other tobacco'], ['snuff', 'Moist snuff'],
  ['vapor', 'Vapor'], ['pouches', 'Nicotine pouches'], ['hemp', 'Hemp / cannabinoid'], ['beer', 'Beer'], ['other', 'Grocery and other']
];
export const catName = (k) => (CATEGORIES.find((c) => c[0] === k) || [k, 'Grocery and other'])[1];
export const SIZE_NAMES = ['Pack', 'Carton', 'Case', 'Box', 'Can', 'Roll', 'Each', 'Bottle', 'Bag', 'Tin', 'Sleeve', 'Pouch', 'Display'];

export const TERMS = [['cod', 'Cash or check on delivery'], ['advance', 'Pay in advance'], ['net7', 'Net 7'], ['net10', 'Net 10'], ['net14', 'Net 14'], ['net30', 'Net 30']];
export const termName = (k) => (TERMS.find((t) => t[0] === k) || ['', '—'])[1];

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
  if (it.cost_hidden !== true && sizes.some((z) => z.cost == null)) out.push({ k: 'cost', t: 'No cost' });
  if (sizes.some((z) => (levels || []).some((l) => z.prices == null || z.prices[l.n] == null))) out.push({ k: 'price', t: 'Price missing' });
  if (sizes.some((z) => z.cost != null && (levels || []).some((l) => z.prices && z.prices[l.n] != null && z.prices[l.n] < z.cost))) out.push({ k: 'below', t: 'Price below cost' });
  return out;
}

// The size an item is listed by: the one people buy most often is usually the carton/box, so the first size.
export function mainSize(it) { return (it.sizes || [])[0] || null; }
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
    const u = cleanUpc(z.upc);
    if (u && (u.length < 6 || u.length > 14)) return 'The UPC on ' + z.name + ' should be 6 to 14 digits.';
    if (u && seen[u]) return 'Two sizes have the same UPC.';
    if (u) seen[u] = 1;
    if (z.cost != null && (isNaN(z.cost) || z.cost < 0)) return 'The cost on ' + z.name + ' isn’t a number.';
    for (const k of Object.keys(z.prices || {})) {
      const v = z.prices[k];
      if (v != null && (isNaN(v) || v < 0)) return 'A price on ' + z.name + ' isn’t a number.';
    }
    const bk = breaksCheck(z); if (bk) return bk;
  }
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
      sizes: (it.sizes || []).map((y) => ({ id: y.id, name: y.name })), ordered: +l.ordered || 0, shipped: sh, price, off, unit_price: unit, total: tot,
      group_qty: q, group: (it.break_group || '').trim(), missing: price == null ? 'price' : '' };
  });
  return { lines: out, total: Math.round(total * 100) / 100, count };
}
// Plain-words problem with a sale before it's saved, or ''.
export function saleCheck(sale) {
  if (!sale.lines.length) return 'Scan at least one item.';
  const np = sale.lines.find((l) => l.missing === 'price');
  if (np) return np.name + ' (' + np.size + ') has no price for this customer’s level.';
  if (sale.lines.find((l) => l.missing === 'gone')) return 'An item on this sale isn’t in your list any more. Take it off.';
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
    for (const z of it.sizes || []) if (z.upc && upcSame(c, z.upc)) return { it, z };
  }
  return null;
}
