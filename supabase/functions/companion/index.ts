import { readEnv } from '../_shared/env.ts';
import { handleCompanion } from './handler.ts';

const env = readEnv((name) => Deno.env.get(name), ['supabase', 'jev', 'claude']);

Deno.serve((req) => handleCompanion(req, { env, fetch }));
