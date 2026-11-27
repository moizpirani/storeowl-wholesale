-- StoreOwl Wholesale: the whole database. Safe to run again.
-- Rule (same as StoreOwl): the app never reads or writes tables directly. Every call goes through a
-- security-definer function that checks who is signed in and which company they belong to.

-- ===== Phase 0: companies, people, states, change history (2026-11-26) =====

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  phone text not null default '',
  email text not null default '',            -- where customers reply to invoices
  addr text not null default '',
  city text not null default '',
  state text not null default '',            -- mailing address state (not the same as the states they sell in)
  zip text not null default '',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  is_test boolean not null default false
);

create table if not exists company_members (
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null,
  email text not null default '',
  name text not null default '',
  role text not null check (role in ('owner','manager','staff')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index if not exists company_members_user on company_members(user_id);

-- The states a company sells in. Exactly one home state. Phase 4 hangs each state's rules on this row.
create table if not exists company_states (
  company_id uuid not null references companies(id) on delete cascade,
  state text not null check (state ~ '^[A-Z]{2}$'),
  is_home boolean not null default false,
  added_at timestamptz not null default now(),
  added_by uuid,
  primary key (company_id, state)
);
create unique index if not exists company_states_one_home on company_states(company_id) where is_home;

-- An invite waits for that email to sign in, then becomes a member.
create table if not exists company_invites (
  company_id uuid not null references companies(id) on delete cascade,
  email text not null check (email = lower(email) and email like '%_@_%'),
  role text not null check (role in ('owner','manager','staff')),
  invited_by uuid,
  created_at timestamptz not null default now(),
  primary key (company_id, email)
);

-- Who changed what, for every company (wholesalers need this for audits).
create table if not exists change_log (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  at timestamptz not null default now(),
  by_user uuid,
  by_name text not null default '',
  what text not null,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists change_log_company on change_log(company_id, at desc);

alter table companies enable row level security;
alter table company_members enable row level security;
alter table company_states enable row level security;
alter table company_invites enable row level security;
alter table change_log enable row level security;
revoke all on companies, company_members, company_states, company_invites, change_log from anon, authenticated;

-- ----- helpers -----
create or replace function _me() returns uuid language sql stable as $$ select auth.uid() $$;
create or replace function _my_email() returns text language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function _role_in(p_company uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from company_members where company_id = p_company and user_id = auth.uid() $$;

-- Refuses unless the signed-in person has at least this role (owner > manager > staff).
create or replace function _need(p_company uuid, p_min text) returns text
language plpgsql stable security definer set search_path = public as $$
declare r text := _role_in(p_company); rank int; need int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if r is null then raise exception 'no access to this company'; end if;
  rank := case r when 'owner' then 3 when 'manager' then 2 else 1 end;
  need := case p_min when 'owner' then 3 when 'manager' then 2 else 1 end;
  if rank < need then raise exception 'only % can do this', case p_min when 'owner' then 'an owner' else 'a manager or owner' end; end if;
  return r;
end $$;

create or replace function _log(p_company uuid, p_what text, p_detail jsonb) returns void
language sql security definer set search_path = public as $$
  insert into change_log(company_id, by_user, by_name, what, detail)
  select p_company, auth.uid(),
    coalesce((select nullif(name,'') from company_members where company_id = p_company and user_id = auth.uid()), _my_email()),
    p_what, coalesce(p_detail, '{}'::jsonb) $$;

create or replace function _clean_state(s text) returns text language sql immutable as $$
  select case when upper(trim(coalesce(s,''))) in ('AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
    'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA',
    'RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY') then upper(trim(s)) end $$;

create or replace function _company_json(p_company uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'addr', c.addr, 'city', c.city,
    'state', c.state, 'zip', c.zip, 'created_at', c.created_at, 'is_test', c.is_test,
    'role', _role_in(c.id),
    'home', (select state from company_states where company_id = c.id and is_home),
    'others', coalesce((select jsonb_agg(state order by state) from company_states where company_id = c.id and not is_home), '[]'::jsonb))
  from companies c where c.id = p_company $$;

-- ----- sign in -----
-- Run after every sign-in: turns waiting invites for this email into memberships, then lists the companies.
create or replace function my_companies() returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := _my_email(); u uuid := auth.uid(); inv record;
begin
  if u is null then raise exception 'not signed in'; end if;
  if e <> '' then
    for inv in delete from company_invites where email = e returning * loop
      insert into company_members(company_id, user_id, email, role) values (inv.company_id, u, e, inv.role)
        on conflict (company_id, user_id) do nothing;
      perform _log(inv.company_id, 'joined', jsonb_build_object('email', e, 'role', inv.role));
    end loop;
  end if;
  return coalesce((select jsonb_agg(_company_json(m.company_id) order by c.name)
    from company_members m join companies c on c.id = m.company_id where m.user_id = u), '[]'::jsonb);
end $$;

-- ----- company setup -----
-- p: {name, phone, email, addr, city, state, zip, home, others[], your_name}
create or replace function create_company(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); cid uuid; h text := _clean_state(p->>'home'); s text; made int;
begin
  if u is null then raise exception 'not signed in'; end if;
  if length(trim(coalesce(p->>'name',''))) = 0 then raise exception 'company name is needed'; end if;
  if h is null then raise exception 'pick the state you are in'; end if;
  select count(*) into made from companies where created_by = u and created_at > now() - interval '1 day';
  if made >= 3 then raise exception 'too many companies made today'; end if;
  insert into companies(name, phone, email, addr, city, state, zip, created_by)
    values (trim(p->>'name'), coalesce(trim(p->>'phone'),''), lower(coalesce(trim(p->>'email'),'')), coalesce(trim(p->>'addr'),''),
      coalesce(trim(p->>'city'),''), coalesce(_clean_state(p->>'state'),''), coalesce(trim(p->>'zip'),''), u)
    returning id into cid;
  insert into company_members(company_id, user_id, email, name, role)
    values (cid, u, _my_email(), coalesce(trim(p->>'your_name'),''), 'owner');
  insert into company_states(company_id, state, is_home, added_by) values (cid, h, true, u);
  for s in select distinct _clean_state(x) from jsonb_array_elements_text(coalesce(p->'others','[]'::jsonb)) x loop
    if s is not null and s <> h then insert into company_states(company_id, state, is_home, added_by) values (cid, s, false, u); end if;
  end loop;
  perform _levels_ensure(cid);
  perform _log(cid, 'company made', jsonb_build_object('name', trim(p->>'name'), 'home', h));
  return _company_json(cid);
end $$;

-- Owners and managers change the company's details. Only the keys sent change.
create or replace function company_put(p_company uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare before jsonb;
begin
  perform _need(p_company, 'manager');
  if p ? 'name' and length(trim(coalesce(p->>'name',''))) = 0 then raise exception 'company name is needed'; end if;
  select to_jsonb(c) - 'id' - 'created_by' - 'created_at' - 'is_test' into before from companies c where id = p_company;
  update companies set
    name  = case when p ? 'name'  then trim(p->>'name') else name end,
    phone = case when p ? 'phone' then trim(coalesce(p->>'phone','')) else phone end,
    email = case when p ? 'email' then lower(trim(coalesce(p->>'email',''))) else email end,
    addr  = case when p ? 'addr'  then trim(coalesce(p->>'addr','')) else addr end,
    city  = case when p ? 'city'  then trim(coalesce(p->>'city','')) else city end,
    state = case when p ? 'state' then coalesce(_clean_state(p->>'state'),'') else state end,
    zip   = case when p ? 'zip'   then trim(coalesce(p->>'zip','')) else zip end
  where id = p_company;
  perform _log(p_company, 'company details changed', jsonb_build_object('before', before));
  return _company_json(p_company);
end $$;

-- Owners only: the home state and the other states. A state taken off keeps its history (rows come back if re-added).
create or replace function company_states_set(p_company uuid, p_home text, p_others jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h text := _clean_state(p_home); u uuid := auth.uid(); want text[]; before jsonb;
begin
  perform _need(p_company, 'owner');
  if h is null then raise exception 'pick the state you are in'; end if;
  select array_agg(distinct s) into want from (select _clean_state(x) s from jsonb_array_elements_text(coalesce(p_others,'[]'::jsonb)) x) t
    where s is not null and s <> h;
  want := coalesce(want, '{}');
  before := _company_json(p_company);
  delete from company_states where company_id = p_company and state <> h and not (state = any(want));
  update company_states set is_home = false where company_id = p_company and is_home and state <> h;
  insert into company_states(company_id, state, is_home, added_by) values (p_company, h, true, u)
    on conflict (company_id, state) do update set is_home = true;
  insert into company_states(company_id, state, is_home, added_by) select p_company, s, false, u from unnest(want) s
    on conflict (company_id, state) do nothing;
  perform _log(p_company, 'states changed', jsonb_build_object('before', jsonb_build_object('home', before->'home', 'others', before->'others'),
    'after', jsonb_build_object('home', h, 'others', to_jsonb(want))));
  return _company_json(p_company);
end $$;

-- ----- people -----
create or replace function members_list(p_company uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _need(p_company, 'staff');
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'name', name, 'role', role,
      'me', user_id = auth.uid()) order by case role when 'owner' then 1 when 'manager' then 2 else 3 end, email)
      from company_members where company_id = p_company), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('email', email, 'role', role, 'at', created_at) order by created_at)
      from company_invites where company_id = p_company), '[]'::jsonb));
end $$;

create or replace function invite_put(p_company uuid, p_email text, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(coalesce(p_email,'')));
begin
  perform _need(p_company, 'owner');
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'that email doesn''t look right'; end if;
  if p_role not in ('owner','manager','staff') then raise exception 'pick a role'; end if;
  if exists (select 1 from company_members where company_id = p_company and email = e) then raise exception 'already in this company'; end if;
  insert into company_invites(company_id, email, role, invited_by) values (p_company, e, p_role, auth.uid())
    on conflict (company_id, email) do update set role = excluded.role;
  perform _log(p_company, 'invited', jsonb_build_object('email', e, 'role', p_role));
  return members_list(p_company);
end $$;

create or replace function invite_remove(p_company uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _need(p_company, 'owner');
  delete from company_invites where company_id = p_company and email = lower(trim(p_email));
  perform _log(p_company, 'invite removed', jsonb_build_object('email', lower(trim(p_email))));
  return members_list(p_company);
end $$;

-- Owners change a person's role or remove them. The last owner can't be changed or removed.
create or replace function member_set(p_company uuid, p_user uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare old text; owners int;
begin
  perform _need(p_company, 'owner');
  select role into old from company_members where company_id = p_company and user_id = p_user;
  if old is null then raise exception 'not in this company'; end if;
  if p_role is not null and p_role not in ('owner','manager','staff') then raise exception 'pick a role'; end if;
  select count(*) into owners from company_members where company_id = p_company and role = 'owner';
  if old = 'owner' and owners <= 1 and coalesce(p_role,'') <> 'owner' then raise exception 'a company needs at least one owner'; end if;
  if p_role is null then delete from company_members where company_id = p_company and user_id = p_user;
  else update company_members set role = p_role where company_id = p_company and user_id = p_user; end if;
  perform _log(p_company, case when p_role is null then 'person removed' else 'role changed' end,
    jsonb_build_object('user', p_user, 'before', old, 'after', p_role));
  return members_list(p_company);
end $$;

-- Anyone in the company sets their own name (shown in the change history).
create or replace function my_name_set(p_company uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _need(p_company, 'staff');
  update company_members set name = left(trim(coalesce(p_name,'')), 80) where company_id = p_company and user_id = auth.uid();
end $$;

create or replace function change_log_list(p_company uuid, p_limit int default 50) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _need(p_company, 'manager');
  return coalesce((select jsonb_agg(jsonb_build_object('at', at, 'by', by_name, 'what', what, 'detail', detail) order by at desc, id desc)
    from (select * from change_log where company_id = p_company order by at desc, id desc limit least(greatest(coalesce(p_limit,50),1),200)) l),
    '[]'::jsonb);
end $$;


-- ===== Phase 1: price levels, items, customers, licenses, notes (2026-11-26) =====

alter table companies add column if not exists settings jsonb not null default '{}'::jsonb;

-- Each company names its own price levels (private codes like "L1" or "Route 2", never shown to customers).
create table if not exists price_levels (
  company_id uuid not null references companies(id) on delete cascade,
  n int not null check (n between 1 and 6),
  name text not null check (length(trim(name)) between 1 and 20),
  primary key (company_id, n)
);

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  item_no text not null default '',
  category text not null default 'other' check (category in ('cigarettes','cigars','otp','snuff','vapor','pouches','hemp','beer','other')),
  nacs text not null default '',
  vendor text not null default '',
  unit text not null default 'each',        -- stock is counted in this (the smallest size): pack, can, each…
  ml numeric(10,2),                          -- vapor liquid per unit (for per-ml taxes)
  oz numeric(10,3),                          -- weight per unit (for per-ounce taxes)
  age int not null default 0 check (age in (0,18,21)),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists items_company on items(company_id, name);

-- The sizes an item is sold in. n = how many units (the item's `unit`) are in this size.
create table if not exists item_sizes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  pos int not null default 0,
  name text not null check (length(trim(name)) between 1 and 40),
  n int not null check (n >= 1),
  upc text not null default '' check (upc ~ '^[0-9]*$'),
  cost numeric(12,4),
  prices jsonb not null default '{}'::jsonb      -- {"1": 34.20, "2": 33.90}  (price level n → price)
);
create index if not exists item_sizes_item on item_sizes(item_id, pos);
create unique index if not exists item_sizes_upc on item_sizes(company_id, upc) where upc <> '';

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  store_no text not null default '',
  phone text not null default '',
  email text not null default '',
  addr text not null default '',
  city text not null default '',
  state text not null default '',
  zip text not null default '',
  contacts jsonb not null default '[]'::jsonb,   -- [{name, role, phone}]
  level int not null default 1,
  terms text not null default 'cod' check (terms in ('cod','advance','net7','net10','net14','net30')),
  credit_limit numeric(12,2),
  tobacco boolean not null default true,          -- buys tobacco (then a tobacco license is needed)
  delivery text not null default '',
  route text not null default '',
  rep text not null default '',
  ship_to text not null default '',
  since date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customers_company on customers(company_id, name);

create table if not exists customer_licenses (
  customer_id uuid not null references customers(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null check (kind in ('resale','location','tobacco','vapor','hemp','beer')),
  number text not null default '',
  expires date,
  copy boolean not null default false,             -- a copy is on file
  updated_at timestamptz not null default now(),
  primary key (customer_id, kind)
);

create table if not exists customer_notes (
  id bigint generated always as identity primary key,
  customer_id uuid not null references customers(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  text text not null check (length(trim(text)) between 1 and 2000),
  by_name text not null default '',
  at timestamptz not null default now()
);
create index if not exists customer_notes_cust on customer_notes(customer_id, at desc);

alter table price_levels enable row level security;
alter table items enable row level security;
alter table item_sizes enable row level security;
alter table customers enable row level security;
alter table customer_licenses enable row level security;
alter table customer_notes enable row level security;
revoke all on price_levels, items, item_sizes, customers, customer_licenses, customer_notes from anon, authenticated;

create or replace function _num(v jsonb) returns numeric language sql immutable as $$
  select case when v is null or jsonb_typeof(v) = 'null' or trim(v #>> '{}') = '' then null else (v #>> '{}')::numeric end $$;

create or replace function _levels_ensure(p_company uuid) returns void
language sql security definer set search_path = public as $$
  insert into price_levels(company_id, n, name) select p_company, n, 'L' || n from generate_series(1,3) n
  where not exists (select 1 from price_levels where company_id = p_company) $$;

create or replace function _levels_json(p_company uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('n', n, 'name', name,
    'customers', (select count(*) from customers c where c.company_id = p_company and c.level = l.n and c.active)) order by n), '[]'::jsonb)
  from price_levels l where company_id = p_company $$;

-- Company JSON now carries its settings and price levels.
create or replace function _company_json(p_company uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'addr', c.addr, 'city', c.city,
    'state', c.state, 'zip', c.zip, 'created_at', c.created_at, 'is_test', c.is_test,
    'role', _role_in(c.id),
    'home', (select state from company_states where company_id = c.id and is_home),
    'others', coalesce((select jsonb_agg(state order by state) from company_states where company_id = c.id and not is_home), '[]'::jsonb),
    'settings', jsonb_build_object('lic_mode', 'warn', 'lic_need', '{}'::jsonb, 'remind_days', 30, 'default_level', 1) || (c.settings - 'tobacco_stop'),
    'levels', _levels_json(c.id))
  from companies c where c.id = p_company $$;

-- Owners and managers: the price levels. list = [{n?, name}]. A level with customers on it can't be taken away.
create or replace function levels_set(p_company uuid, p_list jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; i int := 0; keep int[] := '{}'; used int; before jsonb; nm text; nn int; free int;
begin
  perform _need(p_company, 'manager');
  perform _levels_ensure(p_company);
  if jsonb_array_length(coalesce(p_list,'[]'::jsonb)) = 0 then raise exception 'keep at least one price level'; end if;
  if jsonb_array_length(p_list) > 6 then raise exception 'up to 6 price levels'; end if;
  if (select count(distinct lower(trim(e->>'name'))) from jsonb_array_elements(p_list) e) <> jsonb_array_length(p_list) then
    raise exception 'two price levels have the same name'; end if;
  before := _levels_json(p_company);
  for x in select * from jsonb_array_elements(p_list) loop
    if (x->>'n') is not null then keep := keep || (x->>'n')::int; end if;
  end loop;
  select count(*) into used from customers where company_id = p_company and active and not (level = any(keep));
  if used > 0 then raise exception '% customers are on a price level you took away. Move them to another level first', used; end if;
  delete from price_levels where company_id = p_company and not (n = any(keep));
  for x in select * from jsonb_array_elements(p_list) loop
    nm := trim(coalesce(x->>'name',''));
    if length(nm) = 0 then raise exception 'every price level needs a name'; end if;
    if length(nm) > 20 then raise exception 'keep level names short (20 letters or less)'; end if;
    nn := (x->>'n')::int;
    if nn is null then
      select min(g) into free from generate_series(1,6) g where not exists (select 1 from price_levels where company_id = p_company and n = g);
      insert into price_levels(company_id, n, name) values (p_company, free, nm);
    else
      update price_levels set name = nm where company_id = p_company and n = nn;
    end if;
  end loop;
  if not exists (select 1 from price_levels where company_id = p_company and n = coalesce((select (settings->>'default_level')::int from companies where id = p_company),1)) then
    update companies set settings = settings || jsonb_build_object('default_level', (select min(n) from price_levels where company_id = p_company)) where id = p_company;
  end if;
  perform _log(p_company, 'price levels changed', jsonb_build_object('before', before, 'after', _levels_json(p_company)));
  return _company_json(p_company);
end $$;

-- Owners and managers: lic_mode ('warn' | 'ask': selling is never stopped), lic_need ({state: [licenses]} for the
-- company's own states), remind_days (0–120), default_level. The old tobacco_stop setting is gone (2026-11-26).
update companies set settings = settings - 'tobacco_stop' where settings ? 'tobacco_stop';
create or replace function company_settings_set(p_company uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb := '{}'::jsonb; before jsonb; st text; ks jsonb;
begin
  perform _need(p_company, 'manager');
  select settings into before from companies where id = p_company;
  if p ? 'lic_mode' then
    if p->>'lic_mode' not in ('warn','ask') then raise exception 'pick only warn or ask for a manager''s OK'; end if;
    s := s || jsonb_build_object('lic_mode', p->>'lic_mode'); end if;
  if p ? 'lic_need' then
    if jsonb_typeof(p->'lic_need') <> 'object' then raise exception 'pick licenses for each state'; end if;
    for st, ks in select * from jsonb_each(p->'lic_need') loop
      if not exists (select 1 from company_states where company_id = p_company and state = st) then raise exception 'you don''t sell in %', st; end if;
      if jsonb_typeof(ks) <> 'array' or exists (select 1 from jsonb_array_elements_text(ks) k where k not in ('resale','location','tobacco','vapor','hemp','beer'))
        then raise exception 'pick licenses from the list'; end if;
    end loop;
    s := s || jsonb_build_object('lic_need', p->'lic_need'); end if;
  if p ? 'remind_days' then
    if (p->>'remind_days')::int not between 0 and 120 then raise exception 'reminders can be 0 to 120 days ahead'; end if;
    s := s || jsonb_build_object('remind_days', (p->>'remind_days')::int); end if;
  if p ? 'default_level' then
    if not exists (select 1 from price_levels where company_id = p_company and n = (p->>'default_level')::int) then raise exception 'pick a price level'; end if;
    s := s || jsonb_build_object('default_level', (p->>'default_level')::int); end if;
  update companies set settings = settings || s where id = p_company;
  perform _log(p_company, 'settings changed', jsonb_build_object('before', before, 'after', s));
  return _company_json(p_company);
end $$;

-- ----- items -----
create or replace function _item_json(p_id uuid, p_cost boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', i.id, 'name', i.name, 'item_no', i.item_no, 'category', i.category, 'nacs', i.nacs,
    'vendor', i.vendor, 'unit', i.unit, 'ml', i.ml, 'oz', i.oz, 'age', i.age, 'active', i.active, 'updated_at', i.updated_at,
    'cost_hidden', not p_cost,
    'sizes', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'n', z.n, 'upc', z.upc,
      'cost', case when p_cost then z.cost end, 'prices', z.prices) order by z.pos, z.n) from item_sizes z where z.item_id = i.id), '[]'::jsonb))
  from items i where i.id = p_id $$;

-- Everyone in the company sees items; only owners and managers see costs.
create or replace function items_list(p_company uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r text := _need(p_company, 'staff'); c boolean := r in ('owner','manager');
begin
  return coalesce((select jsonb_agg(_item_json(id, c) order by lower(name)) from items where company_id = p_company), '[]'::jsonb);
end $$;

-- Owners and managers add or change an item. p = {id?, name, item_no, category, nacs, vendor, unit, ml, oz, age, active, sizes:[{id?, name, n, upc, cost, prices}]}
create or replace function item_put(p_company uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare iid uuid; z jsonb; v_pos int := 0; keep uuid[] := '{}'; u text; other text; zid uuid; before jsonb; isnew boolean;
begin
  perform _need(p_company, 'manager');
  if length(trim(coalesce(p->>'name',''))) = 0 then raise exception 'type the item name'; end if;
  if jsonb_array_length(coalesce(p->'sizes','[]'::jsonb)) = 0 then raise exception 'add at least one size'; end if;
  iid := nullif(p->>'id','')::uuid;
  isnew := iid is null;
  if not isnew then
    if not exists (select 1 from items where id = iid and company_id = p_company) then raise exception 'item not found'; end if;
    before := _item_json(iid, true);
    update items set name = trim(p->>'name'), item_no = trim(coalesce(p->>'item_no','')), category = coalesce(nullif(p->>'category',''),'other'),
      nacs = trim(coalesce(p->>'nacs','')), vendor = trim(coalesce(p->>'vendor','')), unit = coalesce(nullif(trim(p->>'unit'),''),'each'),
      ml = _num(p->'ml'), oz = _num(p->'oz'), age = coalesce((p->>'age')::int, 0), active = coalesce((p->>'active')::boolean, true),
      updated_at = now() where id = iid;
  else
    insert into items(company_id, name, item_no, category, nacs, vendor, unit, ml, oz, age)
      values (p_company, trim(p->>'name'), trim(coalesce(p->>'item_no','')), coalesce(nullif(p->>'category',''),'other'), trim(coalesce(p->>'nacs','')),
        trim(coalesce(p->>'vendor','')), coalesce(nullif(trim(p->>'unit'),''),'each'), _num(p->'ml'), _num(p->'oz'), coalesce((p->>'age')::int, 0))
      returning id into iid;
  end if;
  for z in select * from jsonb_array_elements(p->'sizes') loop
    if nullif(z->>'id','') is not null then keep := keep || (z->>'id')::uuid; end if;
    u := regexp_replace(coalesce(z->>'upc',''), '\D', '', 'g');
    if length(trim(coalesce(z->>'name',''))) = 0 then raise exception 'every size needs a name, like Carton or Box'; end if;
    if coalesce((z->>'n')::int, 0) < 1 then raise exception 'how many in a %? Type a whole number, 1 or more', z->>'name'; end if;
    if u <> '' and length(u) not between 6 and 14 then raise exception 'the UPC on % should be 6 to 14 digits', z->>'name'; end if;
    if u <> '' then
      select i.name into other from item_sizes s join items i on i.id = s.item_id
        where s.company_id = p_company and s.upc = u and s.item_id <> iid limit 1;
      if other is not null then raise exception 'UPC % is already on %', u, other; end if;
    end if;
  end loop;
  if (select count(distinct regexp_replace(coalesce(q->>'upc',''), '\D', '', 'g')) from jsonb_array_elements(p->'sizes') q where regexp_replace(coalesce(q->>'upc',''), '\D', '', 'g') <> '')
     <> (select count(*) from jsonb_array_elements(p->'sizes') q where regexp_replace(coalesce(q->>'upc',''), '\D', '', 'g') <> '') then
    raise exception 'two sizes have the same UPC'; end if;
  delete from item_sizes where item_id = iid and not (id = any(keep));
  update item_sizes set upc = '' where item_id = iid;          -- UPCs go back on below, so two sizes can swap them in one save
  for z in select * from jsonb_array_elements(p->'sizes') loop
    v_pos := v_pos + 1;
    u := regexp_replace(coalesce(z->>'upc',''), '\D', '', 'g');
    zid := nullif(z->>'id','')::uuid;
    if zid is not null and exists (select 1 from item_sizes where id = zid and item_id = iid) then
      update item_sizes set pos = v_pos, name = trim(z->>'name'), n = (z->>'n')::int, cost = _num(z->'cost'),
        prices = coalesce((select jsonb_object_agg(k, _num(v)) from jsonb_each(coalesce(z->'prices','{}'::jsonb)) e(k,v) where _num(v) is not null), '{}'::jsonb)
        where id = zid;
    else
      insert into item_sizes(item_id, company_id, pos, name, n, upc, cost, prices)
        values (iid, p_company, v_pos, trim(z->>'name'), (z->>'n')::int, '', _num(z->'cost'),
          coalesce((select jsonb_object_agg(k, _num(v)) from jsonb_each(coalesce(z->'prices','{}'::jsonb)) e(k,v) where _num(v) is not null), '{}'::jsonb))
        returning id into zid;
    end if;
    update item_sizes set upc = u where id = zid;
  end loop;
  perform _log(p_company, case when isnew then 'item added' else 'item changed' end,
    jsonb_build_object('item', iid, 'name', trim(p->>'name'), 'before', before));
  return _item_json(iid, true);
end $$;

-- ----- customers -----
create or replace function _cust_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(c) - 'company_id' || jsonb_build_object('owes', 0,
    'licenses', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'number', l.number, 'expires', l.expires, 'copy', l.copy) order by l.kind)
      from customer_licenses l where l.customer_id = c.id), '[]'::jsonb))
  from customers c where c.id = p_id $$;

create or replace function customers_list(p_company uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _need(p_company, 'staff');
  return coalesce((select jsonb_agg(_cust_json(id) order by lower(name)) from customers where company_id = p_company), '[]'::jsonb);
end $$;

-- One customer with notes and their change history.
create or replace function customer_get(p_company uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _need(p_company, 'staff');
  if not exists (select 1 from customers where id = p_id and company_id = p_company) then raise exception 'customer not found'; end if;
  return _cust_json(p_id) || jsonb_build_object(
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'text', text, 'by', by_name, 'at', at) order by at desc)
      from customer_notes where customer_id = p_id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', at, 'by', by_name, 'what', what, 'detail', detail) order by at desc, id desc)
      from (select * from change_log where company_id = p_company and detail->>'customer' = p_id::text order by at desc, id desc limit 100) h), '[]'::jsonb));
end $$;

-- Owners and managers add or change a customer. Only the keys sent change.
create or replace function customer_put(p_company uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cid uuid := nullif(p->>'id','')::uuid; before jsonb; e text; lv int; isnew boolean := cid is null;
begin
  perform _need(p_company, 'manager');
  perform _levels_ensure(p_company);
  if (isnew or p ? 'name') and length(trim(coalesce(p->>'name',''))) = 0 then raise exception 'type the customer''s name'; end if;
  e := lower(trim(coalesce(p->>'email','')));
  if e <> '' and e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'the email doesn''t look right'; end if;
  if p ? 'level' then lv := (p->>'level')::int;
    if not exists (select 1 from price_levels where company_id = p_company and n = lv) then raise exception 'pick a price level'; end if; end if;
  if _num(p->'credit_limit') < 0 then raise exception 'the credit limit can''t be below zero'; end if;
  if isnew then
    insert into customers(company_id, name, level) values (p_company, trim(p->>'name'),
      coalesce(lv, (select (settings->>'default_level')::int from companies where id = p_company), (select min(n) from price_levels where company_id = p_company)))
      returning id into cid;
  else
    if not exists (select 1 from customers where id = cid and company_id = p_company) then raise exception 'customer not found'; end if;
    before := _cust_json(cid) - 'licenses';
  end if;
  update customers set
    name = case when p ? 'name' then trim(p->>'name') else name end,
    store_no = case when p ? 'store_no' then trim(coalesce(p->>'store_no','')) else store_no end,
    phone = case when p ? 'phone' then trim(coalesce(p->>'phone','')) else phone end,
    email = case when p ? 'email' then e else email end,
    addr = case when p ? 'addr' then trim(coalesce(p->>'addr','')) else addr end,
    city = case when p ? 'city' then trim(coalesce(p->>'city','')) else city end,
    state = case when p ? 'state' then coalesce(_clean_state(p->>'state'),'') else state end,
    zip = case when p ? 'zip' then trim(coalesce(p->>'zip','')) else zip end,
    contacts = case when p ? 'contacts' then coalesce((select jsonb_agg(jsonb_build_object('name', trim(coalesce(x->>'name','')), 'role', trim(coalesce(x->>'role','')), 'phone', trim(coalesce(x->>'phone',''))))
      from jsonb_array_elements(p->'contacts') x where trim(coalesce(x->>'name','') || coalesce(x->>'phone','')) <> ''), '[]'::jsonb) else contacts end,
    level = coalesce(lv, level),
    terms = case when p ? 'terms' then p->>'terms' else terms end,
    credit_limit = case when p ? 'credit_limit' then _num(p->'credit_limit') else credit_limit end,
    tobacco = case when p ? 'tobacco' then (p->>'tobacco')::boolean else tobacco end,
    delivery = case when p ? 'delivery' then trim(coalesce(p->>'delivery','')) else delivery end,
    route = case when p ? 'route' then trim(coalesce(p->>'route','')) else route end,
    rep = case when p ? 'rep' then trim(coalesce(p->>'rep','')) else rep end,
    ship_to = case when p ? 'ship_to' then trim(coalesce(p->>'ship_to','')) else ship_to end,
    since = case when p ? 'since' then nullif(p->>'since','')::date else since end,
    active = case when p ? 'active' then (p->>'active')::boolean else active end,
    updated_at = now()
  where id = cid;
  perform _opening_put(p_company, cid, p);
  perform _log(p_company, case when isnew then 'customer added' else 'customer changed' end,
    jsonb_build_object('customer', cid, 'name', (select name from customers where id = cid), 'before', before));
  return customer_get(p_company, cid);
end $$;

-- Owners and managers set a license. An empty number removes it.
create or replace function license_put(p_company uuid, p_customer uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text := p->>'kind'; before jsonb;
begin
  perform _need(p_company, 'manager');
  if not exists (select 1 from customers where id = p_customer and company_id = p_company) then raise exception 'customer not found'; end if;
  if k not in ('resale','location','tobacco','vapor','hemp','beer') then raise exception 'pick a license'; end if;
  select to_jsonb(l) - 'customer_id' - 'company_id' into before from customer_licenses l where customer_id = p_customer and kind = k;
  if length(trim(coalesce(p->>'number',''))) = 0 then
    delete from customer_licenses where customer_id = p_customer and kind = k;
  else
    insert into customer_licenses(customer_id, company_id, kind, number, expires, copy)
      values (p_customer, p_company, k, trim(p->>'number'), nullif(p->>'expires','')::date, coalesce((p->>'copy')::boolean, false))
      on conflict (customer_id, kind) do update set number = excluded.number, expires = excluded.expires, copy = excluded.copy, updated_at = now();
  end if;
  perform _log(p_company, 'license changed', jsonb_build_object('customer', p_customer, 'kind', k, 'before', before,
    'after', (select to_jsonb(l) - 'customer_id' - 'company_id' from customer_licenses l where customer_id = p_customer and kind = k)));
  return customer_get(p_company, p_customer);
end $$;

-- Anyone in the company adds a note.
create or replace function note_add(p_company uuid, p_customer uuid, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _need(p_company, 'staff');
  if not exists (select 1 from customers where id = p_customer and company_id = p_company) then raise exception 'customer not found'; end if;
  if length(trim(coalesce(p_text,''))) = 0 then raise exception 'type a note'; end if;
  insert into customer_notes(customer_id, company_id, text, by_name)
    values (p_customer, p_company, left(trim(p_text), 2000),
      coalesce((select nullif(name,'') from company_members where company_id = p_company and user_id = auth.uid()), _my_email()));
  return customer_get(p_company, p_customer);
end $$;

-- Only signed-in people may call the app's functions; the helpers stay private.
revoke execute on function _role_in(uuid), _need(uuid,text), _log(uuid,text,jsonb), _company_json(uuid) from public, anon, authenticated;
revoke execute on function my_companies(), create_company(jsonb), company_put(uuid,jsonb), company_states_set(uuid,text,jsonb),
  members_list(uuid), invite_put(uuid,text,text), invite_remove(uuid,text), member_set(uuid,uuid,text),
  my_name_set(uuid,text), change_log_list(uuid,int) from public, anon;
grant execute on function my_companies(), create_company(jsonb), company_put(uuid,jsonb), company_states_set(uuid,text,jsonb),
  members_list(uuid), invite_put(uuid,text,text), invite_remove(uuid,text), member_set(uuid,uuid,text),
  my_name_set(uuid,text), change_log_list(uuid,int) to authenticated;

revoke execute on function _num(jsonb), _levels_ensure(uuid), _levels_json(uuid), _item_json(uuid,boolean), _cust_json(uuid) from public, anon, authenticated;
revoke execute on function levels_set(uuid,jsonb), company_settings_set(uuid,jsonb), items_list(uuid), item_put(uuid,jsonb),
  customers_list(uuid), customer_get(uuid,uuid), customer_put(uuid,jsonb), license_put(uuid,uuid,jsonb), note_add(uuid,uuid,text) from public, anon;
grant execute on function levels_set(uuid,jsonb), company_settings_set(uuid,jsonb), items_list(uuid), item_put(uuid,jsonb),
  customers_list(uuid), customer_get(uuid,uuid), customer_put(uuid,jsonb), license_put(uuid,uuid,jsonb), note_add(uuid,uuid,text) to authenticated;

-- ===== Phase 1, part 2: bring in from your old system (2026-11-26) =====
-- A customer's balance from the old system is kept as a starting balance (owes = starting balance + invoices − payments later).
alter table customers add column if not exists opening numeric(12,2) not null default 0;
alter table customers add column if not exists opening_as_of date;

create table if not exists imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null check (kind in ('items','customers')),
  file text not null default '',
  added int not null default 0,
  skipped int not null default 0,
  balance numeric(14,2),            -- customers: total starting balances brought in
  old_total numeric(14,2),          -- what the wholesaler said the old system shows
  by_name text not null default '',
  at timestamptz not null default now(),
  undone_at timestamptz
);
create index if not exists imports_company on imports(company_id, at desc);
alter table items add column if not exists import_id uuid references imports(id) on delete set null;
alter table customers add column if not exists import_id uuid references imports(id) on delete set null;
alter table imports enable row level security;
revoke all on imports from anon, authenticated;

create or replace function _cust_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(c) - 'company_id' - 'import_id' || jsonb_build_object('owes', c.opening,
    'licenses', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'number', l.number, 'expires', l.expires, 'copy', l.copy) order by l.kind)
      from customer_licenses l where l.customer_id = c.id), '[]'::jsonb))
  from customers c where c.id = p_id $$;

-- Owners and managers start an import. p = {kind, file, old_total}
create or replace function import_start(p_company uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare iid uuid;
begin
  perform _need(p_company, 'manager');
  if coalesce(p->>'kind','') not in ('items','customers') then raise exception 'pick items or customers'; end if;
  insert into imports(company_id, kind, file, old_total, by_name)
    values (p_company, p->>'kind', left(coalesce(p->>'file',''), 200), _num(p->'old_total'),
      coalesce((select nullif(name,'') from company_members where company_id = p_company and user_id = auth.uid()), _my_email()))
    returning id into iid;
  return iid;
end $$;

-- Items in batches. Each row = one item with its sizes. A UPC already in the company is left alone (counted as skipped).
create or replace function import_items(p_company uuid, p_import uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; z jsonb; iid uuid; u text; v_added int := 0; v_skipped int := 0; pos int;
begin
  perform _need(p_company, 'manager');
  if not exists (select 1 from imports where id = p_import and company_id = p_company and kind = 'items' and undone_at is null) then raise exception 'import not found'; end if;
  if jsonb_array_length(coalesce(p_rows,'[]'::jsonb)) > 1000 then raise exception 'send at most 1000 rows at a time'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if length(trim(coalesce(r->>'name',''))) = 0 or jsonb_array_length(coalesce(r->'sizes','[]'::jsonb)) = 0 then v_skipped := v_skipped + 1; continue; end if;
    if exists (select 1 from jsonb_array_elements(r->'sizes') s join item_sizes x on x.company_id = p_company
        and x.upc = regexp_replace(coalesce(s->>'upc',''), '\D', '', 'g') where regexp_replace(coalesce(s->>'upc',''), '\D', '', 'g') <> '') then
      v_skipped := v_skipped + 1; continue; end if;
    insert into items(company_id, name, item_no, category, nacs, vendor, unit, age, import_id)
      values (p_company, left(trim(r->>'name'),160), left(trim(coalesce(r->>'item_no','')),60),
        case when r->>'category' in ('cigarettes','cigars','otp','snuff','vapor','pouches','hemp','beer','other') then r->>'category' else 'other' end,
        left(trim(coalesce(r->>'nacs','')),20), left(trim(coalesce(r->>'vendor','')),80), coalesce(nullif(trim(r->>'unit'),''),'each'),
        case when (r->>'age') in ('0','18','21') then (r->>'age')::int else 0 end, p_import)
      returning id into iid;
    pos := 0;
    for z in select * from jsonb_array_elements(r->'sizes') loop
      pos := pos + 1;
      u := regexp_replace(coalesce(z->>'upc',''), '\D', '', 'g');
      if length(u) not between 6 and 14 then u := ''; end if;
      insert into item_sizes(item_id, company_id, pos, name, n, upc, cost, prices)
        values (iid, p_company, pos, left(coalesce(nullif(trim(z->>'name'),''),'Each'),40), greatest(coalesce((z->>'n')::int,1),1), u, _num(z->'cost'),
          coalesce((select jsonb_object_agg(k, _num(v)) from jsonb_each(coalesce(z->'prices','{}'::jsonb)) e(k,v) where _num(v) is not null and _num(v) >= 0), '{}'::jsonb));
    end loop;
    v_added := v_added + 1;
  end loop;
  update imports set added = added + v_added, skipped = skipped + v_skipped where id = p_import;
  return jsonb_build_object('added', v_added, 'skipped', v_skipped);
end $$;

-- Customers in batches. Same name + store # already here = left alone. Balances become starting balances.
create or replace function import_customers(p_company uuid, p_import uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; l jsonb; cid uuid; v_added int := 0; v_skipped int := 0; bal numeric := 0; lv int; deflv int;
begin
  perform _need(p_company, 'manager');
  perform _levels_ensure(p_company);
  if not exists (select 1 from imports where id = p_import and company_id = p_company and kind = 'customers' and undone_at is null) then raise exception 'import not found'; end if;
  if jsonb_array_length(coalesce(p_rows,'[]'::jsonb)) > 1000 then raise exception 'send at most 1000 rows at a time'; end if;
  deflv := coalesce((select (settings->>'default_level')::int from companies where id = p_company), (select min(n) from price_levels where company_id = p_company));
  for r in select * from jsonb_array_elements(p_rows) loop
    if length(trim(coalesce(r->>'name',''))) = 0 or exists (select 1 from customers where company_id = p_company
        and lower(regexp_replace(trim(name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(r->>'name'), '\s+', ' ', 'g'))
        and lower(store_no) = lower(trim(coalesce(r->>'store_no','')))) then
      v_skipped := v_skipped + 1; continue; end if;
    lv := (r->>'level')::int;
    if lv is null or not exists (select 1 from price_levels where company_id = p_company and n = lv) then lv := deflv; end if;
    insert into customers(company_id, name, store_no, phone, email, addr, city, state, zip, contacts, level, terms, credit_limit, opening, opening_as_of, import_id)
      values (p_company, left(trim(r->>'name'),160), left(trim(coalesce(r->>'store_no','')),40), left(trim(coalesce(r->>'phone','')),40),
        case when lower(trim(coalesce(r->>'email',''))) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then lower(trim(r->>'email')) else '' end,
        left(trim(coalesce(r->>'addr','')),160), left(trim(coalesce(r->>'city','')),80), coalesce(_clean_state(r->>'state'),''), left(trim(coalesce(r->>'zip','')),12),
        coalesce((select jsonb_agg(jsonb_build_object('name', left(trim(coalesce(x->>'name','')),80), 'role', left(trim(coalesce(x->>'role','')),40), 'phone', left(trim(coalesce(x->>'phone','')),40)))
          from jsonb_array_elements(coalesce(r->'contacts','[]'::jsonb)) x where trim(coalesce(x->>'name','')) <> ''), '[]'::jsonb),
        lv, case when r->>'terms' in ('cod','advance','net7','net10','net14','net30') then r->>'terms' else 'cod' end,
        case when _num(r->'credit_limit') >= 0 then _num(r->'credit_limit') end, coalesce(_num(r->'opening'),0), current_date, p_import)
      returning id into cid;
    for l in select * from jsonb_array_elements(coalesce(r->'licenses','[]'::jsonb)) loop
      if l->>'kind' in ('resale','location','tobacco','vapor','hemp','beer') and length(trim(coalesce(l->>'number',''))) > 0 then
        insert into customer_licenses(customer_id, company_id, kind, number, expires)
          values (cid, p_company, l->>'kind', left(trim(l->>'number'),60), nullif(l->>'expires','')::date) on conflict do nothing;
      end if;
    end loop;
    bal := bal + coalesce(_num(r->'opening'),0);
    v_added := v_added + 1;
  end loop;
  update imports set added = added + v_added, skipped = skipped + v_skipped, balance = coalesce(balance,0) + bal where id = p_import;
  return jsonb_build_object('added', v_added, 'skipped', v_skipped, 'balance', bal);
end $$;

create or replace function import_finish(p_company uuid, p_import uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x imports;
begin
  perform _need(p_company, 'manager');
  select * into x from imports where id = p_import and company_id = p_company;
  if x.id is null then raise exception 'import not found'; end if;
  perform _log(p_company, 'brought in ' || x.kind, jsonb_build_object('import', x.id, 'file', x.file, 'added', x.added, 'skipped', x.skipped, 'balance', x.balance, 'old_total', x.old_total));
  return to_jsonb(x) - 'company_id';
end $$;

create or replace function imports_list(p_company uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _need(p_company, 'manager');
  return coalesce((select jsonb_agg(to_jsonb(x) - 'company_id' order by at desc) from (select * from imports where company_id = p_company order by at desc limit 50) x), '[]'::jsonb);
end $$;

-- Owners and managers take back an import: everything it added goes away.
-- (Once invoices exist, a customer or item that has been used on one will stay: Phase 2 adds that check.)
create or replace function import_undo(p_company uuid, p_import uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x imports; n int;
begin
  perform _need(p_company, 'manager');
  select * into x from imports where id = p_import and company_id = p_company;
  if x.id is null then raise exception 'import not found'; end if;
  if x.undone_at is not null then raise exception 'this import was already taken back'; end if;
  if x.kind = 'items' then delete from items where company_id = p_company and import_id = p_import; get diagnostics n = row_count;
  else delete from customers where company_id = p_company and import_id = p_import; get diagnostics n = row_count; end if;
  update imports set undone_at = now() where id = p_import;
  perform _log(p_company, 'import taken back', jsonb_build_object('import', p_import, 'kind', x.kind, 'file', x.file, 'removed', n));
  return jsonb_build_object('removed', n);
end $$;

-- Starting balance can be typed by owners (customer_put takes 'opening').
create or replace function _opening_put(p_company uuid, p_cust uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p ? 'opening' then
    if _role_in(p_company) <> 'owner' then raise exception 'only an owner can change a starting balance'; end if;
    update customers set opening = coalesce(_num(p->'opening'),0), opening_as_of = coalesce(opening_as_of, current_date) where id = p_cust;
  end if;
end $$;

revoke execute on function _opening_put(uuid,uuid,jsonb) from public, anon, authenticated;
revoke execute on function import_start(uuid,jsonb), import_items(uuid,uuid,jsonb), import_customers(uuid,uuid,jsonb), import_finish(uuid,uuid),
  imports_list(uuid), import_undo(uuid,uuid) from public, anon;
grant execute on function import_start(uuid,jsonb), import_items(uuid,uuid,jsonb), import_customers(uuid,uuid,jsonb), import_finish(uuid,uuid),
  imports_list(uuid), import_undo(uuid,uuid) to authenticated;

-- =====================================================================
-- Phase 1, part 3: license copies (2026-11-26)
-- A photo or PDF of each license. Files live in the private storage bucket `licenses`
-- under <company>/<customer>/<file>. A copy is never deleted, only hidden (removed_at),
-- so what was on file and when can always be shown. The number and end date at the time are kept on the copy.
-- =====================================================================
create table if not exists license_copies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  kind text not null check (kind in ('resale','location','tobacco','vapor','hemp','beer')),
  path text not null unique,
  name text not null default '',
  type text not null default '',
  size int,
  number text not null default '',
  expires date,
  by_name text not null default '',
  at timestamptz not null default now(),
  removed_at timestamptz
);
create index if not exists license_copies_cust on license_copies(customer_id, kind, at desc);
alter table license_copies enable row level security;
revoke all on license_copies from anon, authenticated;

-- For the storage rules: may the signed-in person use files under this company? (min = staff to look, manager to add)
create or replace function copy_path_ok(p_name text, p_min text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare cid uuid; r text;
begin
  begin cid := split_part(p_name, '/', 1)::uuid; exception when others then return false; end;
  select role into r from company_members where company_id = cid and user_id = auth.uid();
  if r is null then return false; end if;
  return case p_min when 'staff' then true when 'manager' then r in ('owner','manager') else r = 'owner' end;
end $$;
revoke execute on function copy_path_ok(text,text) from public, anon;
grant execute on function copy_path_ok(text,text) to authenticated;

-- The bucket and its rules (only on Supabase; the test database has no storage).
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
      values ('licenses', 'licenses', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
      on conflict (id) do update set public = false, file_size_limit = 10485760,
        allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'];
    execute 'drop policy if exists "license copies add" on storage.objects';
    execute 'drop policy if exists "license copies look" on storage.objects';
    execute $p$create policy "license copies add" on storage.objects for insert to authenticated
      with check (bucket_id = 'licenses' and public.copy_path_ok(name, 'manager'))$p$;
    execute $p$create policy "license copies look" on storage.objects for select to authenticated
      using (bucket_id = 'licenses' and public.copy_path_ok(name, 'staff'))$p$;
  end if;
end $$;

create or replace function _copy_flag(p_customer uuid, p_kind text) returns void
language sql security definer set search_path = public as $$
  update customer_licenses set copy = exists (select 1 from license_copies where customer_id = p_customer and kind = p_kind and removed_at is null)
  where customer_id = p_customer and kind = p_kind $$;
revoke execute on function _copy_flag(uuid,text) from public, anon, authenticated;

create or replace function customer_get(p_company uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _need(p_company, 'staff');
  if not exists (select 1 from customers where id = p_id and company_id = p_company) then raise exception 'customer not found'; end if;
  return _cust_json(p_id) || jsonb_build_object(
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'text', text, 'by', by_name, 'at', at) order by at desc)
      from customer_notes where customer_id = p_id), '[]'::jsonb),
    'copies', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'path', path, 'name', name, 'type', type, 'number', number,
        'expires', expires, 'by', by_name, 'at', at) order by at desc)
      from license_copies where customer_id = p_id and removed_at is null), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', at, 'by', by_name, 'what', what, 'detail', detail) order by at desc, id desc)
      from (select * from change_log where company_id = p_company and detail->>'customer' = p_id::text order by at desc, id desc limit 100) h), '[]'::jsonb));
end $$;

-- The app uploads the file first, then tells the database about it.
create or replace function copy_add(p_company uuid, p_customer uuid, p_kind text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pth text := coalesce(p->>'path',''); l customer_licenses;
begin
  perform _need(p_company, 'manager');
  if not exists (select 1 from customers where id = p_customer and company_id = p_company) then raise exception 'customer not found'; end if;
  if p_kind not in ('resale','location','tobacco','vapor','hemp','beer') then raise exception 'pick a license'; end if;
  if pth not like p_company::text || '/' || p_customer::text || '/%' or pth like '%..%' then raise exception 'that file isn''t in the right place'; end if;
  if coalesce(p->>'type','') !~ '^(image/|application/pdf$)' then raise exception 'pick a photo or a PDF'; end if;
  select * into l from customer_licenses where customer_id = p_customer and kind = p_kind;
  insert into license_copies(company_id, customer_id, kind, path, name, type, size, number, expires, by_name)
    values (p_company, p_customer, p_kind, pth, left(coalesce(p->>'name',''),120), p->>'type', nullif(p->>'size','')::int,
      coalesce(l.number,''), l.expires,
      coalesce((select nullif(name,'') from company_members where company_id = p_company and user_id = auth.uid()), _my_email()));
  perform _copy_flag(p_customer, p_kind);
  perform _log(p_company, 'license copy added', jsonb_build_object('customer', p_customer, 'kind', p_kind, 'name', left(coalesce(p->>'name',''),120)));
  return customer_get(p_company, p_customer);
end $$;

create or replace function copy_remove(p_company uuid, p_customer uuid, p_copy uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x license_copies;
begin
  perform _need(p_company, 'manager');
  select * into x from license_copies where id = p_copy and customer_id = p_customer and company_id = p_company and removed_at is null;
  if x.id is null then raise exception 'copy not found'; end if;
  update license_copies set removed_at = now() where id = p_copy;
  perform _copy_flag(p_customer, x.kind);
  perform _log(p_company, 'license copy removed', jsonb_build_object('customer', p_customer, 'kind', x.kind, 'name', x.name));
  return customer_get(p_company, p_customer);
end $$;

-- A renewed license: the current copy keeps the number and end date it was added with; the app shows the license's own.
revoke execute on function copy_add(uuid,uuid,text,jsonb), copy_remove(uuid,uuid,uuid) from public, anon;
grant execute on function copy_add(uuid,uuid,text,jsonb), copy_remove(uuid,uuid,uuid), customer_get(uuid,uuid) to authenticated;

-- =====================================================================
-- Item photos (2026-11-26). One photo per item (every size shares it), in the PUBLIC storage bucket `item-photos`
-- under <company>/<item>-<time>.jpg: product photos aren't private, and invoices and the store ordering app show them.
-- Photos are made small (≤ 800 px JPEG) on the device before they go up. Owners and managers add or remove them.
-- =====================================================================
alter table items add column if not exists photo text not null default '';

create or replace function _item_json(p_id uuid, p_cost boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', i.id, 'name', i.name, 'item_no', i.item_no, 'category', i.category, 'nacs', i.nacs,
    'vendor', i.vendor, 'unit', i.unit, 'ml', i.ml, 'oz', i.oz, 'age', i.age, 'active', i.active, 'updated_at', i.updated_at,
    'cost_hidden', not p_cost, 'photo', i.photo,
    'sizes', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'n', z.n, 'upc', z.upc,
      'cost', case when p_cost then z.cost end, 'prices', z.prices) order by z.pos, z.n) from item_sizes z where z.item_id = i.id), '[]'::jsonb))
  from items i where i.id = p_id $$;

-- Owners and managers set (path) or take off ('') an item's photo. The file must be under <company>/<item>-.
create or replace function item_photo_set(p_company uuid, p_item uuid, p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n text; old text;
begin
  perform _need(p_company, 'manager');
  select name, photo into n, old from items where id = p_item and company_id = p_company;
  if n is null then raise exception 'item not found'; end if;
  p_path := coalesce(p_path, '');
  if p_path <> '' and (p_path not like p_company::text || '/' || p_item::text || '-%' or p_path !~* '\.(jpg|jpeg|png|webp)$') then
    raise exception 'that photo can''t be used'; end if;
  update items set photo = p_path, updated_at = now() where id = p_item;
  perform _log(p_company, case when p_path = '' then 'item photo removed' else 'item photo added' end,
    jsonb_build_object('item', p_item, 'name', n, 'before', old, 'after', p_path));
  return _item_json(p_item, true);
end $$;
revoke execute on function item_photo_set(uuid,uuid,text) from public, anon;
grant execute on function item_photo_set(uuid,uuid,text) to authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
      values ('item-photos', 'item-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
      on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp'];
    execute 'drop policy if exists "item photos add" on storage.objects';
    execute $p$create policy "item photos add" on storage.objects for insert to authenticated
      with check (bucket_id = 'item-photos' and public.copy_path_ok(name, 'manager'))$p$;
  end if;
end $$;


-- =====================================================================
-- Quantity breaks (2026-11-26). Per size: [{min, off}] = buys at least `min` of this size → `off` dollars off each, at every
-- price level. Items with the same break_group count together (5 cartons of any Seneca). Applied on invoices from Phase 2.
-- =====================================================================
alter table item_sizes add column if not exists breaks jsonb not null default '[]'::jsonb;
alter table items add column if not exists break_group text not null default '';

-- Checks and tidies one size's breaks: whole numbers 2 or more, an amount off above 0, no quantity twice, sorted.
create or replace function _breaks_clean(p jsonb, p_size text) returns jsonb
language plpgsql immutable set search_path = public as $$
declare b jsonb; out jsonb := '[]'::jsonb; m int; o numeric; seen int[] := '{}'; last numeric := 0;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return '[]'::jsonb; end if;
  if jsonb_array_length(p) > 10 then raise exception 'up to 10 breaks on a %', p_size; end if;
  for b in select value from jsonb_array_elements(p) order by (value->>'min')::numeric loop
    begin m := (b->>'min')::int; exception when others then m := null; end;
    if m is null or m < 2 or (b->>'min')::numeric <> m then raise exception 'a break on % needs a whole number of 2 or more', p_size; end if;
    o := _num(b->'off');
    if o is null or o <= 0 then raise exception 'a break on % needs an amount off', p_size; end if;
    if m = any(seen) then raise exception 'two breaks on % start at %', p_size, m; end if;
    if o < last then raise exception 'on %, buying more should take off at least as much', p_size; end if;
    seen := seen || m; last := o;
    out := out || jsonb_build_array(jsonb_build_object('min', m, 'off', round(o, 4)));
  end loop;
  return out;
end $$;

create or replace function _item_json(p_id uuid, p_cost boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', i.id, 'name', i.name, 'item_no', i.item_no, 'category', i.category, 'nacs', i.nacs,
    'vendor', i.vendor, 'unit', i.unit, 'ml', i.ml, 'oz', i.oz, 'age', i.age, 'active', i.active, 'updated_at', i.updated_at,
    'cost_hidden', not p_cost, 'photo', i.photo, 'break_group', i.break_group,
    'sizes', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'n', z.n, 'upc', z.upc,
      'cost', case when p_cost then z.cost end, 'prices', z.prices, 'breaks', z.breaks) order by z.pos, z.n) from item_sizes z where z.item_id = i.id), '[]'::jsonb))
  from items i where i.id = p_id $$;

create or replace function item_put(p_company uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare iid uuid; z jsonb; v_pos int := 0; keep uuid[] := '{}'; u text; other text; zid uuid; before jsonb; isnew boolean;
begin
  perform _need(p_company, 'manager');
  if length(trim(coalesce(p->>'name',''))) = 0 then raise exception 'type the item name'; end if;
  if jsonb_array_length(coalesce(p->'sizes','[]'::jsonb)) = 0 then raise exception 'add at least one size'; end if;
  iid := nullif(p->>'id','')::uuid;
  isnew := iid is null;
  if not isnew then
    if not exists (select 1 from items where id = iid and company_id = p_company) then raise exception 'item not found'; end if;
    before := _item_json(iid, true);
    update items set name = trim(p->>'name'), item_no = trim(coalesce(p->>'item_no','')), category = coalesce(nullif(p->>'category',''),'other'),
      nacs = trim(coalesce(p->>'nacs','')), vendor = trim(coalesce(p->>'vendor','')), unit = coalesce(nullif(trim(p->>'unit'),''),'each'),
      ml = _num(p->'ml'), oz = _num(p->'oz'), age = coalesce((p->>'age')::int, 0), active = coalesce((p->>'active')::boolean, true),
      break_group = left(trim(coalesce(p->>'break_group','')), 60), updated_at = now() where id = iid;
  else
    insert into items(company_id, name, item_no, category, nacs, vendor, unit, ml, oz, age, break_group)
      values (p_company, trim(p->>'name'), trim(coalesce(p->>'item_no','')), coalesce(nullif(p->>'category',''),'other'), trim(coalesce(p->>'nacs','')),
        trim(coalesce(p->>'vendor','')), coalesce(nullif(trim(p->>'unit'),''),'each'), _num(p->'ml'), _num(p->'oz'), coalesce((p->>'age')::int, 0), left(trim(coalesce(p->>'break_group','')), 60))
      returning id into iid;
  end if;
  for z in select * from jsonb_array_elements(p->'sizes') loop
    if nullif(z->>'id','') is not null then keep := keep || (z->>'id')::uuid; end if;
    u := regexp_replace(coalesce(z->>'upc',''), '\D', '', 'g');
    if length(trim(coalesce(z->>'name',''))) = 0 then raise exception 'every size needs a name, like Carton or Box'; end if;
    if coalesce((z->>'n')::int, 0) < 1 then raise exception 'how many in a %? Type a whole number, 1 or more', z->>'name'; end if;
    if u <> '' and length(u) not between 6 and 14 then raise exception 'the UPC on % should be 6 to 14 digits', z->>'name'; end if;
    perform _breaks_clean(z->'breaks', z->>'name');
    if u <> '' then
      select i.name into other from item_sizes s join items i on i.id = s.item_id
        where s.company_id = p_company and s.upc = u and s.item_id <> iid limit 1;
      if other is not null then raise exception 'UPC % is already on %', u, other; end if;
    end if;
  end loop;
  if (select count(distinct regexp_replace(coalesce(q->>'upc',''), '\D', '', 'g')) from jsonb_array_elements(p->'sizes') q where regexp_replace(coalesce(q->>'upc',''), '\D', '', 'g') <> '')
     <> (select count(*) from jsonb_array_elements(p->'sizes') q where regexp_replace(coalesce(q->>'upc',''), '\D', '', 'g') <> '') then
    raise exception 'two sizes have the same UPC'; end if;
  delete from item_sizes where item_id = iid and not (id = any(keep));
  update item_sizes set upc = '' where item_id = iid;          -- UPCs go back on below, so two sizes can swap them in one save
  for z in select * from jsonb_array_elements(p->'sizes') loop
    v_pos := v_pos + 1;
    u := regexp_replace(coalesce(z->>'upc',''), '\D', '', 'g');
    zid := nullif(z->>'id','')::uuid;
    if zid is not null and exists (select 1 from item_sizes where id = zid and item_id = iid) then
      update item_sizes set pos = v_pos, name = trim(z->>'name'), n = (z->>'n')::int, cost = _num(z->'cost'), breaks = _breaks_clean(z->'breaks', z->>'name'),
        prices = coalesce((select jsonb_object_agg(k, _num(v)) from jsonb_each(coalesce(z->'prices','{}'::jsonb)) e(k,v) where _num(v) is not null), '{}'::jsonb)
        where id = zid;
    else
      insert into item_sizes(item_id, company_id, pos, name, n, upc, cost, breaks, prices)
        values (iid, p_company, v_pos, trim(z->>'name'), (z->>'n')::int, '', _num(z->'cost'), _breaks_clean(z->'breaks', z->>'name'),
          coalesce((select jsonb_object_agg(k, _num(v)) from jsonb_each(coalesce(z->'prices','{}'::jsonb)) e(k,v) where _num(v) is not null), '{}'::jsonb))
        returning id into zid;
    end if;
    update item_sizes set upc = u where id = zid;
  end loop;
  perform _log(p_company, case when isnew then 'item added' else 'item changed' end,
    jsonb_build_object('item', iid, 'name', trim(p->>'name'), 'before', before));
  return _item_json(iid, true);
end $$;

-- =====================================================================
-- Phase 2, piece 1: the Counter (2026-11-26). A sale is one row in `sales`:
--   suspended (set aside, finish by closing) · review (sent for an owner / manager to finish) · posted (an invoice) · cancelled.
-- Prices are worked out HERE from the items, the customer's level and quantity breaks (the app shows the same numbers,
-- src/rules.js priceSale), so a sale can't be posted at a made-up price. Invoice numbers come from companies.next_invoice.
-- A sale sent for review keeps the day it was sent as its invoice date; a suspended one is dated the day it's completed.
-- =====================================================================
alter table companies add column if not exists next_invoice int not null default 1001;

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  customer_id uuid not null references customers(id),
  status text not null check (status in ('suspended','review','posted','cancelled')),
  number int,
  lines jsonb not null default '[]'::jsonb,
  total numeric(12,2) not null default 0,
  units int not null default 0,
  why text not null default '',
  lic_reason text not null default '',
  by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  posted_at timestamptz,
  posted_by text not null default '',
  invoice_date date,
  unique (company_id, number)
);
create index if not exists sales_company on sales(company_id, status, created_at desc);
create index if not exists sales_customer on sales(customer_id, status, created_at desc);
alter table sales enable row level security;
revoke all on sales from anon, authenticated;

-- Barcodes scanned at the counter that no item has, for an owner / manager to add.
create table if not exists unknown_upcs (
  company_id uuid not null references companies(id) on delete cascade,
  upc text not null check (upc ~ '^[0-9]{6,14}$'),
  times int not null default 0,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  last_by text not null default '',
  sold_as uuid references items(id) on delete set null,
  sold_by text not null default '',
  status text not null default 'open' check (status in ('open','added','ignored')),
  primary key (company_id, upc)
);
alter table unknown_upcs enable row level security;
revoke all on unknown_upcs from anon, authenticated;

create or replace function _my_name(p_company uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(m.name,'') from company_members m where m.company_id = p_company and m.user_id = auth.uid()), _my_email(), '') $$;

-- Price the lines for a level: [{size_id, ordered, shipped}] → {lines:[…], total, units}.
create or replace function _sale_price(p_company uuid, p_level int, p_lines jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; n_in int; n_ok int;
begin
  n_in := jsonb_array_length(coalesce(p_lines, '[]'::jsonb));
  with l as (
    select t.ord, (t.x->>'size_id')::uuid sid,
      greatest(coalesce((t.x->>'ordered')::int, 0), 0) ordered, greatest(coalesce((t.x->>'shipped')::int, 0), 0) shipped
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality t(x, ord)),
  j as (
    select l.*, z.name zname, z.n zn, z.upc, z.prices, z.breaks, i.id iid, i.name iname, i.category, i.unit,
      case when trim(i.break_group) <> '' then 'g:' || lower(trim(i.break_group)) || '|' || lower(trim(z.name)) else 's:' || z.id::text end gk
    from l join item_sizes z on z.id = l.sid and z.company_id = p_company join items i on i.id = z.item_id),
  g as (select gk, sum(shipped) gq from j group by gk),
  p as (
    select j.*, g.gq, _num(j.prices -> (p_level::text)) price,
      coalesce((select max(_num(b->'off')) from jsonb_array_elements(j.breaks) b where (b->>'min')::int <= g.gq), 0) off
    from j join g using (gk)),
  q as (select p.*, round(p.price - p.off, 2) unit_price from p)
  select jsonb_build_object(
    'lines', coalesce(jsonb_agg(jsonb_build_object('size_id', sid, 'item_id', iid, 'name', iname, 'size', zname, 'n', zn, 'unit_name', unit, 'upc', upc,
      'category', category, 'ordered', ordered, 'shipped', shipped, 'price', price, 'off', off, 'unit_price', unit_price,
      'total', round(unit_price * shipped, 2), 'group_qty', gq) order by ord), '[]'::jsonb),
    'total', coalesce(sum(round(unit_price * shipped, 2)), 0), 'units', coalesce(sum(shipped), 0), 'n', count(*),
    'noprice', (select iname || ' (' || zname || ')' from q q2 where q2.price is null limit 1))
  into r from q;
  if (r->>'n')::int <> n_in then raise exception 'an item on this sale isn''t in your list any more'; end if;
  if r->>'noprice' is not null then raise exception '% has no price for this customer''s level', r->>'noprice'; end if;
  return r;
end $$;

create or replace function _sale_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(s) - 'company_id' || jsonb_build_object('customer', jsonb_build_object('id', c.id, 'name', c.name, 'store_no', c.store_no, 'city', c.city, 'level', c.level, 'terms', c.terms))
  from sales s join customers c on c.id = s.customer_id where s.id = p_id $$;

-- Save a sale. p = {id?, customer_id, lines:[{size_id, ordered, shipped}], action: suspend|review|complete|cancel, why?, lic_reason?}
-- Staff ring up, suspend, send for review and complete; only owners / managers touch a sale that's in review.
create or replace function sale_save(p_company uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r text := _need(p_company, 'staff'); act text := p->>'action'; s sales; cust customers; pr jsonb; num int; sid uuid; who text := _my_name(p_company);
begin
  if act not in ('suspend','review','complete','cancel') then raise exception 'unknown action'; end if;
  sid := nullif(p->>'id','')::uuid;
  if sid is not null then
    select * into s from sales where id = sid and company_id = p_company for update;
    if s.id is null then raise exception 'sale not found'; end if;
    if s.status not in ('suspended','review') then raise exception 'this sale is already %', case s.status when 'posted' then 'an invoice' else 'cancelled' end; end if;
    if s.status = 'review' and r = 'staff' then raise exception 'an owner or manager finishes sales sent for review'; end if;
  end if;
  if act = 'cancel' then
    if s.id is null then raise exception 'nothing to cancel'; end if;
    update sales set status = 'cancelled', updated_at = now() where id = s.id;
    perform _log(p_company, 'sale cancelled', jsonb_build_object('sale', s.id, 'customer', s.customer_id, 'was', s.status, 'total', s.total));
    return _sale_json(s.id);
  end if;
  select * into cust from customers where id = coalesce(nullif(p->>'customer_id','')::uuid, s.customer_id) and company_id = p_company;
  if cust.id is null then raise exception 'pick a customer'; end if;
  if jsonb_array_length(coalesce(p->'lines','[]'::jsonb)) = 0 then raise exception 'scan at least one item'; end if;
  pr := _sale_price(p_company, cust.level, p->'lines');
  if act = 'complete' and (pr->>'units')::int = 0 then raise exception 'nothing is shipped on this sale'; end if;
  if act = 'review' and length(trim(coalesce(p->>'why',''))) = 0 then raise exception 'say what the manager should check'; end if;
  if s.id is null then
    insert into sales(company_id, customer_id, status, by_name) values (p_company, cust.id, 'suspended', who) returning * into s;
  end if;
  update sales set customer_id = cust.id, lines = pr->'lines', total = (pr->>'total')::numeric, units = (pr->>'units')::int, updated_at = now(),
    lic_reason = left(coalesce(nullif(trim(p->>'lic_reason'),''), lic_reason), 200) where id = s.id;
  if act = 'suspend' then
    update sales set status = 'suspended' where id = s.id;
    perform _log(p_company, 'sale suspended', jsonb_build_object('sale', s.id, 'customer', cust.id, 'total', pr->'total'));
  elsif act = 'review' then
    update sales set status = 'review', why = left(trim(p->>'why'), 300), sent_at = now() where id = s.id;
    perform _log(p_company, 'sale sent for review', jsonb_build_object('sale', s.id, 'customer', cust.id, 'why', trim(p->>'why'), 'total', pr->'total'));
  else
    update companies set next_invoice = next_invoice + 1 where id = p_company returning next_invoice - 1 into num;
    update sales set status = 'posted', number = num, posted_at = now(), posted_by = who,
      invoice_date = case when s.status = 'review' then coalesce(s.sent_at, now())::date else current_date end where id = s.id;
    perform _log(p_company, 'invoice posted', jsonb_build_object('sale', s.id, 'number', num, 'customer', cust.id, 'total', pr->'total',
      'license_reason', nullif(trim(coalesce(p->>'lic_reason','')),'')));
  end if;
  return _sale_json(s.id);
end $$;

-- Lists: suspended (everyone), review (owners / managers), posted (everyone, newest first).
create or replace function sales_list(p_company uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r text := _need(p_company, 'staff');
begin
  if p_status not in ('suspended','review','posted') then raise exception 'unknown list'; end if;
  if p_status = 'review' and r = 'staff' then raise exception 'only owners and managers see sales sent for review'; end if;
  return coalesce((select jsonb_agg(j order by (j->>'created_at') desc) from (
    select _sale_json(id) j from sales where company_id = p_company and status = p_status
    order by created_at desc limit case when p_status = 'posted' then 300 else 1000 end) x), '[]'::jsonb);
end $$;

-- The last invoice's lines for a customer (Repeat last order).
create or replace function sale_last(p_company uuid, p_customer uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _need(p_company, 'staff');
  return (select _sale_json(id) from sales where company_id = p_company and customer_id = p_customer and status = 'posted' order by posted_at desc limit 1);
end $$;

-- What a customer owes = their starting balance + their invoices (payments come in Phase 3).
create or replace function _cust_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(c) - 'company_id' - 'import_id' || jsonb_build_object(
    'owes', c.opening + coalesce((select sum(total) from sales s where s.customer_id = c.id and s.status = 'posted'), 0),
    'licenses', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'number', l.number, 'expires', l.expires, 'copy', l.copy) order by l.kind)
      from customer_licenses l where l.customer_id = c.id), '[]'::jsonb))
  from customers c where c.id = p_id $$;

-- Unknown barcodes: the counter logs a scan; picking the item by name records what it was sold as.
create or replace function upc_unknown_scan(p_company uuid, p_upc text, p_sold_as uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u text := regexp_replace(coalesce(p_upc,''), '\D', '', 'g'); who text := _my_name(p_company);
begin
  perform _need(p_company, 'staff');
  if length(u) not between 6 and 14 then return; end if;
  if p_sold_as is not null and not exists (select 1 from items where id = p_sold_as and company_id = p_company) then raise exception 'item not found'; end if;
  insert into unknown_upcs(company_id, upc, times, last_by, sold_as, sold_by) values (p_company, u, case when p_sold_as is null then 1 else 0 end, who, p_sold_as, case when p_sold_as is null then '' else who end)
  on conflict (company_id, upc) do update set
    times = unknown_upcs.times + case when p_sold_as is null then 1 else 0 end,
    last_at = case when p_sold_as is null then now() else unknown_upcs.last_at end,
    last_by = case when p_sold_as is null then who else unknown_upcs.last_by end,
    sold_as = coalesce(p_sold_as, unknown_upcs.sold_as), sold_by = case when p_sold_as is null then unknown_upcs.sold_by else who end,
    status = 'open';
end $$;

-- Open ones (not already on an item since).
create or replace function upc_unknown_list(p_company uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _need(p_company, 'manager');
  return coalesce((select jsonb_agg(jsonb_build_object('upc', u.upc, 'times', u.times, 'first_at', u.first_at, 'last_at', u.last_at, 'last_by', u.last_by,
      'sold_as', u.sold_as, 'sold_as_name', i.name, 'sold_by', u.sold_by) order by u.last_at desc)
    from unknown_upcs u left join items i on i.id = u.sold_as
    where u.company_id = p_company and u.status = 'open'
      and not exists (select 1 from item_sizes z where z.company_id = p_company and z.upc = u.upc)), '[]'::jsonb);
end $$;

-- Add the barcode to a size that has none, or ignore it.
create or replace function upc_unknown_done(p_company uuid, p_upc text, p_action text, p_size uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare z item_sizes; nm text;
begin
  perform _need(p_company, 'manager');
  if p_action = 'ignore' then
    update unknown_upcs set status = 'ignored' where company_id = p_company and upc = p_upc;
    perform _log(p_company, 'barcode ignored', jsonb_build_object('upc', p_upc));
    return upc_unknown_list(p_company);
  end if;
  if p_action <> 'add' then raise exception 'unknown action'; end if;
  select * into z from item_sizes where id = p_size and company_id = p_company;
  if z.id is null then raise exception 'pick a size'; end if;
  if z.upc <> '' then raise exception 'that size already has a barcode — pick another size or add a size to the item'; end if;
  if exists (select 1 from item_sizes where company_id = p_company and upc = p_upc) then raise exception 'that barcode is already on an item'; end if;
  update item_sizes set upc = p_upc where id = z.id;
  update unknown_upcs set status = 'added' where company_id = p_company and upc = p_upc;
  select name into nm from items where id = z.item_id;
  update items set updated_at = now() where id = z.item_id;
  perform _log(p_company, 'barcode added', jsonb_build_object('upc', p_upc, 'item', z.item_id, 'name', nm, 'size', z.name));
  return upc_unknown_list(p_company);
end $$;

-- License rules: 'off' = don't warn at the Counter (owners only; licenses still show on the customer's page and in reports).
create or replace function company_settings_set(p_company uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb := '{}'::jsonb; before jsonb; st text; ks jsonb; r text := _need(p_company, 'manager');
begin
  select settings into before from companies where id = p_company;
  if p ? 'lic_mode' then
    if p->>'lic_mode' not in ('warn','ask','off') then raise exception 'pick only warn, ask for a manager''s OK, or don''t warn at the Counter'; end if;
    if p->>'lic_mode' = 'off' and r <> 'owner' then raise exception 'only owners can turn off the warning at the Counter'; end if;
    s := s || jsonb_build_object('lic_mode', p->>'lic_mode'); end if;
  if p ? 'lic_need' then
    if jsonb_typeof(p->'lic_need') <> 'object' then raise exception 'pick licenses for each state'; end if;
    for st, ks in select * from jsonb_each(p->'lic_need') loop
      if not exists (select 1 from company_states where company_id = p_company and state = st) then raise exception 'you don''t sell in %', st; end if;
      if jsonb_typeof(ks) <> 'array' or exists (select 1 from jsonb_array_elements_text(ks) k where k not in ('resale','location','tobacco','vapor','hemp','beer'))
        then raise exception 'pick licenses from the list'; end if;
    end loop;
    s := s || jsonb_build_object('lic_need', p->'lic_need'); end if;
  if p ? 'remind_days' then
    if (p->>'remind_days')::int not between 0 and 120 then raise exception 'reminders can be 0 to 120 days ahead'; end if;
    s := s || jsonb_build_object('remind_days', (p->>'remind_days')::int); end if;
  if p ? 'default_level' then
    if not exists (select 1 from price_levels where company_id = p_company and n = (p->>'default_level')::int) then raise exception 'pick a price level'; end if;
    s := s || jsonb_build_object('default_level', (p->>'default_level')::int); end if;
  update companies set settings = settings || s where id = p_company;
  perform _log(p_company, 'settings changed', jsonb_build_object('before', before, 'after', s));
  return _company_json(p_company);
end $$;

revoke execute on function _my_name(uuid), _sale_price(uuid,int,jsonb), _sale_json(uuid) from public, anon, authenticated;
revoke execute on function sale_save(uuid,jsonb), sales_list(uuid,text), sale_last(uuid,uuid), upc_unknown_scan(uuid,text,uuid), upc_unknown_list(uuid), upc_unknown_done(uuid,text,text,uuid) from public, anon;
grant execute on function sale_save(uuid,jsonb), sales_list(uuid,text), sale_last(uuid,uuid), upc_unknown_scan(uuid,text,uuid), upc_unknown_list(uuid), upc_unknown_done(uuid,text,text,uuid) to authenticated;

-- =====================================================================
-- Phase 2, piece 3: printing, emailing and the EDI file (2026-11-27)
-- Every line keeps the item # and the SINGLE pack's barcode when it's sold, because the EDI file carries the
-- barcode the store's register scans (a carton line still sends the pack barcode + packs in a carton).
-- What went out is kept on the sale (sales.sends). Emails go from the website (api/send.js), never the browser.
-- =====================================================================
alter table customers add column if not exists edi_email text not null default '';
alter table customers add column if not exists acct_no text not null default '';   -- this store's customer # (EDI file), digits ≤ 6
alter table customers add column if not exists gets jsonb not null default '{}'::jsonb; -- {print, email, edi}: what this store normally gets
alter table sales add column if not exists sends jsonb not null default '[]'::jsonb;  -- [{kind print|email|edi, to, ok, err, by, at}]

create or replace function _sale_price(p_company uuid, p_level int, p_lines jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; n_in int; n_ok int;
begin
  n_in := jsonb_array_length(coalesce(p_lines, '[]'::jsonb));
  with l as (
    select t.ord, (t.x->>'size_id')::uuid sid,
      greatest(coalesce((t.x->>'ordered')::int, 0), 0) ordered, greatest(coalesce((t.x->>'shipped')::int, 0), 0) shipped
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality t(x, ord)),
  j as (
    select l.*, z.name zname, z.n zn, z.upc, z.prices, z.breaks, i.id iid, i.name iname, i.category, i.unit, i.item_no,
      coalesce((select y.upc from item_sizes y where y.item_id = i.id and y.n = 1 and y.upc <> '' order by y.pos limit 1), '') single_upc,
      case when trim(i.break_group) <> '' then 'g:' || lower(trim(i.break_group)) || '|' || lower(trim(z.name)) else 's:' || z.id::text end gk
    from l join item_sizes z on z.id = l.sid and z.company_id = p_company join items i on i.id = z.item_id),
  g as (select gk, sum(shipped) gq from j group by gk),
  p as (
    select j.*, g.gq, _num(j.prices -> (p_level::text)) price,
      coalesce((select max(_num(b->'off')) from jsonb_array_elements(j.breaks) b where (b->>'min')::int <= g.gq), 0) off
    from j join g using (gk)),
  q as (select p.*, round(p.price - p.off, 2) unit_price from p)
  select jsonb_build_object(
    'lines', coalesce(jsonb_agg(jsonb_build_object('size_id', sid, 'item_id', iid, 'name', iname, 'size', zname, 'n', zn, 'unit_name', unit, 'upc', upc, 'item_no', item_no, 'single_upc', single_upc,
      'category', category, 'ordered', ordered, 'shipped', shipped, 'price', price, 'off', off, 'unit_price', unit_price,
      'total', round(unit_price * shipped, 2), 'group_qty', gq) order by ord), '[]'::jsonb),
    'total', coalesce(sum(round(unit_price * shipped, 2)), 0), 'units', coalesce(sum(shipped), 0), 'n', count(*),
    'noprice', (select iname || ' (' || zname || ')' from q q2 where q2.price is null limit 1))
  into r from q;
  if (r->>'n')::int <> n_in then raise exception 'an item on this sale isn''t in your list any more'; end if;
  if r->>'noprice' is not null then raise exception '% has no price for this customer''s level', r->>'noprice'; end if;
  return r;
end $$;

create or replace function customer_put(p_company uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cid uuid := nullif(p->>'id','')::uuid; before jsonb; e text; e2 text; lv int; isnew boolean := cid is null;
begin
  perform _need(p_company, 'manager');
  perform _levels_ensure(p_company);
  if (isnew or p ? 'name') and length(trim(coalesce(p->>'name',''))) = 0 then raise exception 'type the customer''s name'; end if;
  e := lower(trim(coalesce(p->>'email','')));
  if e <> '' and e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'the email doesn''t look right'; end if;
  e2 := lower(trim(coalesce(p->>'edi_email','')));
  if e2 <> '' and e2 !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'the EDI email doesn''t look right'; end if;
  if regexp_replace(coalesce(p->>'acct_no',''), '\s', '', 'g') !~ '^[0-9]{0,6}$' then raise exception 'the customer # for the EDI file is numbers only, at most 6'; end if;
  if p ? 'level' then lv := (p->>'level')::int;
    if not exists (select 1 from price_levels where company_id = p_company and n = lv) then raise exception 'pick a price level'; end if; end if;
  if _num(p->'credit_limit') < 0 then raise exception 'the credit limit can''t be below zero'; end if;
  if isnew then
    insert into customers(company_id, name, level) values (p_company, trim(p->>'name'),
      coalesce(lv, (select (settings->>'default_level')::int from companies where id = p_company), (select min(n) from price_levels where company_id = p_company)))
      returning id into cid;
  else
    if not exists (select 1 from customers where id = cid and company_id = p_company) then raise exception 'customer not found'; end if;
    before := _cust_json(cid) - 'licenses';
  end if;
  update customers set
    name = case when p ? 'name' then trim(p->>'name') else name end,
    store_no = case when p ? 'store_no' then trim(coalesce(p->>'store_no','')) else store_no end,
    phone = case when p ? 'phone' then trim(coalesce(p->>'phone','')) else phone end,
    email = case when p ? 'email' then e else email end,
    addr = case when p ? 'addr' then trim(coalesce(p->>'addr','')) else addr end,
    city = case when p ? 'city' then trim(coalesce(p->>'city','')) else city end,
    state = case when p ? 'state' then coalesce(_clean_state(p->>'state'),'') else state end,
    zip = case when p ? 'zip' then trim(coalesce(p->>'zip','')) else zip end,
    contacts = case when p ? 'contacts' then coalesce((select jsonb_agg(jsonb_build_object('name', trim(coalesce(x->>'name','')), 'role', trim(coalesce(x->>'role','')), 'phone', trim(coalesce(x->>'phone',''))))
      from jsonb_array_elements(p->'contacts') x where trim(coalesce(x->>'name','') || coalesce(x->>'phone','')) <> ''), '[]'::jsonb) else contacts end,
    level = coalesce(lv, level),
    terms = case when p ? 'terms' then p->>'terms' else terms end,
    credit_limit = case when p ? 'credit_limit' then _num(p->'credit_limit') else credit_limit end,
    tobacco = case when p ? 'tobacco' then (p->>'tobacco')::boolean else tobacco end,
    delivery = case when p ? 'delivery' then trim(coalesce(p->>'delivery','')) else delivery end,
    route = case when p ? 'route' then trim(coalesce(p->>'route','')) else route end,
    rep = case when p ? 'rep' then trim(coalesce(p->>'rep','')) else rep end,
    ship_to = case when p ? 'ship_to' then trim(coalesce(p->>'ship_to','')) else ship_to end,
    edi_email = case when p ? 'edi_email' then e2 else edi_email end,
    acct_no = case when p ? 'acct_no' then regexp_replace(coalesce(p->>'acct_no',''), '\s', '', 'g') else acct_no end,
    gets = case when p ? 'gets' then coalesce((select jsonb_object_agg(k, (v)::boolean) from jsonb_each_text(p->'gets') x(k, v) where k in ('print','email','edi') and v in ('true','false')), '{}'::jsonb) else gets end,
    since = case when p ? 'since' then nullif(p->>'since','')::date else since end,
    active = case when p ? 'active' then (p->>'active')::boolean else active end,
    updated_at = now()
  where id = cid;
  perform _opening_put(p_company, cid, p);
  perform _log(p_company, case when isnew then 'customer added' else 'customer changed' end,
    jsonb_build_object('customer', cid, 'name', (select name from customers where id = cid), 'before', before));
  return customer_get(p_company, cid);
end $$;

create or replace function company_settings_set(p_company uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb := '{}'::jsonb; before jsonb; st text; ks jsonb; r text := _need(p_company, 'manager');
begin
  select settings into before from companies where id = p_company;
  if p ? 'lic_mode' then
    if p->>'lic_mode' not in ('warn','ask','off') then raise exception 'pick only warn, ask for a manager''s OK, or don''t warn at the Counter'; end if;
    if p->>'lic_mode' = 'off' and r <> 'owner' then raise exception 'only owners can turn off the warning at the Counter'; end if;
    s := s || jsonb_build_object('lic_mode', p->>'lic_mode'); end if;
  if p ? 'lic_need' then
    if jsonb_typeof(p->'lic_need') <> 'object' then raise exception 'pick licenses for each state'; end if;
    for st, ks in select * from jsonb_each(p->'lic_need') loop
      if not exists (select 1 from company_states where company_id = p_company and state = st) then raise exception 'you don''t sell in %', st; end if;
      if jsonb_typeof(ks) <> 'array' or exists (select 1 from jsonb_array_elements_text(ks) k where k not in ('resale','location','tobacco','vapor','hemp','beer'))
        then raise exception 'pick licenses from the list'; end if;
    end loop;
    s := s || jsonb_build_object('lic_need', p->'lic_need'); end if;
  if p ? 'remind_days' then
    if (p->>'remind_days')::int not between 0 and 120 then raise exception 'reminders can be 0 to 120 days ahead'; end if;
    s := s || jsonb_build_object('remind_days', (p->>'remind_days')::int); end if;
  if p ? 'default_level' then
    if not exists (select 1 from price_levels where company_id = p_company and n = (p->>'default_level')::int) then raise exception 'pick a price level'; end if;
    s := s || jsonb_build_object('default_level', (p->>'default_level')::int); end if;
  if p ? 'inv' then
    if jsonb_typeof(p->'inv') <> 'object' then raise exception 'invoice settings look wrong'; end if;
    if length(coalesce(p->'inv'->>'lic','')) > 600 or length(coalesce(p->'inv'->>'footer','')) > 600 or length(coalesce(p->'inv'->>'tax_text','')) > 120
      then raise exception 'that text is too long for the invoice'; end if;
    if coalesce((p->'inv'->>'copies')::int, 1) not between 1 and 5 then raise exception 'print 1 to 5 copies'; end if;
    s := s || jsonb_build_object('inv', (select jsonb_object_agg(k, v) from jsonb_each(p->'inv') x(k, v)
      where k in ('lic','msa','photos','barcodes','owes','sign','tax_line','tax_text','footer','after','copies'))); end if;
  update companies set settings = settings || s where id = p_company;
  perform _log(p_company, 'settings changed', jsonb_build_object('before', before, 'after', s));
  return _company_json(p_company);
end $$;

-- Everything an invoice needs, for printing, the PDF and the EDI file (also used by the website to send it).
create or replace function invoice_data(p_company uuid, p_sale uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s sales;
begin
  perform _need(p_company, 'staff');
  select * into s from sales where id = p_sale and company_id = p_company;
  if s.id is null then raise exception 'invoice not found'; end if;
  if s.status <> 'posted' then raise exception 'only a completed sale is an invoice'; end if;
  return jsonb_build_object('sale', _sale_json(s.id), 'customer', _cust_json(s.customer_id), 'company', _company_json(p_company));
end $$;

-- Write down what was sent (or printed). Keeps the newest 50.
create or replace function sale_sent(p_company uuid, p_sale uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text := p->>'kind'; who text := _my_name(p_company);
begin
  perform _need(p_company, 'staff');
  if k not in ('print','email','edi','pdf','file') then raise exception 'unknown kind'; end if;
  if not exists (select 1 from sales where id = p_sale and company_id = p_company and status = 'posted') then raise exception 'invoice not found'; end if;
  update sales set sends = (select coalesce(jsonb_agg(x order by ord), '[]'::jsonb) from (
      select x, ord from jsonb_array_elements(sends || jsonb_build_array(jsonb_build_object('kind', k, 'to', left(coalesce(p->>'to',''), 200),
        'ok', coalesce((p->>'ok')::boolean, true), 'err', left(coalesce(p->>'err',''), 300), 'by', who, 'at', now()))) with ordinality t(x, ord)
      order by ord desc limit 50) z)
  where id = p_sale;
  if k in ('email','edi') then
    perform _log(p_company, case when coalesce((p->>'ok')::boolean, true) then 'invoice emailed' else 'invoice email failed' end,
      jsonb_build_object('sale', p_sale, 'kind', k, 'to', p->>'to', 'err', nullif(p->>'err','')));
  end if;
  return _sale_json(p_sale);
end $$;

revoke execute on function invoice_data(uuid,uuid), sale_sent(uuid,uuid,jsonb) from public, anon;
grant execute on function invoice_data(uuid,uuid), sale_sent(uuid,uuid,jsonb) to authenticated;
