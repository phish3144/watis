import type { Database, PreparedStatement, Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import type { RunResult, SqlDatabase, SqlStatement } from './sql'

/**
 * SQLite-WASM behind the `SqlDatabase` interface, so the repository written for better-sqlite3 runs
 * unchanged in the browser extension (ADR 0010).
 *
 * Three differences between the engines are absorbed here and nowhere else:
 *
 *  - **Statements are not garbage collected.** better-sqlite3 finalises a statement when the JS
 *    object goes away; in WASM an unfinalised `sqlite3_stmt` lives until the connection closes.
 *    The repository prepares on every call, so without a cache a long session would leak one
 *    statement per search. Statements are therefore cached by SQL text and finalised when they
 *    fall out of a bounded LRU. A wrapper whose statement was evicted re-prepares on its next use,
 *    so a caller holding one across other work never touches a finalised pointer.
 *  - **Named parameters keep their prefix.** better-sqlite3 binds `{ id }` to `@id`; the WASM API
 *    wants `{ '@id': … }`. The names are read once per statement and bound by position.
 *  - **`function()` arity.** The WASM API infers a function's arity from `fn.length`, which for a
 *    rest parameter is 0. Every function is registered variadic instead.
 */

const STATEMENT_CACHE = 256

type Prefixed = '@' | ':' | '$'

export class WasmDatabase implements SqlDatabase {
  readonly #sqlite3: Sqlite3Static
  readonly #db: Database
  readonly #statements = new Map<string, WasmStatement>()
  #depth = 0

  constructor(sqlite3: Sqlite3Static, db: Database) {
    this.#sqlite3 = sqlite3
    this.#db = db
  }

  /** The underlying connection, for the few things the interface does not cover (export, close). */
  get raw(): Database {
    return this.#db
  }

  prepare(source: string): SqlStatement {
    const cached = this.#statements.get(source)
    if (cached) {
      // Map iteration order is insertion order; re-inserting makes this the most recent entry.
      this.#statements.delete(source)
      this.#statements.set(source, cached)
      return cached
    }
    const statement = new WasmStatement(this, source)
    this.#statements.set(source, statement)
    if (this.#statements.size > STATEMENT_CACHE) {
      const oldest = this.#statements.keys().next().value
      if (oldest !== undefined) {
        this.#statements.get(oldest)?.release()
        this.#statements.delete(oldest)
      }
    }
    return statement
  }

  /** @internal Used by WasmStatement to (re)compile its SQL. */
  compile(source: string): PreparedStatement {
    return this.#db.prepare(source)
  }

  /** @internal */
  runResult(): RunResult {
    const rowid = this.#sqlite3.capi.sqlite3_last_insert_rowid(this.#db.pointer as never)
    const asNumber = Number(rowid)
    return {
      changes: this.#db.changes(),
      lastInsertRowid: Number.isSafeInteger(asNumber) ? asNumber : rowid,
    }
  }

  /** @internal */
  parameterName(statement: PreparedStatement, index: number): string | null {
    return this.#sqlite3.capi.sqlite3_bind_parameter_name(statement.pointer as never, index)
  }

  exec(source: string): this {
    this.#db.exec(source)
    return this
  }

  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => {
      const savepoint = `watis_tx_${String(this.#depth)}`
      const nested = this.#depth > 0
      this.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN')
      this.#depth++
      try {
        const result = fn(...args)
        this.#depth--
        this.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT')
        return result
      } catch (error) {
        this.#depth--
        this.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK')
        throw error
      }
    }
  }

  pragma(source: string, options: { simple?: boolean } = {}): unknown {
    const rows = this.prepare(`PRAGMA ${source}`).all() as Record<string, unknown>[]
    if (!options.simple) return rows
    const first = rows[0]
    return first === undefined ? undefined : Object.values(first)[0]
  }

  function(
    name: string,
    options: { deterministic?: boolean },
    fn: (...args: unknown[]) => unknown,
  ): this {
    this.#db.createFunction({
      name,
      arity: -1,
      deterministic: options.deterministic === true,
      xFunc: (_ctx: number, ...values: unknown[]) => fn(...values) as never,
    } as never)
    return this
  }

  close(): void {
    for (const statement of this.#statements.values()) statement.release()
    this.#statements.clear()
    this.#db.close()
  }
}

class WasmStatement implements SqlStatement {
  readonly #owner: WasmDatabase
  readonly #source: string
  #compiled: PreparedStatement | undefined
  /** Parameter names by 1-based index; null for a positional `?`. */
  #names: (string | null)[] = []

  constructor(owner: WasmDatabase, source: string) {
    this.#owner = owner
    this.#source = source
  }

  release(): void {
    this.#compiled?.finalize()
    this.#compiled = undefined
  }

  run(...params: unknown[]): RunResult {
    const stmt = this.#bind(params)
    try {
      while (stmt.step()) {
        // Drain: a statement run for its side effect may still produce rows (RETURNING, PRAGMA).
      }
      return this.#owner.runResult()
    } finally {
      stmt.reset(true)
    }
  }

  get(...params: unknown[]): unknown {
    const stmt = this.#bind(params)
    try {
      return stmt.step() ? stmt.get({}) : undefined
    } finally {
      stmt.reset(true)
    }
  }

  all(...params: unknown[]): unknown[] {
    const stmt = this.#bind(params)
    try {
      const rows: unknown[] = []
      while (stmt.step()) rows.push(stmt.get({}))
      return rows
    } finally {
      stmt.reset(true)
    }
  }

  #statement(): PreparedStatement {
    if (this.#compiled) return this.#compiled
    const compiled = this.#owner.compile(this.#source)
    this.#names = [null]
    for (let i = 1; i <= compiled.parameterCount; i++) {
      this.#names.push(this.#owner.parameterName(compiled, i))
    }
    this.#compiled = compiled
    return compiled
  }

  /**
   * better-sqlite3's calling convention: any number of positional values (arrays are spread), and
   * at most one plain object carrying the named ones.
   */
  #bind(params: unknown[]): PreparedStatement {
    const stmt = this.#statement()
    if (stmt.parameterCount === 0) return stmt

    const positional: unknown[] = []
    let named: Record<string, unknown> | undefined
    for (const param of params) {
      if (Array.isArray(param)) positional.push(...(param as unknown[]))
      else if (isPlainObject(param)) named = param
      else positional.push(param)
    }

    let next = 0
    for (let i = 1; i <= stmt.parameterCount; i++) {
      const name = this.#names[i] ?? null
      let value: unknown
      if (name === null) {
        if (next >= positional.length)
          throw new RangeError('Too few parameter values were provided')
        value = positional[next++]
      } else {
        const key = stripPrefix(name)
        if (!named || !(key in named)) throw new RangeError(`Missing named parameter "${key}"`)
        value = named[key]
      }
      stmt.bind(i, toBindable(value) as never)
    }
    return stmt
  }
}

function stripPrefix(name: string): string {
  const first = name.charAt(0) as Prefixed
  return first === '@' || first === ':' || first === '$' ? name.slice(1) : name
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

/** better-sqlite3 refuses booleans and undefined; matching that keeps both engines honest. */
function toBindable(value: unknown): unknown {
  if (value === undefined) throw new TypeError('undefined cannot be bound; use null')
  if (typeof value === 'boolean') {
    throw new TypeError('SQLite3 can only bind numbers, strings, bigints, buffers, and null')
  }
  return value
}

/** Opens the WASM module's in-memory or VFS-backed database behind the shared interface. */
export function wrap(sqlite3: Sqlite3Static, db: Database): WasmDatabase {
  return new WasmDatabase(sqlite3, db)
}
