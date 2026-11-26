// The one door to the database. Screens call these; nothing else talks to Supabase.
// A pretend backend (makeFake) has the same calls, for tests and pictures.

import { cleanStates } from './states.js';
import { DEFAULT_SETTINGS, itemCheck, custCheck, levelsCheck, cleanUpc } from './rules.js';

export function makeDb(sb) {
  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args || {});
    if (error) throw new Error(plain(error.message));
    return data;
  }
  return {
    async session() { const { data } = await sb.auth.getSession(); return data.session ? { email: data.session.user.email } : null; },
    onAuth(fn) { sb.auth.onAuthStateChange(function (ev, s) { fn(s ? { email: s.user.email } : null); }); },
    async sendCode(email) {
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw new Error(plain(error.message));
    },
    async verifyCode(email, code) {
      const { error } = await sb.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) throw new Error(plain(error.message));
    },
    async signOut() { await sb.auth.signOut(); },
    myCompanies: () => rpc('my_companies'),
    createCompany: (p) => rpc('create_company', { p }),
    companyPut: (id, p) => rpc('company_put', { p_company: id, p }),
    statesSet: (id, home, others) => rpc('company_states_set', { p_company: id, p_home: home, p_others: others }),
    members: (id) => rpc('members_list', { p_company: id }),
    invite: (id, email, role) => rpc('invite_put', { p_company: id, p_email: email, p_role: role }),
    inviteRemove: (id, email) => rpc('invite_remove', { p_company: id, p_email: email }),
    memberSet: (id, user, role) => rpc('member_set', { p_company: id, p_user: user, p_role: role }),
    myName: (id, name) => rpc('my_name_set', { p_company: id, p_name: name }),
    history: (id) => rpc('change_log_list', { p_company: id, p_limit: 50 }),
    levelsSet: (id, list) => rpc('levels_set', { p_company: id, p_list: list }),
    settingsSet: (id, p) => rpc('company_settings_set', { p_company: id, p }),
    items: (id) => rpc('items_list', { p_company: id }),
    itemPut: (id, p) => rpc('item_put', { p_company: id, p }),
    customers: (id) => rpc('customers_list', { p_company: id }),
    customer: (id, cust) => rpc('customer_get', { p_company: id, p_id: cust }),
    customerPut: (id, p) => rpc('customer_put', { p_company: id, p }),
    licensePut: (id, cust, p) => rpc('license_put', { p_company: id, p_customer: cust, p }),
    noteAdd: (id, cust, text) => rpc('note_add', { p_company: id, p_customer: cust, p_text: text })
  };
}

// Database messages in plain words.
export function plain(m) {
  m = String(m || '');
  if (/rate limit|security purposes/i.test(m)) return 'Too many codes asked for. Wait a minute and try again.';
  if (/expired|invalid.*(otp|token)|token.*(invalid|expired)/i.test(m)) return 'That code is wrong or too old. Ask for a new one.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No internet connection. Try again.';
  return m.replace(/^(ERROR:\s*)/, '').replace(/^./, function (c) { return c.toUpperCase(); });
}

// ----- pretend backend -----
export function makeFake(opts) {
  opts = opts || {};
  let me = opts.signedIn ? { email: opts.signedIn } : null;
  const S = { companies: [], members: [], invites: [], log: [], items: [], customers: [], notes: [] };
  let n = 0;
  const id = () => 'c' + (++n);
  const uid = (email) => 'u-' + email;
  const listeners = [];
  function need(cid, min) {
    if (!me) throw new Error('Not signed in');
    const m = S.members.find((x) => x.company_id === cid && x.user_id === uid(me.email));
    if (!m) throw new Error('No access to this company');
    const r = { owner: 3, manager: 2, staff: 1 };
    if (r[m.role] < r[min]) throw new Error(min === 'owner' ? 'Only an owner can do this' : 'Only a manager or owner can do this');
    return m;
  }
  function cj(c) {
    const m = me && S.members.find((x) => x.company_id === c.id && x.user_id === uid(me.email));
    return Object.assign({}, c, { role: m ? m.role : null, others: c.others.slice(),
      settings: Object.assign({}, DEFAULT_SETTINGS, c.settings || {}),
      levels: c.levels.map((l) => ({ n: l.n, name: l.name, customers: S.customers.filter((x) => x.company_id === c.id && x.active && x.level === l.n).length })) });
  }
  const copy = (o) => JSON.parse(JSON.stringify(o));
  const nz = (v) => (v === '' || v == null ? null : Number(v));
  function itemOut(it, cost) {
    const o = copy(it); delete o.company_id; o.cost_hidden = !cost;
    if (!cost) o.sizes.forEach((z) => { z.cost = null; });
    return o;
  }
  function custOut(c, full) {
    const o = copy(c); delete o.company_id; o.owes = 0;
    if (full) {
      o.notes = S.notes.filter((x) => x.customer_id === c.id).slice().reverse().map((x) => ({ id: x.id, text: x.text, by: x.by, at: x.at }));
      o.history = S.log.filter((x) => x.company_id === c.company_id && x.detail.customer === c.id).slice(0, 100);
    }
    return o;
  }
  function log(cid, what, detail) {
    const m = S.members.find((x) => x.company_id === cid && x.user_id === uid(me.email));
    S.log.unshift({ company_id: cid, at: new Date().toISOString(), by: (m && m.name) || me.email, what, detail: detail || {} });
  }
  function list(cid) {
    const rank = { owner: 1, manager: 2, staff: 3 };
    return {
      members: S.members.filter((x) => x.company_id === cid).sort((a, b) => rank[a.role] - rank[b.role] || a.email.localeCompare(b.email))
        .map((x) => ({ user_id: x.user_id, email: x.email, name: x.name, role: x.role, me: x.user_id === uid(me.email) })),
      invites: S.invites.filter((x) => x.company_id === cid).map((x) => ({ email: x.email, role: x.role, at: x.at }))
    };
  }
  const api = {
    S,
    async session() { return me; },
    onAuth(fn) { listeners.push(fn); },
    async sendCode(email) { if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That email doesn’t look right'); api.lastCode = '123456'; api.codeFor = email; },
    async verifyCode(email, code) {
      if (code !== '123456' || email !== api.codeFor) throw new Error('That code is wrong or too old. Ask for a new one.');
      me = { email }; listeners.forEach((f) => f(me));
    },
    async signOut() { me = null; listeners.forEach((f) => f(null)); },
    async myCompanies() {
      if (!me) throw new Error('Not signed in');
      S.invites.filter((x) => x.email === me.email).forEach((x) => {
        S.members.push({ company_id: x.company_id, user_id: uid(me.email), email: me.email, name: '', role: x.role });
      });
      S.invites = S.invites.filter((x) => x.email !== me.email);
      return S.companies.filter((c) => S.members.some((m) => m.company_id === c.id && m.user_id === uid(me.email))).map(cj);
    },
    async createCompany(p) {
      if (!me) throw new Error('Not signed in');
      if (!String(p.name || '').trim()) throw new Error('Company name is needed');
      const st = cleanStates(p.home, p.others);
      if (!st) throw new Error('Pick the state you are in');
      const c = { id: id(), name: p.name.trim(), phone: p.phone || '', email: (p.email || '').toLowerCase(), addr: p.addr || '',
        city: p.city || '', state: p.state || '', zip: p.zip || '', created_at: new Date().toISOString(), is_test: false,
        home: st.home, others: st.others, settings: {}, levels: [{ n: 1, name: 'L1' }, { n: 2, name: 'L2' }, { n: 3, name: 'L3' }] };
      S.companies.push(c);
      S.members.push({ company_id: c.id, user_id: uid(me.email), email: me.email, name: p.your_name || '', role: 'owner' });
      log(c.id, 'company made', { name: c.name, home: c.home });
      return cj(c);
    },
    async companyPut(cid, p) {
      need(cid, 'manager');
      if ('name' in p && !String(p.name || '').trim()) throw new Error('Company name is needed');
      const c = S.companies.find((x) => x.id === cid);
      const before = Object.assign({}, c);
      ['name', 'phone', 'email', 'addr', 'city', 'state', 'zip'].forEach((k) => { if (k in p) c[k] = String(p[k] || '').trim(); });
      log(cid, 'company details changed', { before });
      return cj(c);
    },
    async statesSet(cid, home, others) {
      need(cid, 'owner');
      const st = cleanStates(home, others);
      if (!st) throw new Error('Pick the state you are in');
      const c = S.companies.find((x) => x.id === cid);
      log(cid, 'states changed', { before: { home: c.home, others: c.others }, after: st });
      c.home = st.home; c.others = st.others;
      return cj(c);
    },
    async members(cid) { need(cid, 'staff'); return list(cid); },
    async invite(cid, email, role) {
      need(cid, 'owner');
      const e = String(email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('That email doesn’t look right');
      if (S.members.some((m) => m.company_id === cid && m.email === e)) throw new Error('Already in this company');
      S.invites = S.invites.filter((x) => !(x.company_id === cid && x.email === e));
      S.invites.push({ company_id: cid, email: e, role, at: new Date().toISOString() });
      log(cid, 'invited', { email: e, role });
      return list(cid);
    },
    async inviteRemove(cid, email) { need(cid, 'owner'); S.invites = S.invites.filter((x) => !(x.company_id === cid && x.email === email)); return list(cid); },
    async memberSet(cid, user, role) {
      need(cid, 'owner');
      const m = S.members.find((x) => x.company_id === cid && x.user_id === user);
      const owners = S.members.filter((x) => x.company_id === cid && x.role === 'owner').length;
      if (m.role === 'owner' && owners <= 1 && role !== 'owner') throw new Error('A company needs at least one owner');
      if (role) m.role = role; else S.members.splice(S.members.indexOf(m), 1);
      return list(cid);
    },
    async myName(cid, name) { const m = need(cid, 'staff'); m.name = name; },
    async history(cid) { need(cid, 'manager'); return S.log.filter((x) => x.company_id === cid).slice(0, 50); },

    async levelsSet(cid, list) {
      need(cid, 'manager');
      const bad = levelsCheck(list); if (bad) throw new Error(bad);
      const c = S.companies.find((x) => x.id === cid);
      const keep = list.filter((l) => l.n).map((l) => +l.n);
      const used = S.customers.filter((x) => x.company_id === cid && x.active && !keep.includes(x.level)).length;
      if (used) throw new Error(used + ' customers are on a price level you took away. Move them to another level first');
      const before = c.levels;
      const out = c.levels.filter((l) => keep.includes(l.n)).map((l) => ({ n: l.n, name: list.find((x) => +x.n === l.n).name.trim() }));
      list.filter((l) => !l.n).forEach((l) => { let n = 1; while (out.some((x) => x.n === n)) n++; out.push({ n, name: l.name.trim() }); });
      c.levels = out.sort((a, b) => a.n - b.n);
      const s = Object.assign({}, DEFAULT_SETTINGS, c.settings);
      if (!c.levels.some((l) => l.n === s.default_level)) c.settings = Object.assign({}, c.settings, { default_level: c.levels[0].n });
      log(cid, 'price levels changed', { before, after: c.levels });
      return cj(c);
    },
    async settingsSet(cid, p) {
      need(cid, 'manager');
      const c = S.companies.find((x) => x.id === cid);
      if ('remind_days' in p && !(p.remind_days >= 0 && p.remind_days <= 120)) throw new Error('Reminders can be 0 to 120 days ahead');
      if ('default_level' in p && !c.levels.some((l) => l.n === +p.default_level)) throw new Error('Pick a price level');
      c.settings = Object.assign({}, c.settings, p);
      log(cid, 'settings changed', { after: p });
      return cj(c);
    },
    async items(cid) {
      const m = need(cid, 'staff');
      return S.items.filter((x) => x.company_id === cid).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())).map((x) => itemOut(x, m.role !== 'staff'));
    },
    async itemPut(cid, p) {
      need(cid, 'manager');
      const sizes = (p.sizes || []).map((z) => Object.assign({}, z, { n: +z.n, cost: nz(z.cost), prices: z.prices || {} }));
      const bad = itemCheck(Object.assign({}, p, { sizes })); if (bad) throw new Error(bad);
      let it = p.id && S.items.find((x) => x.id === p.id && x.company_id === cid);
      if (p.id && !it) throw new Error('Item not found');
      for (const z of sizes) {
        const u = cleanUpc(z.upc);
        const other = u && S.items.find((x) => x.company_id === cid && x !== it && x.sizes.some((s) => s.upc === u));
        if (other) throw new Error('UPC ' + u + ' is already on ' + other.name);
      }
      const isnew = !it;
      const before = it ? copy(it) : null;
      if (!it) { it = { id: id(), company_id: cid }; S.items.push(it); }
      Object.assign(it, { name: p.name.trim(), item_no: (p.item_no || '').trim(), category: p.category || 'other', nacs: (p.nacs || '').trim(),
        vendor: (p.vendor || '').trim(), unit: (p.unit || '').trim() || 'each', ml: nz(p.ml), oz: nz(p.oz), age: +p.age || 0,
        active: p.active !== false, updated_at: new Date().toISOString() });
      it.sizes = sizes.map((z) => {
        const pr = {}; Object.keys(z.prices).forEach((k) => { const v = nz(z.prices[k]); if (v != null) pr[k] = v; });
        return { id: z.id || id(), name: z.name.trim(), n: z.n, upc: cleanUpc(z.upc), cost: z.cost, prices: pr };
      });
      log(cid, isnew ? 'item added' : 'item changed', { item: it.id, name: it.name, before });
      return itemOut(it, true);
    },
    async customers(cid) {
      need(cid, 'staff');
      return S.customers.filter((x) => x.company_id === cid).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())).map((x) => custOut(x));
    },
    async customer(cid, cust) {
      need(cid, 'staff');
      const c = S.customers.find((x) => x.id === cust && x.company_id === cid);
      if (!c) throw new Error('Customer not found');
      return custOut(c, true);
    },
    async customerPut(cid, p) {
      need(cid, 'manager');
      const co = S.companies.find((x) => x.id === cid);
      const isnew = !p.id;
      if (isnew || 'name' in p) { const bad = custCheck(Object.assign({ name: '' }, p, { credit_limit: nz(p.credit_limit) })); if (bad) throw new Error(bad); }
      if ('level' in p && !co.levels.some((l) => l.n === +p.level)) throw new Error('Pick a price level');
      let c = p.id && S.customers.find((x) => x.id === p.id && x.company_id === cid);
      if (p.id && !c) throw new Error('Customer not found');
      const before = c ? copy(c) : null;
      if (!c) {
        c = { id: id(), company_id: cid, name: '', store_no: '', phone: '', email: '', addr: '', city: '', state: '', zip: '', contacts: [],
          level: Object.assign({}, DEFAULT_SETTINGS, co.settings).default_level, terms: 'cod', credit_limit: null, tobacco: true, delivery: '', route: '', rep: '',
          ship_to: '', since: null, active: true, licenses: [], created_at: new Date().toISOString() };
        S.customers.push(c);
      }
      ['name', 'store_no', 'phone', 'addr', 'city', 'state', 'zip', 'delivery', 'route', 'rep', 'ship_to'].forEach((k) => { if (k in p) c[k] = String(p[k] || '').trim(); });
      if ('email' in p) c.email = String(p.email || '').trim().toLowerCase();
      if ('contacts' in p) c.contacts = (p.contacts || []).filter((x) => (x.name || x.phone || '').trim()).map((x) => ({ name: (x.name || '').trim(), role: (x.role || '').trim(), phone: (x.phone || '').trim() }));
      if ('level' in p) c.level = +p.level;
      ['terms', 'tobacco', 'active'].forEach((k) => { if (k in p) c[k] = p[k]; });
      if ('credit_limit' in p) c.credit_limit = nz(p.credit_limit);
      if ('since' in p) c.since = p.since || null;
      log(cid, isnew ? 'customer added' : 'customer changed', { customer: c.id, name: c.name, before });
      return custOut(c, true);
    },
    async licensePut(cid, cust, p) {
      need(cid, 'manager');
      const c = S.customers.find((x) => x.id === cust && x.company_id === cid);
      if (!c) throw new Error('Customer not found');
      const before = c.licenses.find((l) => l.kind === p.kind) || null;
      c.licenses = c.licenses.filter((l) => l.kind !== p.kind);
      if ((p.number || '').trim()) c.licenses.push({ kind: p.kind, number: p.number.trim(), expires: p.expires || null, copy: !!p.copy });
      c.licenses.sort((a, b) => a.kind.localeCompare(b.kind));
      log(cid, 'license changed', { customer: c.id, kind: p.kind, before, after: c.licenses.find((l) => l.kind === p.kind) || null });
      return custOut(c, true);
    },
    async noteAdd(cid, cust, text) {
      const m = need(cid, 'staff');
      const c = S.customers.find((x) => x.id === cust && x.company_id === cid);
      if (!c) throw new Error('Customer not found');
      if (!String(text || '').trim()) throw new Error('Type a note');
      S.notes.push({ id: id(), customer_id: c.id, text: text.trim(), by: m.name || me.email, at: new Date().toISOString() });
      return custOut(c, true);
    }
  };
  return api;
}
