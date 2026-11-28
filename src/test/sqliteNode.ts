// expo-sqlite's synchronous API over `node:sqlite`, for Jest: unit suites `jest.mock('expo-sqlite', …)` it and
// the `integration` project maps `expo-sqlite` to it. Each `openDatabaseSync` is a fresh in-memory database.
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';

type BindValue = string | number | null | boolean | Uint8Array;
type BindParams = readonly BindValue[] | Readonly<Record<string, BindValue>>;

// node:sqlite rejects booleans, which expo-sqlite binds as 0 and 1.
function toInput(value: BindValue): SQLInputValue {
  return typeof value === 'boolean' ? Number(value) : value;
}

/** expo-sqlite's three param forms (an array, variadic values, a named object) as node:sqlite takes them. */
function bind(params: readonly (BindValue | BindParams)[]): { named: Record<string, SQLInputValue> | null; values: SQLInputValue[] } {
  const [first] = params;
  if (params.length === 1 && first !== null && typeof first === 'object' && !(first instanceof Uint8Array) && !Array.isArray(first)) {
    const entries = Object.entries(first as Readonly<Record<string, BindValue>>);
    return { named: Object.fromEntries(entries.map(([key, value]) => [key, toInput(value)])), values: [] };
  }
  const values = params.length === 1 && Array.isArray(first) ? (first as readonly BindValue[]) : (params as readonly BindValue[]);
  return { named: null, values: values.map(toInput) };
}

export interface SQLiteRunResult {
  changes: number;
  lastInsertRowId: number;
}

export class SQLiteDatabase {
  private readonly db = new DatabaseSync(':memory:');

  execSync(source: string): void {
    this.db.exec(source);
  }

  runSync(source: string, ...params: (BindValue | BindParams)[]): SQLiteRunResult {
    const { named, values } = bind(params);
    const statement = this.db.prepare(source);
    const result = named === null ? statement.run(...values) : statement.run(named);
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  }

  // Typed loosely: app code sees expo-sqlite's own generic signatures, never these.
  getFirstSync(source: string, ...params: (BindValue | BindParams)[]): object | null {
    const { named, values } = bind(params);
    const statement = this.db.prepare(source);
    const row = named === null ? statement.get(...values) : statement.get(named);
    return row === undefined ? null : { ...row };
  }

  getAllSync(source: string, ...params: (BindValue | BindParams)[]): object[] {
    const { named, values } = bind(params);
    const statement = this.db.prepare(source);
    const rows = named === null ? statement.all(...values) : statement.all(named);
    return rows.map((row) => ({ ...row }));
  }

  /** Like expo-sqlite: a nested call fails on the inner `BEGIN` rather than joining the outer one. */
  withTransactionSync(task: () => void): void {
    this.db.exec('BEGIN');
    try {
      task();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  closeSync(): void {
    this.db.close();
  }
}

/** The name is ignored: every call is a new, empty database. */
export function openDatabaseSync(): SQLiteDatabase {
  return new SQLiteDatabase();
}
