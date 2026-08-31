import Database from 'better-sqlite3'
import { indexForm } from '@shared/search/normalise'
import { INDEX_FORM_FUNCTION, LATEST_VERSION, MIGRATIONS } from './schema'

/**
 * Opens the archive database and brings it to the current schema version.
 *
 * This runs in the archive utilityProcess and nowhere else. better-sqlite3 is synchronous and has no
 * progress callback, so a long query blocks whichever process holds the handle — which is exactly
 * why the main process must never open one (PLAN.md §5.6).
 */
export function openArchive(file: string): Database.Database {
  const db = new Database(file)

  // WAL lets the reader (search) and the writer (import) run at the same time. NORMAL is the
  // matching durability setting: it can lose the last transaction on a power cut, not the database.
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  // A writer that finds the database locked waits instead of failing the batch outright.
  db.pragma('busy_timeout = 5000')

  registerFunctions(db)
  migrate(db)
  return db
}

/**
 * The triggers in the schema call this, so it must exist before any migration runs and on every
 * connection that writes. Marked deterministic so SQLite may use it inside a trigger and cache it.
 */
export function registerFunctions(db: Database.Database): void {
  db.function(INDEX_FORM_FUNCTION, { deterministic: true }, (text: unknown) =>
    typeof text === 'string' ? indexForm(text) : null,
  )
}

export function migrate(db: Database.Database): number {
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

/**
 * Opens the archive from a process that does NOT own the schema — today, the content index.
 *
 * The distinction is not bureaucracy. `openArchive` runs the migrations, and two processes starting
 * together would run them against each other: `journal_mode = WAL` and a deferred transaction that
 * upgrades to a write lock both fail outright when another connection is mid-migration, and
 * `busy_timeout` does not save a deferred transaction from that. The symptom was an archive that
 * occasionally failed to open at startup with no pattern to it.
 *
 * So exactly one process migrates, and everybody else attaches and checks. A version that is not
 * yet current is not an error here — it means the owner has not finished — so this throws and the
 * caller retries.
 */
export function attachArchive(file: string): Database.Database {
  const db = new Database(file)
  // journal_mode is a property of the file and the owner has already set it; issuing it again from
  // a second connection is what fails while the first is writing.
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  registerFunctions(db)

  const version = Number(db.pragma('user_version', { simple: true }))
  if (version !== LATEST_VERSION) {
    db.close()
    throw new Error(
      `archive is at schema version ${String(version)}, waiting for ${String(LATEST_VERSION)}`,
    )
  }
  return db
}
