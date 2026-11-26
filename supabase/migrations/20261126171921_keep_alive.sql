-- A no-op a scheduled call can hit with the anon key so a free project is not paused for inactivity;
-- it reads nothing and answers the server time.
create function public.keep_alive()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$ select now() $$;

revoke all on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon;
