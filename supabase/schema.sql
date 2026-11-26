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
