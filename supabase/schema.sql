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

-- Only signed-in people may call the app's functions; the helpers stay private.
revoke execute on function _role_in(uuid), _need(uuid,text), _log(uuid,text,jsonb), _company_json(uuid) from public, anon, authenticated;
revoke execute on function my_companies(), create_company(jsonb), company_put(uuid,jsonb), company_states_set(uuid,text,jsonb),
  members_list(uuid), invite_put(uuid,text,text), invite_remove(uuid,text), member_set(uuid,uuid,text),
  my_name_set(uuid,text), change_log_list(uuid,int) from public, anon;
grant execute on function my_companies(), create_company(jsonb), company_put(uuid,jsonb), company_states_set(uuid,text,jsonb),
  members_list(uuid), invite_put(uuid,text,text), invite_remove(uuid,text), member_set(uuid,uuid,text),
  my_name_set(uuid,text), change_log_list(uuid,int) to authenticated;
