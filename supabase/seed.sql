-- No reference data: profiles are created by the signup trigger, and the app keeps none in the database. Only the
-- local Vault secrets of the monitor job (public.request_monitor); the hosted project sets its own by hand
-- (docs/local-stack.md#the-hourly-monitor), never from this file.

-- Must match MONITOR_SECRET in supabase/config.toml's [edge_runtime.secrets].
select vault.create_secret('local-only-not-a-secret', 'monitor_secret');

-- The function as seen from the db container: Kong's container name on the stack's Docker network (pg_net runs
-- inside the db container, where 127.0.0.1 is the container itself). Proven by integration/monitor.int.test.ts.
select vault.create_secret('http://supabase_kong_nimbo-app:8000/functions/v1/monitor', 'monitor_url');
