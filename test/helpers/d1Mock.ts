import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

function toPlainObject<T>(row: Record<string, unknown>): T {
  return Object.assign({}, row) as T;
}

function makeMeta(changes: number, lastRowId: number, rowsRead: number): D1Meta & Record<string, unknown> {
  return {
    duration: 0,
    size_after: 0,
    rows_read: rowsRead,
    rows_written: changes,
    last_row_id: lastRowId,
    changed_db: changes > 0,
    changes,
  };
}

function toSqlParams(values: unknown[]): SQLInputValue[] {
  return values as SQLInputValue[];
}

export function createTestD1(): { db: D1Database; close: () => void } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  const migrationFiles = ['0001_initial.sql', '0002_indexes.sql', '0003_cards_closing_and_fx.sql'];
  for (const file of migrationFiles) {
    const sql = readFileSync(resolve('migrations', file), 'utf8');
    sqlite.exec(sql);
  }

  const batchExecutors = new WeakMap<D1PreparedStatement, () => D1Result<unknown>>();

  const buildStatement = (stmt: StatementSync, boundParams: SQLInputValue[]): D1PreparedStatement => {
    const runAllSync = <T = Record<string, unknown>>(): D1Result<T> => {
      const rows = stmt.all(...boundParams).map((row) => toPlainObject<T>(row));
      return {
        success: true,
        meta: makeMeta(0, 0, rows.length),
        results: rows,
      };
    };

    const runWriteSync = <T = Record<string, unknown>>(): D1Result<T> => {
      const info = stmt.run(...boundParams);
      const changes = Number(info.changes ?? 0);
      const lastRowId = Number(info.lastInsertRowid ?? 0);
      return {
        success: true,
        meta: makeMeta(changes, lastRowId, 0),
        results: [],
      };
    };

    const execBatchSync = (): D1Result<unknown> => {
      if (stmt.columns().length > 0) {
        return runAllSync();
      }
      return runWriteSync();
    };

    const prepared: D1PreparedStatement = {
      bind(...values: unknown[]): D1PreparedStatement {
        return buildStatement(stmt, toSqlParams(values));
      },

      async first<T = unknown>(colName?: string): Promise<T | null> {
        const row = stmt.get(...boundParams);
        if (!row) return null;
        const plain = toPlainObject<Record<string, unknown>>(row);
        if (colName !== undefined) {
          return (colName in plain ? plain[colName] : null) as T | null;
        }
        return plain as T;
      },

      async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        return runWriteSync<T>();
      },

      async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        return runAllSync<T>();
      },

      raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
        const cols = stmt.columns().map((c) => c.name);
        const rows = stmt.all(...boundParams).map((row) => cols.map((col) => row[col])) as T[];
        if (options?.columnNames) {
          return Promise.resolve([cols, ...rows] as [string[], ...T[]]);
        }
        return Promise.resolve(rows);
      },
    } as D1PreparedStatement;

    batchExecutors.set(prepared, execBatchSync);
    return prepared;
  };

  const executeBatch = async <T = unknown>(
    statements: D1PreparedStatement[]
  ): Promise<D1Result<T>[]> => {
    sqlite.exec('BEGIN');
    try {
      const results: D1Result<T>[] = [];
      for (const st of statements) {
        const execSync = batchExecutors.get(st);
        if (!execSync) {
          throw new Error('Statement was not created by this D1Database instance');
        }
        results.push(execSync() as D1Result<T>);
      }
      sqlite.exec('COMMIT');
      return results;
    } catch (err) {
      try {
        sqlite.exec('ROLLBACK');
      } catch {
        // Ignore rollback errors if no transaction is active
      }
      throw err;
    }
  };

  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      const stmt = sqlite.prepare(query);
      return buildStatement(stmt, []);
    },

    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      return executeBatch<T>(statements);
    },

    async exec(query: string): Promise<D1ExecResult> {
      sqlite.exec(query);
      const count = query
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0).length;
      return { count, duration: 0 };
    },

    withSession(): D1DatabaseSession {
      return {
        prepare: (query: string) => db.prepare(query),
        batch: <T = unknown>(statements: D1PreparedStatement[]) => db.batch<T>(statements),
        getBookmark: () => null,
      };
    },

    async dump(): Promise<ArrayBuffer> {
      throw new Error('dump() is not implemented in createTestD1');
    },
  };

  return {
    db,
    close: () => {
      sqlite.close();
    },
  };
}
