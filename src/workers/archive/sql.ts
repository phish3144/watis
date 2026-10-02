/**
 * The slice of a SQLite connection the archive actually uses.
 *
 * Two engines sit behind it: better-sqlite3 in the desktop app's utilityProcess, and SQLite-WASM
 * in the browser extension's worker (ADR 0010). The repository, the schema and the migrations are
 * written once against this interface, so a search behaves the same in both — the same SQL, the
 * same triggers, the same normalisation. A second copy of the repository for the browser would be
 * the place the two would quietly start to disagree.
 *
 * It is deliberately the shape of better-sqlite3's API rather than a new one: that is what the
 * existing code already speaks, and better-sqlite3's `Database` satisfies it as it stands. The WASM
 * side adapts to it (`sqlite-wasm.ts`).
 */

export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

/**
 * Parameters follow better-sqlite3: positional values, or one object whose keys are the named
 * parameters without their `@`, `:` or `$` prefix.
 */
export interface SqlStatement {
  run(...params: unknown[]): RunResult
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export interface SqlDatabase {
  prepare(source: string): SqlStatement
  /** Runs one or more statements without results. */
  exec(source: string): unknown
  /**
   * Wraps `fn` so that a call runs inside one transaction: committed when it returns, rolled back
   * when it throws. Nested calls become savepoints.
   */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R
  /** `simple` returns the first column of the first row instead of the rows. */
  pragma(source: string, options?: { simple?: boolean }): unknown
  function(
    name: string,
    options: { deterministic?: boolean },
    fn: (...args: unknown[]) => unknown,
  ): unknown
  close(): unknown
}
