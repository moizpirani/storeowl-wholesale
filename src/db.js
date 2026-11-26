// The one door to the database. Screens call these; nothing else talks to Supabase.
// A pretend backend (makeFake) has the same calls, for tests and pictures.

import { cleanStates } from './states.js';

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
    history: (id) => rpc('change_log_list', { p_company: id, p_limit: 50 })
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
  const S = { companies: [], members: [], invites: [], log: [] };
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
    return Object.assign({}, c, { role: m ? m.role : null, others: c.others.slice() });
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
        home: st.home, others: st.others };
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
    async history(cid) { need(cid, 'manager'); return S.log.filter((x) => x.company_id === cid).slice(0, 50); }
  };
  return api;
}
