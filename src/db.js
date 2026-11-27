// The one door to the database. Screens call these; nothing else talks to Supabase.
// A pretend backend (makeFake) has the same calls, for tests and pictures.

import { cleanStates } from './states.js';
import { DEFAULT_SETTINGS, itemCheck, custCheck, levelsCheck, cleanUpc, priceSale, priceCredit, creditCheck, openItems, todayIso } from './rules.js';

export function makeDb(sb) {
  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args || {});
    if (error) throw new Error(plain(error.message));
    return data;
  }
  // Copies are private: each one gets a link that works for an hour.
  async function withUrls(c) {
    const list = (c && c.copies) || [];
    if (!list.length) return c;
    const { data } = await sb.storage.from('licenses').createSignedUrls(list.map((x) => x.path), 3600);
    (data || []).forEach((d, i) => { if (d && d.signedUrl) list[i].url = d.signedUrl; });
    return c;
  }
  // Item photos are public (invoices and the store app show them): each gets its plain web address.
  const pub = (it) => { if (it && it.photo) it.photo_url = sb.storage.from('item-photos').getPublicUrl(it.photo).data.publicUrl; return it; };
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
    items: async (id) => (await rpc('items_list', { p_company: id })).map(pub),
    itemPut: async (id, p) => pub(await rpc('item_put', { p_company: id, p })),
    // A photo goes up first, then the item points to it. No photo (f = null) takes it off.
    async itemPhoto(id, item, f) {
      if (!f) return pub(await rpc('item_photo_set', { p_company: id, p_item: item, p_path: '' }));
      const blob = await (await fetch(f.url)).blob();
      const path = id + '/' + item + '-' + Date.now() + '.jpg';
      const up = await sb.storage.from('item-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw new Error(plain(up.error.message));
      return pub(await rpc('item_photo_set', { p_company: id, p_item: item, p_path: path }));
    },
    customers: (id) => rpc('customers_list', { p_company: id }),
    customer: async (id, cust) => withUrls(await rpc('customer_get', { p_company: id, p_id: cust })),
    customerPut: async (id, p) => withUrls(await rpc('customer_put', { p_company: id, p })),
    licensePut: async (id, cust, p) => withUrls(await rpc('license_put', { p_company: id, p_customer: cust, p })),
    // The file goes up first (private bucket), then the database is told about it.
    async copyAdd(id, cust, kind, f) {
      const blob = await (await fetch(f.url)).blob();
      const ext = /pdf/.test(f.type) ? 'pdf' : /png/.test(f.type) ? 'png' : 'jpg';
      const path = id + '/' + cust + '/' + kind + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      const up = await sb.storage.from('licenses').upload(path, blob, { contentType: f.type, upsert: false });
      if (up.error) throw new Error(plain(up.error.message));
      return withUrls(await rpc('copy_add', { p_company: id, p_customer: cust, p_kind: kind, p: { path, name: f.name, type: f.type, size: blob.size } }));
    },
    copyRemove: async (id, cust, copy) => withUrls(await rpc('copy_remove', { p_company: id, p_customer: cust, p_copy: copy })),
    noteAdd: async (id, cust, text) => withUrls(await rpc('note_add', { p_company: id, p_customer: cust, p_text: text })),
    importStart: (id, p) => rpc('import_start', { p_company: id, p }),
    importItems: (id, imp, rows) => rpc('import_items', { p_company: id, p_import: imp, p_rows: rows }),
    importCustomers: (id, imp, rows) => rpc('import_customers', { p_company: id, p_import: imp, p_rows: rows }),
    importFinish: (id, imp) => rpc('import_finish', { p_company: id, p_import: imp }),
    imports: (id) => rpc('imports_list', { p_company: id }),
    importUndo: (id, imp) => rpc('import_undo', { p_company: id, p_import: imp }),
    // Counter (Phase 2)
    saleSave: (id, p) => rpc('sale_save', { p_company: id, p }),
    sales: (id, status) => rpc('sales_list', { p_company: id, p_status: status }),
    customerAccount: (id, cust, from, to) => rpc('customer_account', { p_company: id, p_customer: cust, p_from: from, p_to: to }),
    customerOpen: (id, cust) => rpc('customer_open', { p_company: id, p_customer: cust }),
    paymentSave: (id, p) => rpc('payment_save', { p_company: id, p }),
    paymentDeposit: (id, pay) => rpc('payment_deposit', { p_company: id, p_id: pay }),
    paymentVoid: (id, pay, why) => rpc('payment_void', { p_company: id, p_id: pay, p_why: why }),
    payments: (id, from, to) => rpc('payments_list', { p_company: id, p_from: from, p_to: to }),
    bankTodo: (id) => rpc('bank_todo', { p_company: id }),
    depositMake: (id, p) => rpc('deposit_make', { p_company: id, p }),
    deposits: (id, from, to) => rpc('deposits_list', { p_company: id, p_from: from, p_to: to }),
    depositSet: (id, dep, p) => rpc('deposit_set', { p_company: id, p_id: dep, p }),
    paymentReturned: (id, pay, why) => rpc('payment_returned', { p_company: id, p_id: pay, p_why: why }),
    saleLast: (id, cust) => rpc('sale_last', { p_company: id, p_customer: cust }),
    creditPrices: (id, cust) => rpc('credit_prices', { p_company: id, p_customer: cust }),
    saleVoid: (id, sale, why) => rpc('sale_void', { p_company: id, p_sale: sale, p_why: why }),
    upcScan: (id, upc, soldAs) => rpc('upc_unknown_scan', { p_company: id, p_upc: upc, p_sold_as: soldAs || null }),
    upcList: (id) => rpc('upc_unknown_list', { p_company: id }),
    upcDone: (id, upc, action, size) => rpc('upc_unknown_done', { p_company: id, p_upc: upc, p_action: action, p_size: size || null }),
    // Invoices (Phase 2, piece 3): everything to print it, write down what went out, and email it from the website.
    invoiceData: (id, sale) => rpc('invoice_data', { p_company: id, p_sale: sale }),
    saleSent: (id, sale, p) => rpc('sale_sent', { p_company: id, p_sale: sale, p }),
    async sendInvoice(id, sale, what) {
      const { data } = await sb.auth.getSession();
      const tok = data.session && data.session.access_token;
      if (!tok) throw new Error('Sign in again to send it.');
      let r;
      try { r = await fetch('/api/send', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ company: id, sale, what }) }); }
      catch (e) { throw new Error(plain(e.message)); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'The email couldn’t be sent. Try again.');
      return j;
    },
    async sendStatement(id, customer, from, to) {
      const { data } = await sb.auth.getSession();
      const tok = data.session && data.session.access_token;
      if (!tok) throw new Error('Sign in again to send it.');
      let r;
      try { r = await fetch('/api/send', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ company: id, statement: { customer, from, to } }) }); }
      catch (e) { throw new Error(plain(e.message)); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'The email couldn’t be sent. Try again.');
      return j;
    }
  };
}

// Database messages in plain words.
export function plain(m) {
  m = String(m || '');
  if (/rate limit|security purposes/i.test(m)) return 'Too many codes asked for. Wait a minute and try again.';
  if (/expired|invalid.*(otp|token)|token.*(invalid|expired)/i.test(m)) return 'That code is wrong or too old. Ask for a new one.';
  if (/exceeded the maximum allowed size|Payload too large/i.test(m)) return 'That file is bigger than 10 MB.';
  if (/mime type|invalid_mime/i.test(m)) return 'Pick a photo or a PDF.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No internet connection. Try again.';
  return m.replace(/^(ERROR:\s*)/, '').replace(/^./, function (c) { return c.toUpperCase(); });
}

// ----- pretend backend -----
export function makeFake(opts) {
  opts = opts || {};
  let me = opts.signedIn ? { email: opts.signedIn } : null;
  const S = { companies: [], members: [], invites: [], log: [], items: [], customers: [], notes: [], imports: [], sales: [], upcs: [], payments: [], applies: [], deposits: [] };
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
    const o = copy(it); delete o.company_id; delete o.import_id; o.cost_hidden = !cost;
    if (!cost) o.sizes.forEach((z) => { z.cost = null; });
    return o;
  }
  function custOut(c, full) {
    const o = copy(c); delete o.company_id; delete o.import_id; o.owes = Math.round(((c.opening || 0) + S.sales.filter((x) => x.customer_id === c.id && x.status === 'posted').reduce((a, x) => a + x.total, 0)
      - S.payments.filter((p) => p.customer_id === c.id && p.status === 'posted').reduce((a, p) => a + p.amount, 0)) * 100) / 100;
    o.past_due = openOf(c).past_due;
    if (full) {
      o.notes = S.notes.filter((x) => x.customer_id === c.id).slice().reverse().map((x) => ({ id: x.id, text: x.text, by: x.by, at: x.at }));
      o.history = S.log.filter((x) => x.company_id === c.company_id && x.detail.customer === c.id).slice(0, 100);
      o.copies = (S.copies || []).filter((x) => x.customer_id === c.id && !x.removed_at).slice().reverse()
        .map((x) => ({ id: x.id, kind: x.kind, name: x.name, type: x.type, url: x.url, number: x.number, expires: x.expires, by: x.by, at: x.at }));
    }
    return o;
  }
  const openOf = (c) => openItems(c, S.sales.filter((x) => x.customer_id === c.id), S.payments.filter((x) => x.customer_id === c.id), S.applies.filter((x) => x.customer_id === c.id), todayIso());
  function payOut(p) {
    const o = copy(p); delete o.company_id; const c = S.customers.find((x) => x.id === p.customer_id) || {};
    o.customer = { id: c.id, name: c.name, store_no: c.store_no, city: c.city };
    const d = p.deposit_id && S.deposits.find((x) => x.id === p.deposit_id);
    o.deposit = d ? { id: d.id, number: d.number, made_on: d.made_on, status: d.status, by: d.by_name } : null;
    o.bounced = !!p.bounced; o.deposit_id = p.deposit_id || null;
    o.applied = S.applies.filter((a) => a.from_pay === p.id || a.pay_event === p.id).map((a) => ({ to: a.to_sale, number: (S.sales.find((s) => s.id === a.to_sale) || {}).number || null, amount: a.amount, from_sale: a.from_sale || null }));
    return o;
  }
  const bankOk = (p) => !p.deposit_id && (p.method === 'cash' || p.method === 'check') && p.amount > 0 && (p.status === 'posted' || (p.status === 'held' && p.check_date <= todayIso()));
  function depOut(d) {
    const o = copy(d); delete o.company_id; delete o.held_ids;
    const ps = S.payments.filter((p) => p.deposit_id === d.id);
    o.came_back = Math.round(ps.filter((p) => p.bounced).reduce((a, p) => a + p.amount, 0) * 100) / 100;
    o.payments = ps.slice().sort((a, b) => (a.method === b.method ? (a.received === b.received ? a.number - b.number : a.received < b.received ? -1 : 1) : a.method === 'check' ? -1 : 1)).map(payOut);
    return o;
  }
  function lastPaid(cid, cust) {
    const out = {};
    S.sales.filter((x) => x.company_id === cid && x.customer_id === cust && x.status === 'posted' && (x.kind || 'invoice') === 'invoice')
      .sort((a, b) => (a.posted_at > b.posted_at ? 1 : -1))
      .forEach((x) => x.lines.forEach((l) => { if (l.size_id && +l.shipped > 0 && l.unit_price != null) out[l.size_id] = l.unit_price; }));
    return out;
  }
  function saleOut(x) {
    const o = copy(x); delete o.company_id; o.kind = o.kind || 'invoice';
    const c = S.customers.find((y) => y.id === x.customer_id) || {};
    o.customer = { id: c.id, name: c.name, store_no: c.store_no, city: c.city, level: c.level, terms: c.terms };
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
      const me2 = need(cid, 'manager');
      if ('lic_mode' in p && !['warn', 'ask', 'off'].includes(p.lic_mode)) throw new Error('Pick only warn, ask for a manager’s OK, or don’t warn at the Counter');
      if (p.lic_mode === 'off' && me2.role !== 'owner') throw new Error('Only owners can turn off the warning at the Counter');
      if ('lic_need' in p) {
        const states = [c.home].concat(c.others || []);
        for (const st of Object.keys(p.lic_need || {})) {
          if (!states.includes(st)) throw new Error('You don’t sell in ' + st);
          if (!Array.isArray(p.lic_need[st]) || p.lic_need[st].some((k) => !['resale', 'location', 'tobacco', 'vapor', 'hemp', 'beer'].includes(k))) throw new Error('Pick licenses from the list');
        }
      }
      if ('inv' in p && (+(p.inv || {}).copies || 1) > 5) throw new Error('Print 1 to 5 copies');
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
        active: p.active !== false, break_group: String(p.break_group || '').trim().slice(0, 60), updated_at: new Date().toISOString() });
      it.sizes = sizes.map((z) => {
        const pr = {}; Object.keys(z.prices).forEach((k) => { const v = nz(z.prices[k]); if (v != null) pr[k] = v; });
        const breaks = (z.breaks || []).map((b) => ({ min: +b.min, off: Math.round(+b.off * 10000) / 10000 })).sort((a, b) => a.min - b.min);
        return { id: z.id || id(), name: z.name.trim(), n: z.n, upc: cleanUpc(z.upc), cost: z.cost, prices: pr, breaks };
      });
      log(cid, isnew ? 'item added' : 'item changed', { item: it.id, name: it.name, before });
      return itemOut(it, true);
    },
    async itemPhoto(cid, itemId, f) {
      need(cid, 'manager');
      const it = S.items.find((x) => x.id === itemId && x.company_id === cid);
      if (!it) throw new Error('Item not found');
      const before = it.photo || '';
      it.photo = f ? cid + '/' + it.id + '-' + Date.now() + '.jpg' : ''; it.photo_url = f ? f.url : '';
      log(cid, f ? 'item photo added' : 'item photo removed', { item: it.id, name: it.name, before, after: it.photo });
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
      const me1 = need(cid, 'manager');
      if ('opening' in p && me1.role !== 'owner') throw new Error('Only an owner can change a starting balance');
      const co = S.companies.find((x) => x.id === cid);
      const isnew = !p.id;
      if (isnew || 'name' in p) { const bad = custCheck(Object.assign({ name: '' }, p, { credit_limit: nz(p.credit_limit) })); if (bad) throw new Error(bad); }
      if ('level' in p && !co.levels.some((l) => l.n === +p.level)) throw new Error('Pick a price level');
      let c = p.id && S.customers.find((x) => x.id === p.id && x.company_id === cid);
      if (p.id && !c) throw new Error('Customer not found');
      const before = c ? copy(c) : null;
      if (!c) {
        c = { id: id(), company_id: cid, name: '', store_no: '', phone: '', email: '', edi_email: '', acct_no: '', gets: {}, addr: '', city: '', state: '', zip: '', contacts: [],
          level: Object.assign({}, DEFAULT_SETTINGS, co.settings).default_level, terms: '', credit_limit: null, tobacco: true, delivery: '', route: '', rep: '',
          ship_to: '', since: null, active: true, licenses: [], opening: 0, opening_as_of: null, created_at: new Date().toISOString() };
        S.customers.push(c);
      }
      ['name', 'store_no', 'phone', 'addr', 'city', 'state', 'zip', 'delivery', 'route', 'rep', 'ship_to'].forEach((k) => { if (k in p) c[k] = String(p[k] || '').trim(); });
      if ('email' in p) c.email = String(p.email || '').trim().toLowerCase();
      if ('edi_email' in p) { const e = String(p.edi_email || '').trim().toLowerCase(); if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('The EDI email doesn’t look right'); c.edi_email = e; }
      if ('acct_no' in p) { const a = String(p.acct_no || '').replace(/\s/g, ''); if (!/^\d{0,6}$/.test(a)) throw new Error('The customer # for the EDI file is numbers only, at most 6'); c.acct_no = a; }
      if ('gets' in p) { c.gets = {}; ['print', 'email', 'edi'].forEach((k) => { if (p.gets && typeof p.gets[k] === 'boolean') c.gets[k] = p.gets[k]; }); }
      if ('contacts' in p) c.contacts = (p.contacts || []).filter((x) => (x.name || x.phone || '').trim()).map((x) => ({ name: (x.name || '').trim(), role: (x.role || '').trim(), phone: (x.phone || '').trim() }));
      if ('level' in p) c.level = +p.level;
      ['terms', 'tobacco', 'active'].forEach((k) => { if (k in p) c[k] = p[k]; });
      if ('credit_limit' in p) c.credit_limit = nz(p.credit_limit);
      if ('since' in p) c.since = p.since || null;
      if ('opening' in p) { c.opening = nz(p.opening) || 0; c.opening_as_of = c.opening_as_of || new Date().toISOString().slice(0, 10); }
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
    async copyAdd(cid, cust, kind, f) {
      const m = need(cid, 'manager');
      const c = S.customers.find((x) => x.id === cust && x.company_id === cid);
      if (!c) throw new Error('Customer not found');
      if (!/^image\/|^application\/pdf$/.test(f.type || '')) throw new Error('Pick a photo or a PDF');
      if ((f.size || 0) > 10 * 1024 * 1024) throw new Error('That file is bigger than 10 MB');
      const l = c.licenses.find((x) => x.kind === kind) || {};
      S.copies = S.copies || [];
      S.copies.push({ id: id(), company_id: cid, customer_id: cust, kind, name: f.name || 'copy', type: f.type, url: f.url, number: l.number || '', expires: l.expires || null,
        by: m.name || me.email, at: f.at || new Date().toISOString(), removed_at: null });
      if (l.kind) l.copy = true;
      log(cid, 'license copy added', { customer: c.id, kind, name: f.name });
      return custOut(c, true);
    },
    async copyRemove(cid, cust, copyId) {
      need(cid, 'manager');
      const c = S.customers.find((x) => x.id === cust && x.company_id === cid);
      const x = (S.copies || []).find((y) => y.id === copyId && y.customer_id === cust);
      if (!c || !x) throw new Error('Copy not found');
      x.removed_at = new Date().toISOString();
      const l = c.licenses.find((y) => y.kind === x.kind);
      if (l) l.copy = S.copies.some((y) => y.customer_id === cust && y.kind === x.kind && !y.removed_at);
      log(cid, 'license copy removed', { customer: c.id, kind: x.kind, name: x.name });
      return custOut(c, true);
    },
    async importStart(cid, p) {
      const m = need(cid, 'manager');
      const x = { id: id(), company_id: cid, kind: p.kind, file: p.file || '', added: 0, skipped: 0, balance: null, old_total: nz(p.old_total), by_name: m.name || me.email, at: new Date().toISOString(), undone_at: null };
      S.imports.unshift(x); return x.id;
    },
    async importItems(cid, imp, rows) {
      need(cid, 'manager');
      const x = S.imports.find((i) => i.id === imp && i.company_id === cid && i.kind === 'items' && !i.undone_at);
      if (!x) throw new Error('Import not found');
      let added = 0, skipped = 0;
      for (const r of rows) {
        const ups = r.sizes.map((z) => cleanUpc(z.upc)).filter(Boolean);
        if (!r.name || S.items.some((it) => it.company_id === cid && it.sizes.some((z) => ups.includes(z.upc)))) { skipped++; continue; }
        S.items.push({ id: id(), company_id: cid, import_id: imp, name: r.name, item_no: r.item_no || '', category: r.category || 'other', nacs: r.nacs || '', vendor: r.vendor || '',
          unit: r.unit || 'each', ml: null, oz: null, age: r.age || 0, active: true, updated_at: new Date().toISOString(),
          sizes: r.sizes.map((z) => ({ id: id(), name: z.name, n: z.n, upc: cleanUpc(z.upc), cost: z.cost == null ? null : z.cost, prices: z.prices || {} })) });
        added++;
      }
      x.added += added; x.skipped += skipped;
      return { added, skipped };
    },
    async importCustomers(cid, imp, rows) {
      need(cid, 'manager');
      const x = S.imports.find((i) => i.id === imp && i.company_id === cid && i.kind === 'customers' && !i.undone_at);
      if (!x) throw new Error('Import not found');
      const co = S.companies.find((c) => c.id === cid);
      const key = (n, s) => n.toLowerCase().replace(/\s+/g, ' ').trim() + '|' + String(s || '').toLowerCase().trim();
      let added = 0, skipped = 0, balance = 0;
      for (const r of rows) {
        if (!r.name || S.customers.some((c) => c.company_id === cid && key(c.name, c.store_no) === key(r.name, r.store_no))) { skipped++; continue; }
        const lv = co.levels.some((l) => l.n === r.level) ? r.level : Object.assign({}, DEFAULT_SETTINGS, co.settings).default_level;
        S.customers.push({ id: id(), company_id: cid, import_id: imp, name: r.name.trim(), store_no: r.store_no || '', phone: r.phone || '', email: r.email || '', addr: r.addr || '',
          city: r.city || '', state: r.state || '', zip: r.zip || '', contacts: r.contacts || [], level: lv, terms: r.terms || '', credit_limit: r.credit_limit == null ? null : r.credit_limit,
          tobacco: true, delivery: '', route: '', rep: '', ship_to: '', since: null, active: true, opening: r.opening || 0, opening_as_of: new Date().toISOString().slice(0, 10),
          licenses: (r.licenses || []).map((l) => ({ kind: l.kind, number: l.number, expires: l.expires || null, copy: false })), created_at: new Date().toISOString() });
        balance += r.opening || 0; added++;
      }
      x.added += added; x.skipped += skipped; x.balance = Math.round(((x.balance || 0) + balance) * 100) / 100;
      return { added, skipped, balance };
    },
    async importFinish(cid, imp) {
      need(cid, 'manager');
      const x = S.imports.find((i) => i.id === imp && i.company_id === cid);
      log(cid, 'brought in ' + x.kind, { import: x.id, file: x.file, added: x.added, skipped: x.skipped, balance: x.balance, old_total: x.old_total });
      return copy(x);
    },
    async imports(cid) { need(cid, 'manager'); return S.imports.filter((i) => i.company_id === cid).map(copy); },
    async importUndo(cid, imp) {
      need(cid, 'manager');
      const x = S.imports.find((i) => i.id === imp && i.company_id === cid);
      if (!x) throw new Error('Import not found');
      if (x.undone_at) throw new Error('This import was already taken back');
      const list = x.kind === 'items' ? S.items : S.customers;
      const before = list.length;
      for (let i = list.length - 1; i >= 0; i--) if (list[i].import_id === imp) list.splice(i, 1);
      x.undone_at = new Date().toISOString();
      log(cid, 'import taken back', { import: imp, kind: x.kind, file: x.file, removed: before - list.length });
      return { removed: before - list.length };
    },
    // ----- Counter -----
    async saleSave(cid, p) {
      const m = need(cid, 'staff');
      const who = m.name || me.email;
      if (!['suspend', 'review', 'complete', 'cancel'].includes(p.action)) throw new Error('Unknown action');
      let s = p.id && S.sales.find((x) => x.id === p.id && x.company_id === cid);
      if (p.id && !s) throw new Error('Sale not found');
      if (s && !['suspended', 'review'].includes(s.status)) throw new Error('This sale is already ' + (s.status === 'posted' ? 'an invoice' : s.status === 'void' ? 'void' : 'cancelled'));
      if (s && s.status === 'review' && m.role === 'staff') throw new Error('An owner or manager finishes sales sent for review');
      if (p.action === 'cancel') {
        if (!s) throw new Error('Nothing to cancel');
        s.status = 'cancelled'; s.updated_at = new Date().toISOString();
        log(cid, 'sale cancelled', { sale: s.id, customer: s.customer_id, total: s.total });
        return saleOut(s);
      }
      const cu = S.customers.find((x) => x.id === (p.customer_id || (s && s.customer_id)) && x.company_id === cid);
      if (!cu) throw new Error('Pick a customer');
      if (!(p.lines || []).length) throw new Error('Scan at least one item');
      const kind = (s && s.kind) || p.kind || 'invoice';
      let pr;
      if (kind === 'credit') {
        if (p.action === 'suspend') throw new Error('A credit is finished now or sent for review');
        if (p.action === 'complete' && m.role === 'staff') throw new Error('Send the credit for review: an owner or manager posts it');
        pr = priceCredit(p.lines, S.items.filter((x) => x.company_id === cid), cu.level, lastPaid(cid, cu.id));
        const bad = creditCheck(pr); if (bad) throw new Error(bad);
      } else {
        pr = priceSale(p.lines, S.items.filter((x) => x.company_id === cid), cu.level);
        const gone = pr.lines.find((l) => l.missing === 'gone'); if (gone) throw new Error('An item on this sale isn’t in your list any more');
        const np = pr.lines.find((l) => l.missing === 'price'); if (np) throw new Error(np.name + ' (' + np.size + ') has no price for this customer’s level');
        if (p.action === 'complete' && !pr.count) throw new Error('Nothing is shipped on this sale');
      }
      if (p.action === 'review' && !String(p.why || '').trim()) throw new Error('Say what the manager should check');
      const now = new Date().toISOString();
      if (!s) { s = { id: id(), company_id: cid, kind, number: null, status: 'suspended', why: '', lic_reason: '', by_name: who, void_at: null, void_by: '', void_why: '', created_at: now, sent_at: null, posted_at: null, posted_by: '', invoice_date: null }; S.sales.push(s); }
      Object.assign(s, { customer_id: cu.id, lines: pr.lines.map((l) => { const o = Object.assign({}, l); delete o.sizes; delete o.photo_url; delete o.missing; delete o.group; return o; }),
        total: pr.total, units: pr.count, updated_at: now });
      if (String(p.lic_reason || '').trim()) s.lic_reason = p.lic_reason.trim().slice(0, 200);
      if (p.action === 'suspend') { s.status = 'suspended'; log(cid, 'sale suspended', { sale: s.id, customer: cu.id, total: s.total }); }
      else if (p.action === 'review') { s.status = 'review'; s.why = p.why.trim().slice(0, 300); s.sent_at = now; log(cid, 'sale sent for review', { sale: s.id, customer: cu.id, why: s.why, total: s.total }); }
      else {
        const co = S.companies.find((x) => x.id === cid);
        co.next_invoice = co.next_invoice || 1001;
        s.invoice_date = s.status === 'review' ? (s.sent_at || now).slice(0, 10) : now.slice(0, 10);
        s.number = co.next_invoice++; s.status = 'posted'; s.posted_at = now; s.posted_by = who;
        log(cid, kind === 'credit' ? 'credit memo posted' : 'invoice posted', { sale: s.id, number: s.number, customer: cu.id, total: s.total, license_reason: s.lic_reason || null });
      }
      return saleOut(s);
    },
    async customerOpen(cid, cust) {
      need(cid, 'staff');
      const c = S.customers.find((x) => x.id === cust && x.company_id === cid);
      if (!c) throw new Error('Customer not found');
      return copy(openOf(c));
    },
    async paymentSave(cid, p) {
      const mm = need(cid, 'staff'), myName = () => mm.name || me.email;
      const c = S.customers.find((x) => x.id === p.customer_id && x.company_id === cid);
      if (!c) throw new Error('Pick a customer');
      const m = p.method || '', amt = Math.round((Number(p.amount) || 0) * 100) / 100, t = todayIso();
      if (!['cash', 'check', 'card', 'ach', 'other'].includes(m)) throw new Error('Pick how they paid');
      if (amt < 0) throw new Error('The amount can’t be minus');
      if (m === 'check' && !String(p.check_no || '').trim()) throw new Error('Type the check number');
      if (p.received && p.received > t) throw new Error('The day it was received can’t be in the future');
      const op = openOf(c), use = (p.use || []).filter((u) => Number(u.amount) > 0), payTo = (p.pay || []).filter((x) => Number(x.amount) > 0);
      let totUse = 0, totPay = 0;
      use.forEach((u) => { const src = op.credits.find((x) => x.kind === u.kind && (x.id || '') === (u.id || '')); if (!src) throw new Error('That store credit isn’t there any more'); if (u.amount > src.left + 0.004) throw new Error('Only ' + src.left + ' of that credit is left'); totUse += Number(u.amount); });
      payTo.forEach((x) => { const src = op.invoices.find((y) => (y.id || '') === (x.to || '')); if (!src) throw new Error('One of those invoices is already paid'); if (x.amount > src.open + 0.004) throw new Error('That’s more than what’s left on invoice ' + (src.number || '(starting balance)')); totPay += Number(x.amount); });
      totUse = Math.round(totUse * 100) / 100; totPay = Math.round(totPay * 100) / 100;
      if (totPay > totUse + amt + 0.004) throw new Error('You’re paying ' + totPay.toFixed(2) + ' but have ' + (totUse + amt).toFixed(2) + ' to pay with');
      if (amt === 0 && totUse === 0) throw new Error('Type how much they paid');
      const co = S.companies.find((x) => x.id === cid); co.next_payment = co.next_payment || 1001;
      const held = m === 'check' && p.check_date && p.check_date > t;
      const pay = { id: id(), company_id: cid, customer_id: c.id, number: co.next_payment++, status: held ? 'held' : 'posted', method: m, amount: amt,
        check_no: String(p.check_no || '').trim(), check_date: p.check_date || null, received: p.received || t, note: String(p.note || '').trim(), sale_id: p.sale_id || null,
        by_name: myName(cid), created_at: new Date().toISOString(), deposited_at: null, deposited_by: '', void_at: null, void_by: '', void_why: '' };
      S.payments.push(pay);
      const fund = use.map((u) => ({ kind: u.kind, id: u.id, left: Number(u.amount) }));
      payTo.forEach((x) => {
        let want = Number(x.amount);
        while (want > 0.004) {
          const f = fund.find((y) => y.left > 0.004);
          if (!f) { S.applies.push({ customer_id: c.id, from_pay: pay.id, from_sale: null, to_sale: x.to || null, amount: Math.round(want * 100) / 100, pay_event: pay.id }); want = 0; break; }
          const take = Math.round(Math.min(want, f.left) * 100) / 100;
          if (f.kind === 'credit') S.applies.push({ customer_id: c.id, from_pay: null, from_sale: f.id, to_sale: x.to || null, amount: take, pay_event: pay.id });
          if (f.kind === 'payment') S.applies.push({ customer_id: c.id, from_pay: f.id, from_sale: null, to_sale: x.to || null, amount: take, pay_event: pay.id });
          f.left = Math.round((f.left - take) * 100) / 100; want = Math.round((want - take) * 100) / 100;
        }
      });
      log(cid, held ? 'post-dated check taken' : 'payment taken', { payment: pay.id, number: pay.number, customer: c.id, amount: amt, method: m, paid: totPay });
      return payOut(pay);
    },
    async paymentDeposit(cid, pid) {
      const mm = need(cid, 'staff'), myName = () => mm.name || me.email;
      const x = S.payments.find((y) => y.id === pid && y.company_id === cid);
      if (!x) throw new Error('Payment not found');
      if (x.status !== 'held') throw new Error('This check isn’t waiting');
      if (x.check_date > todayIso()) throw new Error('This check is dated ' + x.check_date + '; deposit it on or after that day');
      x.status = 'posted'; x.deposited_at = new Date().toISOString(); x.deposited_by = myName(cid);
      log(cid, 'post-dated check deposited', { payment: x.id, number: x.number, customer: x.customer_id, amount: x.amount });
      return payOut(x);
    },
    async paymentVoid(cid, pid, why) {
      const mm = need(cid, 'manager'), myName = () => mm.name || me.email;
      const x = S.payments.find((y) => y.id === pid && y.company_id === cid);
      if (!x) throw new Error('Payment not found');
      if (x.status === 'void') throw new Error('This is already void');
      if (x.deposit_id) { const dd = S.deposits.find((y) => y.id === x.deposit_id); throw new Error('It’s in deposit #' + dd.number + ': undo the deposit first' + (x.method === 'check' ? ', or mark that the check came back' : '')); }
      if (!String(why || '').trim()) throw new Error('Say why it’s void');
      x.status = 'void'; x.void_at = new Date().toISOString(); x.void_by = myName(cid); x.void_why = String(why).trim();
      S.applies = S.applies.filter((a) => !(a.pay_event === x.id && a.from_pay !== x.id));
      log(cid, 'payment voided', { payment: x.id, number: x.number, customer: x.customer_id, amount: x.amount, why: x.void_why });
      return payOut(x);
    },
    async bankTodo(cid) {
      need(cid, 'staff');
      return S.payments.filter((p) => p.company_id === cid && bankOk(p)).sort((a, b) => (a.received === b.received ? a.number - b.number : a.received < b.received ? -1 : 1)).map(payOut);
    },
    async depositMake(cid, p) {
      const mm = need(cid, 'staff'), who = mm.name || me.email;
      const ids = Array.from(new Set(p.ids || [])), md = p.made_on || todayIso();
      if (!ids.length) throw new Error('Tick what goes in the deposit');
      if (md > todayIso()) throw new Error('The deposit can’t be dated in the future');
      const L = ids.map((i) => S.payments.find((x) => x.id === i && x.company_id === cid));
      if (L.some((x) => !x)) throw new Error('Payment not found');
      L.forEach((x) => { if (!bankOk(x)) throw new Error('Payment ' + x.number + ' can’t go in a deposit any more'); });
      const co = S.companies.find((x) => x.id === cid); co.next_deposit = co.next_deposit || 1001;
      const r2 = (v) => Math.round(v * 100) / 100, cash = r2(L.filter((x) => x.method === 'cash').reduce((a, x) => a + x.amount, 0)), checks = r2(L.filter((x) => x.method === 'check').reduce((a, x) => a + x.amount, 0));
      const d = { id: id(), company_id: cid, number: co.next_deposit++, made_on: md, status: 'made', cash, checks, total: r2(cash + checks), n_checks: L.filter((x) => x.method === 'check').length,
        bank_ref: '', held_ids: L.filter((x) => x.status === 'held').map((x) => x.id), by_name: who, created_at: new Date().toISOString(), confirmed_at: null, confirmed_by: '', undone_at: null, undone_by: '' };
      S.deposits.push(d);
      L.forEach((x) => { x.deposit_id = d.id; if (x.status === 'held') { x.status = 'posted'; x.deposited_at = new Date().toISOString(); x.deposited_by = who; } });
      log(cid, 'deposit made', { deposit: d.id, number: d.number, cash, checks, total: d.total, payments: L.length });
      return depOut(d);
    },
    async deposits(cid, from, to) {
      need(cid, 'staff');
      if (!from || !to || to < from) throw new Error('Pick the dates');
      const mine = S.deposits.filter((d) => d.company_id === cid);
      return { rows: mine.filter((d) => d.made_on >= from && d.made_on <= to).sort((a, b) => (a.made_on === b.made_on ? b.number - a.number : a.made_on < b.made_on ? 1 : -1)).map(depOut),
        waiting: mine.filter((d) => d.status === 'made').sort((a, b) => a.number - b.number).map(depOut) };
    },
    async depositSet(cid, did, p) {
      const act = p.action || '', mm = need(cid, act === 'ref' ? 'staff' : 'manager'), who = mm.name || me.email;
      const d = S.deposits.find((x) => x.id === did && x.company_id === cid);
      if (!d) throw new Error('Deposit not found');
      if (act === 'ref') { if (d.status === 'undone') throw new Error('This deposit was undone'); d.bank_ref = String(p.bank_ref || '').trim().slice(0, 40); }
      else if (act === 'confirm') { if (d.status !== 'made') throw new Error('Only a deposit waiting for the bank can be confirmed'); d.status = 'confirmed'; d.confirmed_at = new Date().toISOString(); d.confirmed_by = who; log(cid, 'deposit confirmed', { deposit: d.id, number: d.number, total: d.total }); }
      else if (act === 'unconfirm') { if (d.status !== 'confirmed') throw new Error('This deposit isn’t confirmed'); d.status = 'made'; d.confirmed_at = null; d.confirmed_by = ''; log(cid, 'deposit not confirmed after all', { deposit: d.id, number: d.number }); }
      else if (act === 'undo') {
        if (d.status !== 'made') throw new Error('Only a deposit waiting for the bank can be undone');
        if (S.payments.some((x) => x.deposit_id === d.id && x.bounced)) throw new Error('A check in this deposit came back; it can’t be undone');
        S.payments.filter((x) => d.held_ids.includes(x.id) && x.status === 'posted').forEach((x) => { x.status = 'held'; x.deposited_at = null; x.deposited_by = ''; });
        S.payments.filter((x) => x.deposit_id === d.id).forEach((x) => { x.deposit_id = null; });
        d.status = 'undone'; d.undone_at = new Date().toISOString(); d.undone_by = who; log(cid, 'deposit undone', { deposit: d.id, number: d.number, total: d.total });
      } else throw new Error('Unknown action');
      return depOut(d);
    },
    async paymentReturned(cid, pid, why) {
      const mm = need(cid, 'manager'), who = mm.name || me.email;
      const x = S.payments.find((y) => y.id === pid && y.company_id === cid);
      if (!x) throw new Error('Payment not found');
      if (x.method !== 'check' || x.status !== 'posted' || !x.deposit_id) throw new Error('Only a check in a deposit can come back');
      if (!String(why || '').trim()) throw new Error('Say why it came back');
      x.status = 'void'; x.bounced = true; x.void_at = new Date().toISOString(); x.void_by = who; x.void_why = 'Check came back: ' + String(why).trim();
      S.applies = S.applies.filter((a) => !(a.pay_event === x.id && a.from_pay !== x.id));
      log(cid, 'check came back', { payment: x.id, number: x.number, customer: x.customer_id, amount: x.amount, why: String(why).trim() });
      return payOut(x);
    },
    async payments(cid, from, to) {
      need(cid, 'staff');
      if (!from || !to || to < from) throw new Error('Pick the dates');
      const mine = S.payments.filter((x) => x.company_id === cid);
      return { rows: mine.filter((x) => x.received >= from && x.received <= to).sort((a, b) => (a.received === b.received ? b.number - a.number : a.received < b.received ? 1 : -1)).map(payOut),
        held: mine.filter((x) => x.status === 'held').sort((a, b) => (a.check_date < b.check_date ? -1 : 1)).map(payOut) };
    },
    async customerAccount(cid, cust, from, to) {
      need(cid, 'staff');
      const c = S.customers.find((x) => x.id === cust && x.company_id === cid);
      if (!c) throw new Error('Customer not found');
      if (!from || !to || to < from) throw new Error('Pick the dates');
      const mine = S.sales.filter((x) => x.company_id === cid && x.customer_id === cust && ['posted', 'void'].includes(x.status));
      const before = Math.round(((c.opening || 0) + mine.filter((x) => x.status === 'posted' && x.invoice_date < from).reduce((a, x) => a + x.total, 0)) * 100) / 100;
      const rows = mine.filter((x) => x.invoice_date >= from && x.invoice_date <= to).sort((a, b) => (a.invoice_date === b.invoice_date ? a.number - b.number : a.invoice_date < b.invoice_date ? -1 : 1))
        .map((x) => ({ id: x.id, kind: x.kind || 'invoice', status: x.status, number: x.number, date: x.invoice_date, total: x.total, units: x.units, lines: (x.lines || []).length, by: x.posted_by, void_at: x.void_at || null, void_by: x.void_by || '', void_why: x.void_why || '' }));
      const pm = S.payments.filter((x) => x.customer_id === cust);
      const bef2 = Math.round((before - pm.filter((x) => x.status === 'posted' && x.received < from).reduce((a, x) => a + x.amount, 0)) * 100) / 100;
      const payments = pm.filter((x) => x.received >= from && x.received <= to).sort((a, b) => (a.received === b.received ? a.number - b.number : a.received < b.received ? -1 : 1))
        .map((x) => ({ id: x.id, kind: 'payment', status: x.status, number: x.number, date: x.received, total: -x.amount, method: x.method, check_no: x.check_no, check_date: x.check_date, by: x.by_name, void_at: x.void_at, void_by: x.void_by, void_why: x.void_why, note: x.note }));
      return { before: bef2, opening: c.opening || 0, rows, payments, open: copy(openOf(c)) };
    },
    async sales(cid, status) {
      const m = need(cid, 'staff');
      if (!['suspended', 'review', 'posted'].includes(status)) throw new Error('Unknown list');
      if (status === 'review' && m.role === 'staff') throw new Error('Only owners and managers see sales sent for review');
      return S.sales.filter((x) => x.company_id === cid && (x.status === status || (status === 'posted' && x.status === 'void'))).sort((a, b) => (b.created_at > a.created_at ? 1 : -1)).map(saleOut);
    },
    async invoiceData(cid, sale) {
      need(cid, 'staff');
      const x = S.sales.find((y) => y.id === sale && y.company_id === cid);
      if (!x) throw new Error('Invoice not found');
      if (!['posted', 'void'].includes(x.status)) throw new Error('Only a completed sale is an invoice');
      const c = S.customers.find((y) => y.id === x.customer_id);
      return { sale: saleOut(x), customer: custOut(c), company: cj(S.companies.find((y) => y.id === cid)) };
    },
    async saleSent(cid, sale, p) {
      const m = need(cid, 'staff');
      const x = S.sales.find((y) => y.id === sale && y.company_id === cid && ['posted', 'void'].includes(y.status));
      if (!x) throw new Error('Invoice not found');
      x.sends = (x.sends || []).concat([{ kind: p.kind, to: p.to || '', ok: p.ok !== false, err: p.err || '', by: m.name || me.email, at: new Date().toISOString() }]).slice(-50);
      if (p.kind === 'email' || p.kind === 'edi') log(cid, p.ok === false ? 'invoice email failed' : 'invoice emailed', { sale, kind: p.kind, to: p.to });
      return saleOut(x);
    },
    // The pretend website: writes down what would have been emailed (S.mail) instead of sending.
    async sendStatement(cid, customer, from, to) {
      need(cid, 'staff');
      const c = S.customers.find((x) => x.id === customer && x.company_id === cid);
      if (!c) throw new Error('Customer not found');
      const em = (c.inv_email || c.email || '').trim();
      if (!em) throw new Error('This store has no email.');
      (S.mail = S.mail || []).push({ kind: 'statement', to: em, customer, from, upto: to });
      log(cid, 'statement emailed', { customer, to: em, from, upto: to });
      return { to: em };
    },
    async sendInvoice(cid, sale, what) {
      const d = await this.invoiceData(cid, sale), c = d.customer, out = [];
      (S.mail = S.mail || []);
      if (what.email) { const to = c.email; if (!to) throw new Error('This store has no email for invoices'); S.mail.push({ kind: 'email', to, sale }); out.push({ kind: 'email', to, ok: true }); await this.saleSent(cid, sale, { kind: 'email', to }); }
      if (what.edi) { const to = c.edi_email; if (!to) throw new Error('This store has no EDI email'); S.mail.push({ kind: 'edi', to, sale }); out.push({ kind: 'edi', to, ok: true }); await this.saleSent(cid, sale, { kind: 'edi', to }); }
      return { sent: out, sale: (await this.invoiceData(cid, sale)).sale };
    },
    async saleLast(cid, cust) {
      need(cid, 'staff');
      const l = S.sales.filter((x) => x.company_id === cid && x.customer_id === cust && x.status === 'posted' && (x.kind || 'invoice') === 'invoice').sort((a, b) => (b.posted_at > a.posted_at ? 1 : -1))[0];
      return l ? saleOut(l) : null;
    },
    async creditPrices(cid, cust) {
      need(cid, 'staff');
      if (!S.customers.some((x) => x.id === cust && x.company_id === cid)) throw new Error('Customer not found');
      return lastPaid(cid, cust);
    },
    async saleVoid(cid, sale, why) {
      const m = need(cid, 'manager');
      const x = S.sales.find((y) => y.id === sale && y.company_id === cid);
      if (!x) throw new Error('Invoice not found');
      if (x.status === 'void') throw new Error('This is already void');
      if (x.status !== 'posted') throw new Error('Only a posted invoice or credit can be voided');
      if (!String(why || '').trim()) throw new Error('Say why it’s void');
      Object.assign(x, { status: 'void', void_at: new Date().toISOString(), void_by: m.name || me.email, void_why: why.trim().slice(0, 300) });
      log(cid, x.kind === 'credit' ? 'credit memo voided' : 'invoice voided', { sale: x.id, number: x.number, customer: x.customer_id, total: x.total, why: x.void_why });
      return saleOut(x);
    },
    async upcScan(cid, upc, soldAs) {
      const m = need(cid, 'staff');
      const u = String(upc || '').replace(/\D/g, '');
      if (u.length < 6 || u.length > 14) return;
      let x = S.upcs.find((y) => y.company_id === cid && y.upc === u);
      const now = new Date().toISOString();
      if (!x) { x = { company_id: cid, upc: u, times: 0, first_at: now, last_at: now, last_by: '', sold_as: null, sold_by: '', status: 'open' }; S.upcs.push(x); }
      if (soldAs) { x.sold_as = soldAs; x.sold_by = m.name || me.email; } else { x.times++; x.last_at = now; x.last_by = m.name || me.email; }
      x.status = 'open';
    },
    async upcList(cid) {
      need(cid, 'manager');
      return S.upcs.filter((x) => x.company_id === cid && x.status === 'open' && !S.items.some((it) => it.company_id === cid && it.sizes.some((z) => z.upc === x.upc)))
        .sort((a, b) => (b.last_at > a.last_at ? 1 : -1))
        .map((x) => { const it = S.items.find((i) => i.id === x.sold_as); return Object.assign(copy(x), { sold_as_name: it ? it.name : null }); });
    },
    async upcDone(cid, upc, action, sizeId) {
      need(cid, 'manager');
      const x = S.upcs.find((y) => y.company_id === cid && y.upc === upc);
      if (action === 'ignore') { if (x) x.status = 'ignored'; log(cid, 'barcode ignored', { upc }); return api.upcList(cid); }
      let it = null, z = null;
      S.items.forEach((i) => { if (i.company_id === cid) i.sizes.forEach((y) => { if (y.id === sizeId) { it = i; z = y; } }); });
      if (!z) throw new Error('Pick a size');
      if (z.upc) throw new Error('That size already has a barcode — pick another size or add a size to the item');
      if (S.items.some((i) => i.company_id === cid && i.sizes.some((y) => y.upc === upc))) throw new Error('That barcode is already on an item');
      z.upc = upc; if (x) x.status = 'added';
      log(cid, 'barcode added', { upc, item: it.id, name: it.name, size: z.name });
      return api.upcList(cid);
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
