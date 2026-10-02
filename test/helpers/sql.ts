import Database from 'better-sqlite3'
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { migrate, registerFunctions } from '../../src/workers/archive/migrate'
import type { SqlDatabase } from '../../src/workers/archive/sql'
import { wrap } from '../../src/workers/archive/sqlite-wasm'

/**
 * Which engine the archive tests run against.
 *
 * The integration tests for the repository and the schema run twice — once on better-sqlite3 (the
 * desktop app) and once on SQLite-WASM (the browser extension) — selected by WATIS_SQL_BACKEND in
 * the vitest project config. Same tests, same assertions: if the two engines ever disagree about a
 * search, a trigger or a migration, one of the two runs goes red (ADR 0010).
 */
export const backend: 'native' | 'wasm' =
  process.env.WATIS_SQL_BACKEND === 'wasm' ? 'wasm' : 'native'

const sqlite3 = backend === 'wasm' ? await sqlite3InitModule() : undefined

/** An empty in-memory connection on the selected engine, with nothing applied yet. */
export function openMemory(): SqlDatabase {
  if (sqlite3) return wrap(sqlite3, new sqlite3.oo1.DB(':memory:', 'c'))
  return new Database(':memory:')
}

/** An in-memory archive at the current schema version. */
export function openArchiveMemory(): SqlDatabase {
  const db = openMemory()
  registerFunctions(db)
  migrate(db)
  return db
}
