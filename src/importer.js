// "Bring in from your old system": the pure part (no screens, no database).
// Reads a CSV (Excel is turned into the same table by the screen), guesses which column is which,
// turns rows into clean items / customers and lists every problem in plain words.

import { CATEGORIES, TERMS, cleanUpc } from './rules.js';

// ---------- reading a CSV ----------
export function parseCsv(text) {
  text = String(text || '').replace(/^﻿/, '');
  const delim = guessDelim(text);
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = ''; rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return tidy(rows);
}
function guessDelim(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const c = { ',': 0, '\t': 0, ';': 0, '|': 0 };
  let q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (!q && ch in c) c[ch]++; }
  return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || ',';
}
// Drops empty rows, finds the heading row (the first row with 2+ filled cells that look like words).
export function tidy(rows) {
  rows = rows.map((r) => r.map((c) => String(c == null ? '' : c).trim())).filter((r) => r.some((c) => c !== ''));
  let h = rows.findIndex((r) => r.filter((c) => c && !/^[\d$.,()\-\s/]+$/.test(c)).length >= 2);
  if (h < 0) h = 0;
  const head = (rows[h] || []).map((c, i) => c || 'Column ' + (i + 1));
  const body = rows.slice(h + 1).map((r) => head.map((_, i) => r[i] || ''));
  return { head, rows: body };
}

// ---------- the fields each kind of list can fill ----------
export const ITEM_FIELDS = [
  ['name', 'Name'], ['upc', 'UPC'], ['item_no', 'Item #'], ['category', 'Category'], ['size', 'Size'], ['n', 'How many in it'],
  ['cost', 'Cost'], ['vendor', 'Vendor'], ['nacs', 'NACS code']
];
export const CUST_FIELDS = [
  ['name', 'Customer name'], ['store_no', 'Store #'], ['addr', 'Street address'], ['city', 'City'], ['state', 'State'], ['zip', 'ZIP'],
  ['phone', 'Phone'], ['email', 'Email'], ['contact', 'Contact name'], ['terms', 'Terms'], ['credit_limit', 'Credit limit'],
  ['level', 'Price level'], ['balance', 'Balance owed'], ['resale', 'Resale #'], ['location', 'State location #'],
  ['tobacco_no', 'Tobacco license #'], ['tobacco_exp', 'Tobacco license expires']
];
// A price column goes to a price level: 'p1', 'p2'…
export function fieldsFor(kind, levels) {
  if (kind === 'customers') return CUST_FIELDS;
  return ITEM_FIELDS.concat((levels || []).map((l) => ['p' + l.n, 'Price · ' + l.name]));
}

const WORDS = {
  items: {
    name: /^(item )?(name|description|desc|product|item description|product name)$/,
    upc: /^(upc|upc code|barcode|bar code|scan code|plu|ean|gtin)$/,
    item_no: /^(item ?#|item ?no\.?|item number|item code|sku|code|product code|part ?#|item id)$/,
    category: /^(category|cat|dept|department|group|class|type)$/,
    size: /^(size|unit|uom|pack ?type|unit of measure|sell unit|package)$/,
    n: /^(qty|pack|pack size|units?|count|qty per|per case|case qty|pk|inner|units per)$/,
    cost: /^(cost|unit cost|last cost|avg cost|average cost|cost price|purchase price)$/,
    vendor: /^(vendor|supplier|manufacturer|mfg|brand)$/,
    nacs: /^(nacs|nacs code|nacs category)$/
  },
  customers: {
    name: /^(customer|customer name|name|store name|business name|company|account name|dba)$/,
    store_no: /^(store ?#|store ?no\.?|store number|account ?#|account ?no\.?|acct ?#|customer ?#|customer id|cust ?#|id)$/,
    addr: /^(address|street|street address|address 1|address1|addr)$/,
    city: /^city$/, state: /^(state|st)$/, zip: /^(zip|zip code|postal code|zipcode)$/,
    phone: /^(phone|phone ?#|telephone|tel|phone number|cell)$/,
    email: /^(email|e-mail|email address)$/,
    contact: /^(contact|contact name|owner|owner name)$/,
    terms: /^(terms|payment terms|pay terms)$/,
    credit_limit: /^(credit limit|limit|credit)$/,
    level: /^(price level|level|tier|price tier|price code|price group|pricing)$/,
    balance: /^(balance|balance owed|amount owed|owes|open balance|ar balance|current balance|total due|due)$/,
    resale: /^(resale|resale ?#|resale certificate|resale no\.?|tax id|sales tax ?#|sales tax id|certificate ?#)$/,
    location: /^(location ?#|location id|state location|tn location|location number)$/,
    tobacco_no: /^(tobacco|tobacco ?#|tobacco license|tobacco license ?#|tobacco permit|cig license)$/,
    tobacco_exp: /^(tobacco exp\.?|tobacco expires|tobacco expiration|license expires|license exp\.?|expiration|expires|exp date)$/
  }
};
const norm = (h) => String(h || '').toLowerCase().replace(/[_.:]+/g, ' ').replace(/\s+/g, ' ').replace(/ number$/, ' number').trim();

// Which kind of list is this? More matched headings wins.
export function guessKind(head) {
  const score = (k) => head.filter((h) => Object.values(WORDS[k]).some((re) => re.test(norm(h)))).length;
  const hasPrices = head.some((h) => /price|retail|sell|^(a|b|c|l[1-6]|tier ?[1-6]|level ?[1-6])$/.test(norm(h)));
  const it = score('items') + (hasPrices ? 1 : 0), cu = score('customers');
  return cu > it ? 'customers' : 'items';
}

// Guess a field for every column. Price columns go to levels in order (Price 1 / A / Retail → first level…).
export function guessMap(kind, head, levels) {
  const map = head.map(() => '');
  const used = {};
  head.forEach((h, i) => {
    const n = norm(h);
    for (const [f, re] of Object.entries(WORDS[kind])) {
      if (!used[f] && re.test(n)) { map[i] = f; used[f] = 1; return; }
    }
  });
  if (kind === 'items') {
    const L = levels || [];
    const pcols = head.map((h, i) => [i, norm(h)]).filter(([i, n]) => !map[i] && /price|retail|sell|^(a|b|c|d|l[1-6]|tier ?[1-6]|level ?[1-6])$/.test(n));
    // Named after a level ("L2", "Route 2") goes to that level first.
    pcols.forEach(([i, n]) => { const l = L.find((x) => norm(x.name) === n || n.endsWith(' ' + norm(x.name))); if (l && !used['p' + l.n]) { map[i] = 'p' + l.n; used['p' + l.n] = 1; } });
    pcols.filter(([i]) => !map[i]).forEach(([i]) => { const l = L.find((x) => !used['p' + x.n]); if (l) { map[i] = 'p' + l.n; used['p' + l.n] = 1; } });
  }
  return map;
}

// ---------- reading values ----------
export function money(v) {
  let s = String(v == null ? '' : v).trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /-\s*$/.test(s) || /^-/.test(s.replace(/^\$/, ''));
  s = s.replace(/[$,()\s-]/g, '');
  if (!/^\d*\.?\d+$/.test(s)) return NaN;
  const n = Number(s);
  return neg ? -n : n;
}
// UPCs: digits only. Excel cuts long numbers into "1.47E+11" and drops leading zeros.
export function upcFrom(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return { upc: '' };
  if (/e\+?\d+$/i.test(s)) return { upc: '', bad: 'The UPC got cut short by Excel (' + s + '). Format that column as text and save again.' };
  let u = cleanUpc(s);
  if (u.length === 11 && checkOk('0' + u)) return { upc: '0' + u, fixed: true };
  if (u && (u.length < 6 || u.length > 14)) return { upc: u, bad: 'UPC ' + s + ' should be 6 to 14 digits.' };
  return { upc: u };
}
export function checkOk(u) {
  if (!/^\d{12,13}$/.test(u)) return false;
  const d = u.split('').map(Number), last = d.pop();
  let sum = 0;
  d.reverse().forEach((x, i) => { sum += i % 2 === 0 ? x * 3 : x; });
  return (10 - (sum % 10)) % 10 === last;
}
export function dateFrom(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return { d: null };
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return ok(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) return ok(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  if (/^\d{5}$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + +s * 86400000); return ok(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  const d = new Date(s);
  if (!isNaN(d)) return ok(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return { d: null, bad: 'The date ' + s + ' doesn’t look right.' };
  function ok(y, mo, da) {
    const dt = new Date(Date.UTC(y, mo - 1, da));
    if (dt.getUTCMonth() !== mo - 1 || y < 1990 || y > 2100) return { d: null, bad: 'The date ' + s + ' doesn’t look right.' };
    return { d: y + '-' + String(mo).padStart(2, '0') + '-' + String(da).padStart(2, '0') };
  }
}
export function termsFrom(v) {
  const s = String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/advance|prepa|pre-pay|in advance/.test(s)) return 'advance';
  if (/cod|c\.o\.d|cash|on delivery|due on receipt|receipt/.test(s)) return 'cod';
  const m = s.match(/(\d{1,2})/);
  if (m) { const d = +m[1]; if (d <= 7) return 'net7'; if (d <= 10) return 'net10'; if (d <= 14) return 'net14'; return 'net30'; }
  return TERMS.some((t) => t[0] === s) ? s : undefined;
}
export function levelFrom(v, levels) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return null;
  const L = levels || [];
  const byName = L.find((l) => l.name.toLowerCase() === s);
  if (byName) return byName.n;
  let n = null;
  if (/^[a-f]$/.test(s)) n = s.charCodeAt(0) - 96;
  else if (/^(l|level|tier|price|p)? ?([1-6])$/.test(s)) n = +s.match(/([1-6])$/)[1];
  return L.some((l) => l.n === n) ? n : undefined;
}
export function categoryFrom(v) {
  const s = String(v || '').toLowerCase();
  if (!s) return 'other';
  if (/cigarette|^cigs?$|\bcigs\b/.test(s)) return 'cigarettes';
  if (/cigarillo|cigar|leaf|wrap|blunt/.test(s)) return 'cigars';
  if (/cig/.test(s)) return 'cigarettes';
  if (/vap|e-?cig|disposable|pod|e-?liquid|juice/.test(s)) return 'vapor';
  if (/snuff|dip|smokeless|chew|moist/.test(s)) return 'snuff';
  if (/pouch|nicotine|zyn|on!|velo/.test(s)) return 'pouches';
  if (/hemp|cbd|delta|thc|cannab|kratom/.test(s)) return 'hemp';
  if (/beer|malt|ale\b|lager/.test(s)) return 'beer';
  if (/tobacco|otp|pipe|roll your own|ryo|hookah/.test(s)) return 'otp';
  const c = CATEGORIES.find((x) => x[1].toLowerCase() === s || x[0] === s);
  return c ? c[0] : 'other';
}
const SIZE_WORDS = [[/^(ctn|carton|cartons|crtn)$/, 'Carton', 10], [/^(cs|case|cases)$/, 'Case', null], [/^(bx|box|boxes)$/, 'Box', null],
  [/^(ea|each|unit|single)$/, 'Each', 1], [/^(pk|pack|packs)$/, 'Pack', 1], [/^(roll|rl)$/, 'Roll', 5], [/^(can|cans)$/, 'Can', 1],
  [/^(sleeve|slv)$/, 'Sleeve', null], [/^(dsp|display)$/, 'Display', null], [/^(btl|bottle)$/, 'Bottle', 1], [/^(bag)$/, 'Bag', 1], [/^(tin)$/, 'Tin', 1]];
export function sizeFrom(v, name) {
  let s = String(v || '').toLowerCase().trim();
  if (!s) { const m = String(name || '').toLowerCase().match(/\b(ctn|carton|cs|case|bx|box|roll|sleeve|display|dsp)\b/); s = m ? m[1] : ''; }
  for (const [re, nm, n] of SIZE_WORDS) if (re.test(s)) return { name: nm, n };
  return { name: s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Each', n: null };
}
const UNIT_FOR = { cigarettes: 'pack', pouches: 'can', snuff: 'can', cigars: 'each', vapor: 'each', hemp: 'each', otp: 'each', beer: 'each', other: 'each' };

// ---------- turning rows into items / customers ----------
// Returns { good: [...], bad: [{row, name, why}], fixed: n, total }
export function buildItems(table, map, levels, existing) {
  const col = (f) => map.indexOf(f);
  const get = (r, f) => (col(f) >= 0 ? r[col(f)] : '');
  const haveUpc = new Set();
  (existing || []).forEach((it) => (it.sizes || []).forEach((z) => z.upc && haveUpc.add(z.upc)));
  const seen = {}, good = [], bad = [], skip = [];
  let fixed = 0;
  table.rows.forEach((r, i) => {
    const row = i + 2, name = String(get(r, 'name')).trim();
    if (!name) { if (r.some((c) => c)) bad.push({ row, name: r.find((c) => c) || '', why: 'No name.' }); return; }
    const u = upcFrom(get(r, 'upc'));
    if (u.bad) return bad.push({ row, name, why: u.bad });
    if (u.fixed) fixed++;
    if (u.upc && seen[u.upc]) return bad.push({ row, name, why: 'Same UPC as row ' + seen[u.upc] + '.' });
    if (u.upc) seen[u.upc] = row;
    if (u.upc && haveUpc.has(u.upc)) return skip.push({ row, name, why: 'Already in StoreOwl (same UPC).' });
    const cost = money(get(r, 'cost'));
    if (cost != null && (isNaN(cost) || cost < 0)) return bad.push({ row, name, why: 'The cost ' + get(r, 'cost') + ' isn’t a number.' });
    const prices = {};
    for (const l of levels || []) {
      if (col('p' + l.n) < 0) continue;
      const p = money(get(r, 'p' + l.n));
      if (p == null) continue;
      if (isNaN(p) || p < 0) return bad.push({ row, name, why: 'The ' + l.name + ' price ' + get(r, 'p' + l.n) + ' isn’t a number.' });
      prices[l.n] = p;
    }
    const category = categoryFrom(get(r, 'category') || name);
    const sz = sizeFrom(get(r, 'size'), name);
    let n = parseInt(String(get(r, 'n')).replace(/\D/g, ''), 10);
    if (!(n >= 1)) n = sz.n || (sz.name === 'Carton' && category === 'cigarettes' ? 10 : 1);
    good.push({ row, name, item_no: String(get(r, 'item_no')).trim(), category, unit: UNIT_FOR[category], vendor: String(get(r, 'vendor')).trim(),
      nacs: String(get(r, 'nacs')).trim(), age: ['beer', 'other'].includes(category) ? (category === 'beer' ? 21 : 0) : 21,
      sizes: [{ name: sz.name, n, upc: u.upc, cost: cost == null ? null : cost, prices }] });
  });
  return { good, bad, skip, fixed, total: table.rows.length };
}

export function buildCustomers(table, map, levels, existing, defLevel) {
  const col = (f) => map.indexOf(f);
  const get = (r, f) => (col(f) >= 0 ? String(r[col(f)] || '').trim() : '');
  const key = (name, store) => name.toLowerCase().replace(/\s+/g, ' ') + '|' + String(store || '').toLowerCase();
  const have = new Set((existing || []).map((c) => key(c.name, c.store_no)));
  const seen = {}, good = [], bad = [], skip = [];
  let balance = 0, outBal = 0;
  table.rows.forEach((r, i) => {
    const row = i + 2, name = get(r, 'name');
    const b0 = money(get(r, 'balance'));
    const n0 = bad.length;
    const res = one(r, row, name);
    if (bad.length > n0 && b0 != null && !isNaN(b0)) { bad[bad.length - 1].bal = b0; outBal += b0; }
    return res;
  });
  function one(r, row, name) {
    if (!name) { if (r.some((c) => c)) bad.push({ row, name: r.find((c) => c) || '', why: 'No customer name.' }); return; }
    const k = key(name, get(r, 'store_no'));
    if (seen[k]) return bad.push({ row, name, why: 'Same customer as row ' + seen[k] + '.' });
    seen[k] = row;
    if (have.has(k)) return skip.push({ row, name, why: 'Already in StoreOwl.' });
    const bal = money(get(r, 'balance'));
    if (bal != null && isNaN(bal)) return bad.push({ row, name, why: 'The balance ' + get(r, 'balance') + ' isn’t a number.' });
    const lim = money(get(r, 'credit_limit'));
    if (lim != null && (isNaN(lim) || lim < 0)) return bad.push({ row, name, why: 'The credit limit ' + get(r, 'credit_limit') + ' isn’t a number.' });
    const terms = termsFrom(get(r, 'terms'));
    if (terms === undefined) return bad.push({ row, name, why: 'StoreOwl doesn’t know the terms “' + get(r, 'terms') + '”.' });
    const level = levelFrom(get(r, 'level'), levels);
    if (level === undefined) return bad.push({ row, name, why: 'No price level called “' + get(r, 'level') + '”.' });
    const exp = dateFrom(get(r, 'tobacco_exp'));
    if (exp.bad) return bad.push({ row, name, why: exp.bad.replace('The date', 'The tobacco license date') });
    const email = get(r, 'email').toLowerCase();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad.push({ row, name, why: 'The email ' + email + ' doesn’t look right.' });
    const st = get(r, 'state').toUpperCase();
    const lic = [];
    if (get(r, 'resale')) lic.push({ kind: 'resale', number: get(r, 'resale') });
    if (get(r, 'location')) lic.push({ kind: 'location', number: get(r, 'location') });
    if (get(r, 'tobacco_no')) lic.push({ kind: 'tobacco', number: get(r, 'tobacco_no'), expires: exp.d });
    balance += bal || 0;
    good.push({ row, name, store_no: get(r, 'store_no'), addr: get(r, 'addr'), city: get(r, 'city'), state: /^[A-Z]{2}$/.test(st) ? st : '', zip: get(r, 'zip'),
      phone: get(r, 'phone'), email, contacts: get(r, 'contact') ? [{ name: get(r, 'contact'), role: 'Owner', phone: get(r, 'phone') }] : [],
      terms: terms || 'cod', credit_limit: lim, level: level || defLevel || 1, opening: bal || 0, licenses: lic });
  }
  return { good, bad, skip, balance: Math.round(balance * 100) / 100, outBal: Math.round(outBal * 100) / 100, total: table.rows.length };
}
