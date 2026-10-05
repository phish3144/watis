import { indexForm } from '@shared/search/normalise'
import { INDEX_FORM_FUNCTION, LATEST_VERSION, MIGRATIONS } from './schema'
import type { SqlDatabase } from './sql'

/**
 * Schema bring-up that is the same for every engine.
 *
 * Split out of `db.ts` because that file opens a better-sqlite3 handle, and anything importing it
 * would drag a native module into the browser bundle. The functions here only speak `SqlDatabase`,
 * so the desktop worker and the extension's worker run the same migrations and register the same
 * search function — one schema, two engines (ADR 0010).
 */

/**
 * The triggers in the schema call this, so it must exist before any migration runs and on every
 * connection that writes. Marked deterministic so SQLite may use it inside a trigger and cache it.
 */
export function registerFunctions(db: SqlDatabase): void {
  db.function(INDEX_FORM_FUNCTION, { deterministic: true }, (text: unknown) =>
    typeof text === 'string' ? indexForm(text) : null,
  )
}

export function migrate(db: SqlDatabase): number {
  const current = Number(db.pragma('user_version', { simple: true }))
  if (current > LATEST_VERSION) {
    // A newer build has already touched this file. Carrying on would run today's code against
    // tomorrow's schema, so stop while the data is still intact.
    throw new Error(
      `archive schema is version ${String(current)}, but this build only knows ${String(LATEST_VERSION)}`,
    )
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue
    // Each migration and its version bump land in one transaction: an interrupted upgrade must not
    // leave a half-migrated database claiming to be finished.
    db.transaction(() => {
      db.exec(migration.sql)
      db.pragma(`user_version = ${String(migration.version)}`)
    })()
  }

  return Number(db.pragma('user_version', { simple: true }))
}
