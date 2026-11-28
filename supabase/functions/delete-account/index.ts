import { readEnv } from '../_shared/env.ts';
import { handleDeleteAccount } from './handler.ts';

const env = readEnv((name) => Deno.env.get(name), ['supabase']);

Deno.serve((req) => handleDeleteAccount(req, { env, fetch }));
