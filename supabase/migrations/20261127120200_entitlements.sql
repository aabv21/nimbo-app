-- Premium access: one row per user, written only by the owner (service role) or the dashboard.
-- A grant and a purchase are independent, so a lapsed purchase never removes a grant and a revoked
-- grant never removes a purchase. Rows are created lazily; no row means not premium.

create table public.entitlements (
  user_id uuid primary key references auth.users on delete cascade,
  purchase_active boolean not null default false,
  purchase_expires_at timestamptz,
  purchase_source text check (char_length(purchase_source) <= 32),
  granted boolean not null default false,
  granted_until timestamptz,
  granted_note text check (char_length(granted_note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.entitlements enable row level security;

create policy "entitlements_select_own" on public.entitlements
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.entitlements from anon, authenticated;
grant select on public.entitlements to authenticated;

-- An authenticated caller may ask only about themselves; the service role (no auth.uid()) may ask about anyone.
create function public.has_premium(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and p_user is distinct from (select auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return coalesce(
    (
      select (e.granted and (e.granted_until is null or e.granted_until > pg_catalog.now()))
        or (e.purchase_active and (e.purchase_expires_at is null or e.purchase_expires_at > pg_catalog.now()))
      from public.entitlements e
      where e.user_id = p_user
    ),
    false
  );
end;
$$;

revoke execute on function public.has_premium(uuid) from public, anon;
grant execute on function public.has_premium(uuid) to authenticated, service_role;
