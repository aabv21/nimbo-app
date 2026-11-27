// A small in-memory PostgREST for the companion tests: the filters, order and limit the tools send,
// `Prefer: count=exact`, and the note RPCs. Every call is recorded, so a test can check what was asked.
import { fakeFetch, json } from '../../__tests__/fakeFetch.ts';

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export const SUPABASE_URL = 'http://supabase.test';
export const USER_AUTH = 'Bearer user-jwt';

type Filter = (row: Row) => boolean;

function compare(a: unknown, b: string): number {
  const left = String(a);
  return left < b ? -1 : left > b ? 1 : 0;
}

function filterOf(column: string, expression: string): Filter {
  const negated = expression.startsWith('not.');
  const body = negated ? expression.slice(4) : expression;
  const dot = body.indexOf('.');
  const op = body.slice(0, dot);
  const value = body.slice(dot + 1);
  const test: Filter = (row) => {
    const cell = row[column];
    switch (op) {
      case 'eq':
        return String(cell) === value;
      case 'is':
        return value === 'null' ? cell === null || cell === undefined : String(cell) === value;
      case 'gte':
        return cell !== null && compare(cell, value) >= 0;
      case 'gt':
        return cell !== null && compare(cell, value) > 0;
      case 'lt':
        return cell !== null && compare(cell, value) < 0;
      case 'lte':
        return cell !== null && compare(cell, value) <= 0;
      case 'in':
        return value.slice(1, -1).split(',').includes(String(cell));
      default:
        throw new Error(`fake PostgREST: unsupported operator ${op}`);
    }
  };
  return negated ? (row) => !test(row) : test;
}

/** Rows of `table` for a GET's query, and the total before `limit`. */
function query(rows: Row[], params: URLSearchParams): { rows: Row[]; total: number } {
  let result = [...rows];
  for (const [key, value] of params) {
    if (key === 'select' || key === 'order' || key === 'limit') continue;
    result = result.filter(filterOf(key, value));
  }
  const total = result.length;
  const order = params.get('order');
  if (order !== null) {
    const [column = '', direction] = order.split('.');
    result.sort((a, b) => compare(a[column], String(b[column])) * (direction === 'desc' ? -1 : 1));
  }
  const limit = params.get('limit');
  if (limit !== null) result = result.slice(0, Number(limit));
  const select = params.get('select');
  if (select === null || select === '*') throw new Error('fake PostgREST: every read must name its columns');
  const columns = select.split(',');
  return { rows: result.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? null]))), total };
}

/** A fake fetch serving `tables` under `SUPABASE_URL`; `rpc` answers the RPCs a test needs, by name. */
export function fakePostgrest(
  tables: Tables,
  rpc: Record<string, (args: Record<string, unknown>) => Response> = {},
  other: (url: URL, init: RequestInit) => Response | Promise<Response> = () => json(404, {}),
) {
  return fakeFetch((call, init) => {
    if (call.url.origin !== SUPABASE_URL) return other(call.url, init);
    const path = call.url.pathname;
    if (path.startsWith('/rest/v1/rpc/')) {
      const handler = rpc[path.slice('/rest/v1/rpc/'.length)];
      if (handler === undefined) return json(404, { code: 'PGRST202' });
      return handler(JSON.parse(call.body ?? '{}') as Record<string, unknown>);
    }
    const table = tables[path.slice('/rest/v1/'.length)];
    if (table === undefined || call.method !== 'GET') return json(404, { code: 'PGRST205' });
    const { rows, total } = query(table, call.url.searchParams);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (call.headers.get('prefer') === 'count=exact') headers['content-range'] = `0-${String(Math.max(rows.length - 1, 0))}/${String(total)}`;
    return new Response(JSON.stringify(rows), { status: 200, headers });
  });
}
