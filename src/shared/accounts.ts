/**
 * Multiple WhatsApp accounts in one application (PLAN.md Phase 8).
 *
 * Each account gets its own Chromium partition, its own archive and its own blob store. Not a
 * column in a shared table: two accounts are two people's message histories as often as they are
 * one person's work and private numbers, and a filter is a thing that can be got wrong once and
 * show somebody the wrong messages. Separate files cannot be got wrong that way.
 *
 * The first account keeps the original directory layout — `session/`, `archive/`, `blobs/` directly
 * under the data root. Existing installations already have their data there, and moving somebody's
 * archive to tidy up a directory tree is not a trade this project makes.
 */

export interface Account {
  /** Path-safe and stable. Never rendered; `label` is what people see. */
  id: string
  label: string
  /** Created first, keeps the original directory layout. Cannot be deleted. */
  primary: boolean
}

export const PRIMARY_ACCOUNT_ID = 'default'

export const MAX_ACCOUNTS = 5

export const primaryAccount = (): Account => ({
  id: PRIMARY_ACCOUNT_ID,
  label: 'Konto 1',
  primary: true,
})

/**
 * Ids reach the filesystem and a Chromium partition name, so they are generated rather than
 * accepted: a label the user typed never becomes a path.
 */
export function accountId(existing: readonly Account[]): string {
  for (let n = 2; ; n++) {
    const candidate = `acct-${String(n)}`
    if (!existing.some((a) => a.id === candidate)) return candidate
  }
}

export function isValidAccountId(id: string): boolean {
  return id === PRIMARY_ACCOUNT_ID || /^acct-[1-9][0-9]{0,3}$/.test(id)
}

/**
 * The Chromium partition. The primary account keeps `persist:wa` — changing it would orphan the
 * session of every existing installation and mean scanning the QR code again for no reason at all.
 */
export function partitionFor(id: string): string {
  return id === PRIMARY_ACCOUNT_ID ? 'persist:wa' : `persist:${id}`
}

/** Relative directory under the data root, or '' for the primary account's original layout. */
export function accountSubdir(id: string): string {
  return id === PRIMARY_ACCOUNT_ID ? '' : `accounts/${id}`
}

export function normaliseAccounts(raw: unknown): Account[] {
  if (!Array.isArray(raw)) return [primaryAccount()]

  const seen = new Set<string>()
  const accounts: Account[] = []
  for (const entry of raw) {
    const a = entry as Partial<Account>
    if (typeof a?.id !== 'string' || !isValidAccountId(a.id) || seen.has(a.id)) continue
    seen.add(a.id)
    accounts.push({
      id: a.id,
      label: typeof a.label === 'string' && a.label.trim() !== '' ? a.label.slice(0, 60) : a.id,
      primary: a.id === PRIMARY_ACCOUNT_ID,
    })
  }

  // The primary account always exists, whatever the stored list says: it is where the data of an
  // installation that never heard of accounts already lives.
  if (!accounts.some((a) => a.primary)) accounts.unshift(primaryAccount())
  return accounts.slice(0, MAX_ACCOUNTS)
}
