// Phase 1 rules in one place (pure: no screens, no database). Used by the screens, the pretend backend and tests.

export const CATEGORIES = [
  ['cigarettes', 'Cigarettes'], ['cigars', 'Cigars'], ['otp', 'Other tobacco'], ['snuff', 'Moist snuff'],
  ['vapor', 'Vapor'], ['pouches', 'Nicotine pouches'], ['hemp', 'Hemp / cannabinoid'], ['beer', 'Beer'], ['other', 'Grocery and other']
];
// Categories that need the customer's tobacco license.
export const TOBACCO = ['cigarettes', 'cigars', 'otp', 'snuff', 'vapor', 'pouches'];
export const catName = (k) => (CATEGORIES.find((c) => c[0] === k) || [k, 'Grocery and other'])[1];
export const SIZE_NAMES = ['Pack', 'Carton', 'Case', 'Box', 'Can', 'Roll', 'Each', 'Bottle', 'Bag', 'Tin', 'Sleeve', 'Pouch', 'Display'];

export const TERMS = [['cod', 'Cash or check on delivery'], ['advance', 'Pay in advance'], ['net7', 'Net 7'], ['net10', 'Net 10'], ['net14', 'Net 14'], ['net30', 'Net 30']];
export const termName = (k) => (TERMS.find((t) => t[0] === k) || ['', '—'])[1];

export const LICENSES = [
  ['resale', 'Resale certificate'], ['location', 'State location number'], ['tobacco', 'Tobacco license'],
  ['vapor', 'Vapor license'], ['hemp', 'Hemp license'], ['beer', 'Beer permit']
];
export const licName = (k) => (LICENSES.find((l) => l[0] === k) || [k, k])[1];

export const DEFAULT_SETTINGS = { tobacco_stop: true, remind_days: 30, default_level: 1 };
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

// May this customer be sold tobacco today?
export function canTobacco(c, settings, today) {
  const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
  if (!c.tobacco) return false;
  if (!s.tobacco_stop) return true;
  const lic = (c.licenses || []).find((l) => l.kind === 'tobacco');
  const st = licState(lic, today, s.remind_days);
  return st === 'ok' || st === 'soon';
}

// What needs the wholesaler's attention on a customer. tone: red = stops a sale, or = needs a look soon.
export function custIssues(c, settings, today) {
  const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
  const out = [];
  const lic = (k) => (c.licenses || []).find((l) => l.kind === k);
  if (licState(lic('resale'), today, s.remind_days) === 'none') out.push({ k: 'resale', tone: 'red', t: 'No resale number' });
  if (c.tobacco) {
    const t = lic('tobacco'), st = licState(t, today, s.remind_days);
    const stop = s.tobacco_stop ? ' · tobacco stopped' : '';
    if (st === 'none') out.push({ k: 'tobacco', tone: 'red', t: 'No tobacco license' + stop });
    if (st === 'ended') out.push({ k: 'tobacco', tone: 'red', t: 'Tobacco license ended ' + shortDate(t.expires) + stop });
    if (st === 'soon') out.push({ k: 'tobacco', tone: 'or', t: 'Tobacco license ends ' + shortDate(t.expires) });
  }
  (c.licenses || []).filter((l) => !['resale', 'tobacco'].includes(l.kind)).forEach((l) => {
    const st = licState(l, today, s.remind_days);
    if (st === 'ended') out.push({ k: l.kind, tone: 'red', t: licName(l.kind) + ' ended ' + shortDate(l.expires) });
    if (st === 'soon') out.push({ k: l.kind, tone: 'or', t: licName(l.kind) + ' ends ' + shortDate(l.expires) });
  });
  if (c.credit_limit != null && (c.owes || 0) > c.credit_limit) out.push({ k: 'credit', tone: 'red', t: 'Over credit limit' });
  return out;
}

// What needs a look on an item.
export function itemIssues(it, levels) {
  const out = [];
  const sizes = it.sizes || [];
  if (!sizes.some((z) => cleanUpc(z.upc))) out.push({ k: 'upc', t: 'No UPC' });
  if (it.cost_hidden !== true && sizes.some((z) => z.cost == null)) out.push({ k: 'cost', t: 'No cost' });
  if (sizes.some((z) => (levels || []).some((l) => z.prices == null || z.prices[l.n] == null))) out.push({ k: 'price', t: 'Price missing' });
  if (sizes.some((z) => z.cost != null && (levels || []).some((l) => z.prices && z.prices[l.n] != null && z.prices[l.n] < z.cost))) out.push({ k: 'below', t: 'Price below cost' });
  return out;
}

// The size an item is listed by: the one people buy most often is usually the carton/box, so the first size.
export function mainSize(it) { return (it.sizes || [])[0] || null; }
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
