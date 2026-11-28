import { readEnv } from '../_shared/env.ts';
import { handleMonitor } from './handler.ts';

const env = readEnv((name) => Deno.env.get(name), ['supabase', 'weather', 'push', 'monitor']);

Deno.serve((req) => handleMonitor(req, { env, fetch }));
