import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { APP_SLUG } from '@shared/app-identity'
import { isValidAccountId, PRIMARY_ACCOUNT_ID } from '@shared/accounts'

/**
 * Electron puts userData in the ROAMING profile on Windows (%APPDATA%). On a domain account with
 * a roaming profile that would synchronise the entire archive — gigabytes — at every logon.
 *
 * This must run before app.whenReady() and before anything touches `session`. Called late, the
 * calls fail SILENTLY: getPath() reports the new location while the session keeps writing
 * cookies, IndexedDB and cache to the old one. assertPathsApplied() catches that after ready.
 */

export interface AppPaths {
  root: string
  session: string
  archive: string
  blobs: string
  models: string
  logs: string
  downloads: string
}

let paths: AppPaths | undefined

function rootDir(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData) return join(localAppData, APP_SLUG)
    // No LOCALAPPDATA (unusual, but do not silently fall back to roaming).
    return join(homedir(), 'AppData', 'Local', APP_SLUG)
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', APP_SLUG)
  }
  const xdg = process.env.XDG_DATA_HOME
  return xdg ? join(xdg, APP_SLUG) : join(homedir(), '.local', 'share', APP_SLUG)
}

/** Call this as the FIRST statement of the main entry point. */
export function configurePaths(): AppPaths {
  const root = rootDir()
  const resolved: AppPaths = {
    root,
    session: join(root, 'session'),
    archive: join(root, 'archive'),
    blobs: join(root, 'blobs'),
    models: join(root, 'models'),
    logs: join(root, 'logs'),
    downloads: join(app.getPath('downloads'), 'WhatsApp'),
  }

  // setPath throws if the directory does not exist yet.
  for (const dir of [root, resolved.session, resolved.archive, resolved.blobs, resolved.logs]) {
    mkdirSync(dir, { recursive: true })
  }

  app.setPath('userData', root)
  app.setPath('sessionData', resolved.session)
  app.setPath('logs', resolved.logs)

  paths = resolved
  return resolved
}

/**
 * Where one account's data lives (PLAN.md Phase 8).
 *
 * The primary account returns exactly what `appPaths()` returns — the same `session/`, `archive/`
 * and `blobs/` an installation that never heard of accounts already uses. Everything else sits
 * under `accounts/<id>/`. The id is generated, never typed, and validated before it reaches here;
 * this function refuses anything else rather than trusting the caller with a path segment.
 */
export function accountPaths(id: string): AppPaths {
  const base = appPaths()
  if (id === PRIMARY_ACCOUNT_ID) return base
  if (!isValidAccountId(id)) throw new Error(`refusing to build a path for the account id ${id}`)

  const root = join(base.root, 'accounts', id)
  return {
    root,
    session: join(root, 'session'),
    archive: join(root, 'archive'),
    blobs: join(root, 'blobs'),
    // Models and logs are shared: they are neither personal nor per-account, and a second copy of
    // the OCR language data per account would be waste for nothing.
    models: base.models,
    logs: base.logs,
    downloads: base.downloads,
  }
}

/** Creates an account's directories. Called when an account is added, not at every start. */
export function ensureAccountDirs(id: string): AppPaths {
  const resolved = accountPaths(id)
  for (const dir of [resolved.root, resolved.session, resolved.archive, resolved.blobs]) {
    mkdirSync(dir, { recursive: true })
  }
  return resolved
}

export function appPaths(): AppPaths {
  if (!paths) throw new Error('configurePaths() must run before appPaths()')
  return paths
}

/**
 * Proves the redirection actually took effect. A silent failure here means the session is being
 * written into the roaming profile, which is the one outcome the constraint exists to prevent —
 * so this hard-fails instead of warning.
 */
export function assertPathsApplied(): void {
  const expected = appPaths()
  const actual = app.getPath('userData')
  if (actual !== expected.root) {
    throw new Error(
      `userData is ${actual}, expected ${expected.root}. configurePaths() ran too late.`,
    )
  }
}
