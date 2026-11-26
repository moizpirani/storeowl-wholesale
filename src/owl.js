// The StoreOwl owl (Night Watch) and its little moments (2026-11-07, Moiz approved).
// owlSvg(opts) draws the owl. Every owl has hidden wings that cover its eyes (body.owl-shy or .owlcover),
// and can have sleepy lids, side wings for a hoot, and a holiday decoration.
// All motion lives in styles.css (block "Owl moments") and stops with "Reduce motion".

const N = '#0F1B2D', A = '#F2A900', W2 = '#23365A';

function eye(cx, px) {
  return '<g class="owleye"><circle class="owlwh" cx="' + cx + '" cy="58" r="17" fill="#fff" stroke="' + A + '" stroke-width="6"/>' +
    '<circle class="owlpu" cx="' + px + '" cy="60" r="6" fill="' + N + '"/></g>';
}

// Holiday decorations (Moiz approved, 2026-11-07). front = drawn over the owl; back = behind it;
// small = draw the owl smaller to make room (turkey tail, bunny ears). Everything stays inside the square.
function star(cx, cy, r, c) { let p = ''; for (let k = 0; k < 10; k++) { const a = Math.PI / 5 * k - Math.PI / 2, rr = k % 2 ? r * .45 : r; p += (k ? 'L' : 'M') + (cx + rr * Math.cos(a)).toFixed(1) + ' ' + (cy + rr * Math.sin(a)).toFixed(1); } return '<path d="' + p + 'Z" fill="' + c + '"/>'; }
function heart(x, y, s, c) { return '<path transform="translate(' + x + ' ' + y + ') scale(' + s + ')" d="M0 6 C-8 -2 -12 -8 -6 -12 C-2 -14 0 -10 0 -8 C0 -10 2 -14 6 -12 C12 -8 8 -2 0 6 Z" fill="' + c + '"/>'; }
function burst(cx, cy, r, c) { let h = ''; for (let k = 0; k < 10; k++) { const a = Math.PI * 2 * k / 10, x1 = cx + Math.cos(a) * r * .35, y1 = cy + Math.sin(a) * r * .35, x2 = cx + Math.cos(a) * r, y2 = cy + Math.sin(a) * r;
  h += '<path d="M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + '" stroke="' + c + '" stroke-width="2.6" stroke-linecap="round"/><circle cx="' + x2.toFixed(1) + '" cy="' + y2.toFixed(1) + '" r="1.6" fill="' + c + '"/>'; }
  return '<g class="owlburst" style="transform-origin:' + cx + 'px ' + cy + 'px">' + h + '</g>'; }
const g = (s, extra) => '<g class="owlhol"' + (extra || '') + '>' + s + '</g>';
const HOL = {
  // New Year's: three small fireworks burst behind the owl, one after another (Moiz picked B).
  newyear: { back: g(burst(20, 22, 17, '#E11D48') + burst(100, 18, 16, '#7C3AED') + burst(104, 52, 10, '#0D9488')) },
  valentine: { front: g('<g class="owlbeat">' + heart(99, 96, 1.55, '#E11D48') + '</g><g class="owlfloat">' + heart(101, 30, .85, '#F472B6') + '</g><g class="owlfloat">' + heart(16, 44, .6, '#F472B6') + '</g>') },
  stpat: { front: g('<ellipse cx="60" cy="33" rx="30" ry="5.5" fill="#14532D"/><path d="M45 32 L48 4 Q60 1 72 4 L75 32 Z" fill="#16A34A"/><rect x="46.4" y="22" width="27.2" height="7" fill="#14532D"/><rect x="55" y="20.5" width="10" height="10" rx="1.5" fill="none" stroke="' + A + '" stroke-width="2.6"/>' +
    '<g class="owlsway"><g transform="translate(96 22)" fill="#22C55E"><circle cx="0" cy="-5" r="5"/><circle cx="-5" cy="1" r="5"/><circle cx="5" cy="1" r="5"/><path d="M0 2 Q2 10 -2 14" stroke="#15803D" stroke-width="2" fill="none"/></g></g>') },
  holi: { front: g('<circle class="owlpuff" cx="34" cy="90" r="9" fill="#EC4899" opacity=".85"/><circle class="owlpuff" cx="86" cy="94" r="8" fill="#22C55E" opacity=".85"/><circle class="owlpuff" cx="72" cy="102" r="6" fill="#3B82F6" opacity=".85"/><circle class="owlpuff" cx="46" cy="102" r="5" fill="#F2C14E" opacity=".9"/>' +
    '<circle class="owlpuff" cx="30" cy="40" r="5" fill="#A855F7" opacity=".85"/><circle class="owlpuff" cx="90" cy="38" r="4" fill="#F97316" opacity=".85"/><circle class="owlpuff" cx="100" cy="70" r="3" fill="#EC4899"/><circle class="owlpuff" cx="18" cy="66" r="3" fill="#22C55E"/><circle class="owlpuff" cx="106" cy="20" r="3" fill="#3B82F6"/><circle class="owlpuff" cx="12" cy="20" r="3" fill="#F2C14E"/>') },
  eid: { front: g('<mask id="owl-eidm"><rect width="120" height="120" fill="#fff"/><circle cx="100" cy="21" r="11" fill="#000"/></mask><circle cx="94" cy="25" r="14" fill="#FFF6DA" stroke="#B57E00" stroke-width="2" mask="url(#owl-eidm)"/><g class="owltwinkle">' + star(106, 30, 6.5, '#B57E00') + star(106, 30, 4.6, '#FFF6DA') + '</g>') },
  easter: { small: [.78, 13, 26], back: g('<ellipse cx="40" cy="26" rx="10" ry="26" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1.5" transform="rotate(-12 40 26)"/><ellipse cx="40" cy="28" rx="5" ry="18" fill="#F9A8D4" transform="rotate(-12 40 28)"/>' +
    '<g class="owlear"><ellipse cx="80" cy="26" rx="10" ry="26" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1.5" transform="rotate(12 80 26)"/><ellipse cx="80" cy="28" rx="5" ry="18" fill="#F9A8D4" transform="rotate(12 80 28)"/></g>') },
  july4: { front: g('<ellipse cx="60" cy="33" rx="29" ry="5" fill="#1E3A8A"/><path d="M46 32 L48 2 Q60 -1 72 2 L74 32 Z" fill="#fff" stroke="#CBD5E1" stroke-width="1"/><path d="M48.6 8 H71.4 M48 15 H72 M47.4 22 H72.6" stroke="#DC2626" stroke-width="3.4"/>' +
    '<rect x="46.6" y="24" width="26.8" height="8" fill="#1E3A8A"/>' + '<g class="owlstar">' + star(53, 28, 2.6, '#fff') + '</g><g class="owlstar">' + star(60, 28, 2.6, '#fff') + '</g><g class="owlstar">' + star(67, 28, 2.6, '#fff') + '</g>') },
  halloween: { front: g('<ellipse cx="60" cy="33" rx="34" ry="6" fill="#4C1D95"/><path d="M42 32 Q52 18 58 6 Q62 -2 74 2 Q66 6 66 14 L78 32 Z" fill="#6D28D9"/><path d="M44 28 Q60 33 77 28 L78 32 Q60 37 42 32 Z" fill="#F97316"/>' +
    '<g transform="translate(100 96)"><ellipse cx="0" cy="0" rx="12" ry="10" fill="#F97316"/><path d="M0 -10 V-14" stroke="#15803D" stroke-width="3"/><path class="owlglow" d="M-6 -2 L-3 -5 L0 -2 Z M6 -2 L3 -5 L0 -2 Z M-6 3 Q0 7 6 3" fill="#FFD54F" stroke="#FFB300" stroke-width="1"/></g>') },
  // Diwali: a small diya (oil lamp) beside the owl, with a flickering flame.
  diwali: { front: g('<path d="M0 8 Q22 30 44 8 Z" fill="#B5461A" stroke="#7A2C0E" stroke-width="2"/><path d="M2 8 H42" stroke="#FFE08A" stroke-width="2.5" stroke-linecap="round"/>' +
    '<path class="owlflame" d="M22 8 Q13 -3 22 -16 Q31 -3 22 8 Z" fill="#FF6A00"/><path d="M22 6 Q17 0 22 -7 Q27 0 22 6 Z" fill="#FFE08A"/>', ' transform="translate(72 90) scale(.9)"') },
  // Thanksgiving: colorful feathers fanned out behind a smaller owl (Moiz picked the turkey tail).
  thanks: { small: [.73, 16, 26], back: g(['#B02A1A', '#D9480F', '#E8890C', '#F2C14E', '#8A5A2B', '#F2C14E', '#E8890C', '#D9480F', '#B02A1A'].map(function (c, i) {
    const a = -80 + i * 20; return '<g transform="translate(60 92)"><path class="owlfeather" style="--a:' + a + 'deg" transform="rotate(' + a + ')" d="M-8 0 Q-12 -62 0 -86 Q12 -62 8 0 Z" fill="' + c + '" stroke="#0F1B2D" stroke-opacity=".15"/></g>'; }).join('')) },
  // Hanukkah: a blue menorah with white candles and bright flames (outlined so they show on amber).
  hanukkah: { front: g('<path d="M-1 24 H41" stroke="#1D4ED8" stroke-width="4" stroke-linecap="round"/><path d="M20 24 V12" stroke="#1D4ED8" stroke-width="3.5"/><path d="M1 12 H39" stroke="#1D4ED8" stroke-width="3.5" stroke-linecap="round"/>' +
    [0, 1, 2, 3, 4, 5, 6, 7, 8].map(function (k) { const x = 2 + k * 4.5, tall = k === 4, top = tall ? -1 : 3;
      return '<rect x="' + (x - 1.5) + '" y="' + top + '" width="3" height="' + (12 - top) + '" rx=".8" fill="#fff" stroke="#1E3A8A" stroke-width=".8"/>' +
        '<g class="owlcandle"><path d="M' + x + ' ' + top + ' q-2.6 -3.4 0 -7.5 q2.6 4.1 0 7.5z" fill="#FF4D00" stroke="#7A2C0E" stroke-width=".6"/><path d="M' + x + ' ' + (top - .6) + ' q-1.1 -1.7 0 -3.6 q1.1 1.9 0 3.6z" fill="#FFE066"/></g>'; }).join(''), ' transform="translate(58 76) scale(1.5)"') },
  // Christmas: a Santa hat flopping to the right.
  xmas: { front: g('<path d="M38 33 Q50 0 80 2 Q90 4 94 14 Q84 12 80 20 L82 33 Z" fill="#C62828"/><rect x="34" y="27" width="52" height="10" rx="5" fill="#fff" stroke="#D5D9E0" stroke-width="1.2"/><circle class="owlpom" cx="94" cy="15" r="6.5" fill="#fff" stroke="#D5D9E0" stroke-width="1.2"/>') }
};
export const HOLIDAY_NAMES = { newyear: 'New Year’s', valentine: 'Valentine’s Day', stpat: 'St. Patrick’s Day', holi: 'Holi', eid: 'Eid al-Fitr', easter: 'Easter', july4: '4th of July',
  halloween: 'Halloween', diwali: 'Diwali', thanks: 'Thanksgiving', hanukkah: 'Hanukkah', xmas: 'Christmas' };

export function owlSvg(o) {
  o = o || {};
  const side = o.side ? '<g class="owlsw l"><path d="M24 66 Q2 78 10 104 Q22 100 28 86 Z" fill="' + W2 + '" stroke="' + A + '" stroke-width="3"/></g>' +
    '<g class="owlsw r"><path d="M96 66 Q118 78 110 104 Q98 100 92 86 Z" fill="' + W2 + '" stroke="' + A + '" stroke-width="3"/></g>' : '';
  const body = '<path d="M22 42 L30 12 L48 30 Q60 26 72 30 L90 12 L98 42 Q106 62 98 84 Q86 108 60 110 Q34 108 22 84 Q14 62 22 42 Z" fill="' + N + '"/>';
  const lids = o.lids ? '<g class="owllids"><path d="M22 58 A21 21 0 0 1 64 58 Z" fill="' + N + '"/><path d="M56 58 A21 21 0 0 1 98 58 Z" fill="' + N + '"/>' +
    '<path d="M24 58 H62 M58 58 H96" stroke="' + A + '" stroke-width="3" stroke-linecap="round"/></g>' : '';
  const beak = '<path d="M54 74 L66 74 L60 86 Z" fill="' + A + '"/>';
  const H = o.hol && HOL[o.hol] ? HOL[o.hol] : null, isHol = !!H, hol = H && H.front ? H.front : '';
  const cover = '<g class="owlcw l"><ellipse cx="42" cy="61" rx="22" ry="20" fill="' + W2 + '" stroke="' + A + '" stroke-width="3"/>' +
    '<path d="M30 64 Q42 70 54 64 M32 72 Q42 77 52 72" stroke="' + A + '" stroke-width="2" fill="none" opacity=".7"/></g>' +
    '<g class="owlcw r"><ellipse cx="78" cy="61" rx="22" ry="20" fill="' + W2 + '" stroke="' + A + '" stroke-width="3"/>' +
    '<path d="M66 64 Q78 70 90 64 M68 72 Q78 77 88 72" stroke="' + A + '" stroke-width="2" fill="none" opacity=".7"/></g>';
  const cls = 'owlmark' + (o.cls ? ' ' + o.cls : '') + (isHol ? ' hol-' + o.hol : '');
  let inner = side + body + eye(43, 45) + eye(77, 75) + lids + beak + hol + cover;
  if (H && H.small) inner = '<g transform="translate(' + H.small[1] + ' ' + H.small[2] + ') scale(' + H.small[0] + ')">' + inner + '</g>';
  if (H && H.back) inner = H.back + inner;
  return '<svg class="' + cls + '" viewBox="0 0 120 120" aria-hidden="true" focusable="false">' + inner + '</svg>';
}

// Which holiday decoration to show on a date (local time), or null. When two overlap, the shorter one wins
// (then the order in HOL_ORDER). Dates that move each year are listed through 2028 — add later years here.
//   New Year's Dec 31 – Jan 2 · Valentine's Feb 12–14 · St. Patrick's Mar 15–17 · 4th of July Jul 2–5 · Halloween Oct 25–31
//   Christmas Dec 18–26 · Thanksgiving: Friday before → Sunday after (4th Thursday of November)
//   Easter: Good Friday → Easter Monday (worked out) · Holi: day before → day after · Eid al-Fitr: day before → 3 days after
//   Diwali: day before → 2 days after · Hanukkah: the first night → the last day
const MOVING = {
  holi: { 2027: '03-22', 2028: '03-11' },
  eid: { 2027: '03-09', 2028: '02-26' },
  diwali: { 2026: '11-08', 2027: '10-29', 2028: '10-17' },
  hanukkah: { 2026: ['12-04', '12-12'], 2027: ['12-24', '2028-01-01'], 2028: ['12-12', '12-20'] }
};
const HOL_ORDER = ['newyear', 'valentine', 'stpat', 'holi', 'eid', 'easter', 'july4', 'diwali', 'halloween', 'thanks', 'xmas', 'hanukkah'];
function ymd(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
function addDays(d, n) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
function md(y, s) { const p = s.split('-'); return p.length === 3 ? new Date(+p[0], +p[1] - 1, +p[2]) : new Date(y, +p[0] - 1, +p[1]); }
export function thanksgiving(year) { const d = new Date(year, 10, 1); const first = (4 - d.getDay() + 7) % 7; return new Date(year, 10, 1 + first + 21); }
// Easter Sunday (Gregorian), the usual "anonymous" method.
export function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), gg = Math.floor((b - f + 1) / 3),
  h = (19 * a + b - d - gg + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, mo - 1, da); }
function windows(y) {
  const w = [], add = (id, a, b) => w.push({ id: id, a: ymd(a), b: ymd(b) }), D = (m, d) => new Date(y, m - 1, d);
  add('newyear', D(12, 31), new Date(y + 1, 0, 2)); add('newyear', new Date(y - 1, 11, 31), D(1, 2));
  add('valentine', D(2, 12), D(2, 14)); add('stpat', D(3, 15), D(3, 17)); add('july4', D(7, 2), D(7, 5)); add('halloween', D(10, 25), D(10, 31));
  add('xmas', D(12, 18), D(12, 26));
  const tg = thanksgiving(y); add('thanks', addDays(tg, -6), addDays(tg, 3));
  const ea = easter(y); add('easter', addDays(ea, -2), addDays(ea, 1));
  if (MOVING.holi[y]) { const x = md(y, MOVING.holi[y]); add('holi', addDays(x, -1), addDays(x, 1)); }
  if (MOVING.eid[y]) { const x = md(y, MOVING.eid[y]); add('eid', addDays(x, -1), addDays(x, 3)); }
  if (MOVING.diwali[y]) { const x = md(y, MOVING.diwali[y]); add('diwali', addDays(x, -1), addDays(x, 2)); }
  [y - 1, y].forEach(function (yy) { const h = MOVING.hanukkah[yy]; if (h) add('hanukkah', md(yy, h[0]), md(yy, h[1])); });
  return w;
}
export function holidayFor(date) {
  const k = ymd(date), hits = windows(date.getFullYear()).filter(function (x) { return k >= x.a && k <= x.b; });
  if (!hits.length) return null;
  const len = function (x) { return Math.round((md(0, String(x.b).replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3')) - md(0, String(x.a).replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3'))) / 864e5); };
  hits.sort(function (p, q) { return len(p) - len(q) || HOL_ORDER.indexOf(p.id) - HOL_ORDER.indexOf(q.id); });
  return hits[0].id;
}

// Counts numbers like "$3,138.68", "−$1.53", "+$0.42", "480.4 gal" up from 0 (once, about half a second).
export function countUp(root, ms) {
  if (!root || typeof window === 'undefined' || !window.requestAnimationFrame) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (/jsdom/i.test((window.navigator && window.navigator.userAgent) || '')) return; // tests read the final numbers
  ms = ms || 550;
  root.forEach ? root.forEach(go) : go(root);
  function go(el) {
    const txt = el.textContent, m = txt.match(/^([+−-]?)(\$?)([\d,]+(?:\.(\d+))?)(.*)$/);
    if (!m) return;
    const to = parseFloat(m[3].replace(/,/g, '')), dec = m[4] ? m[4].length : 0, comma = m[3].indexOf(',') >= 0 || to >= 1000;
    if (!(to > 0)) return;
    const W = window, raf = W.requestAnimationFrame.bind(W), t0 = W.performance ? W.performance.now() : Date.now();
    function fmt(v) { const s = comma ? v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec); return m[1] + m[2] + s + m[5]; }
    function step(t) { if (!el.isConnected) return; const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3); el.textContent = p < 1 ? fmt(to * e) : txt; if (p < 1) raf(step); }
    el.textContent = fmt(0); raf(step);
  }
}

// Grey shimmering boxes instead of a plain "Loading…" line.
export function skeletonize(root) {
  if (!root || !root.querySelectorAll) return;
  // Only look through the screen when it actually says "Loading…" (big tables like the Price Book redraw often).
  if ((root.textContent || '').indexOf('Loading…') < 0) return;
  root.querySelectorAll('p, span.muted, td').forEach(function (el) {
    if (el.children.length || el.textContent.trim() !== 'Loading…' || el.dataset.sk) return;
    el.dataset.sk = '1'; el.classList.add('skwrap'); el.setAttribute('aria-label', 'Loading'); el.setAttribute('role', 'status');
    const n = el.tagName === 'TD' || el.tagName === 'SPAN' ? 1 : 3;
    let h = ''; for (let i = 0; i < n; i++) h += '<i class="sk" style="width:' + (n === 1 ? 70 : 100 - i * 12) + '%"></i>';
    el.innerHTML = h;
  });
}

// Owls with .owlfollow look toward the mouse or finger.
let following = false;
export function followEyes() {
  if (following || typeof document === 'undefined') return; following = true;
  function look(x, y) {
    document.querySelectorAll('.owlfollow').forEach(function (svg) {
      const r = svg.getBoundingClientRect(); if (!r.width) return;
      const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2), m = Math.hypot(dx, dy) || 1, k = Math.min(1, m / 140) * 5;
      svg.querySelectorAll('.owlpu').forEach(function (p) { p.setAttribute('transform', 'translate(' + (dx / m * k).toFixed(2) + ' ' + (dy / m * k).toFixed(2) + ')'); });
    });
  }
  document.addEventListener('pointermove', function (e) { look(e.clientX, e.clientY); }, { passive: true });
  document.addEventListener('pointerdown', function (e) { look(e.clientX, e.clientY); }, { passive: true });
}

// Inputs that hold something private: the owl covers its eyes while one has focus.
export function isSecretInput(el) {
  if (!el || el.tagName !== 'INPUT') return false;
  if (el.type === 'password' || el.autocomplete === 'one-time-code' || el.dataset.secret != null) return true;
  return /(^|-)(pin|ep|pw|pw2|code|pass)$/i.test(el.id || '') && (el.inputMode === 'numeric' || el.type === 'password' || /pw/.test(el.id));
}
let shy = false;
export function shyOnSecrets() {
  if (shy || typeof document === 'undefined') return; shy = true;
  document.addEventListener('focusin', function (e) { if (isSecretInput(e.target)) document.body.classList.add('owl-shy'); });
  document.addEventListener('focusout', function (e) { if (isSecretInput(e.target)) document.body.classList.remove('owl-shy'); });
}

// Phones: pull the page down from the top to refresh. Shows the owl while it loads.
export function pullToRefresh(opts) {
  if (typeof document === 'undefined' || !('ontouchstart' in window)) return;
  let y0 = null, dy = 0, busy = false, ind = null;
  function el() {
    if (!ind) { ind = document.createElement('div'); ind.className = 'owlpull'; ind.setAttribute('aria-hidden', 'true'); ind.innerHTML = '<span>' + owlSvg({ cls: 'owlspin' }) + '</span>'; document.body.appendChild(ind); }
    return ind;
  }
  document.addEventListener('touchstart', function (e) {
    if (busy || !opts.enabled() || window.scrollY > 0 || e.touches.length !== 1) { y0 = null; return; }
    if (e.target.closest && e.target.closest('input,textarea,select,.msheet,.botable-wrap,[data-nopull]')) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (y0 == null) return; dy = e.touches[0].clientY - y0;
    if (dy <= 0 || window.scrollY > 0) { dy = 0; el().style.transform = ''; el().classList.remove('show'); return; }
    const d = Math.min(90, dy * 0.5), i = el(); i.classList.add('show'); i.classList.toggle('ready', d >= 55); i.style.transform = 'translate(-50%,' + (d - 50) + 'px)';
  }, { passive: true });
  document.addEventListener('touchend', function () {
    if (y0 == null) return; y0 = null; const i = el();
    if (dy * 0.5 >= 55) {
      busy = true; i.classList.add('busy'); i.style.transform = 'translate(-50%,14px)';
      Promise.resolve(opts.refresh()).catch(function () {}).then(function () {
        setTimeout(function () { busy = false; i.classList.remove('busy', 'show', 'ready'); i.style.transform = ''; }, 900);
      });
    } else { i.classList.remove('show', 'ready'); i.style.transform = ''; }
    dy = 0;
  }, { passive: true });
}
