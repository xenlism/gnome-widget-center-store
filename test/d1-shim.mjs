// Wraps node:sqlite's DatabaseSync to expose the same shape D1 gives
// Workers code: db.prepare(sql).bind(...args).run()/.first()/.all().
// This lets us run the actual migrations/0001_init.sql (triggers
// included) and the actual src/db.js against a real SQLite engine,
// instead of hand-rolling a fake that could hide bugs the real D1
// wouldn't have.
import { DatabaseSync } from 'node:sqlite';

export function makeD1(sqlSchema) {
  const raw = new DatabaseSync(':memory:');
  raw.exec(sqlSchema);

  return {
    prepare(sql) {
      return {
        _sql: sql,
        _args: [],
        bind(...args) {
          this._args = args;
          return this;
        },
        async run() {
          const stmt = raw.prepare(this._sql);
          const info = stmt.run(...this._args);
          return { meta: { last_row_id: Number(info.lastInsertRowid), changes: info.changes } };
        },
        async first() {
          const stmt = raw.prepare(this._sql);
          const row = stmt.get(...this._args);
          return row ?? null;
        },
        async all() {
          const stmt = raw.prepare(this._sql);
          const rows = stmt.all(...this._args);
          return { results: rows };
        },
      };
    },
    _raw: raw,
  };
}
