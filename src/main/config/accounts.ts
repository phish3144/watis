import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  accountId,
  MAX_ACCOUNTS,
  normaliseAccounts,
  PRIMARY_ACCOUNT_ID,
  primaryAccount,
  type Account,
} from '@shared/accounts'
import { appPaths, ensureAccountDirs } from '../paths'
import { log } from '../logging'

/**
 * The account list (PLAN.md Phase 8).
 *
 * Kept in its own file rather than in `settings.json`: settings are a patch-and-merge structure the
 * renderer writes to freely, and an account entry points at a directory full of somebody's
 * messages. Those are not the same kind of value and should not be edited by the same path.
 */

interface AccountFile {
  accounts: Account[]
  activeId: string
}

let state: AccountFile = { accounts: [primaryAccount()], activeId: PRIMARY_ACCOUNT_ID }

function file(): string {
  return join(appPaths().root, 'accounts.json')
}

export async function initAccounts(): Promise<AccountFile> {
  try {
    const raw = JSON.parse(await readFile(file(), 'utf8')) as Partial<AccountFile>
    const accounts = normaliseAccounts(raw.accounts)
    state = {
      accounts,
      activeId: accounts.some((a) => a.id === raw.activeId)
        ? (raw.activeId ?? PRIMARY_ACCOUNT_ID)
        : PRIMARY_ACCOUNT_ID,
    }
  } catch {
    // No file is the normal case for every installation that predates accounts.
    state = { accounts: [primaryAccount()], activeId: PRIMARY_ACCOUNT_ID }
  }
  for (const account of state.accounts) ensureAccountDirs(account.id)
  return state
}

export function accounts(): Account[] {
  return state.accounts.map((a) => ({ ...a }))
}

export function activeAccountId(): string {
  return state.activeId
}

async function persist(): Promise<void> {
  try {
    await writeFile(file(), JSON.stringify(state, null, 2), 'utf8')
  } catch (error: unknown) {
    log.warn(`could not save the account list: ${String(error)}`)
  }
}

export async function addAccount(label: string): Promise<Account> {
  if (state.accounts.length >= MAX_ACCOUNTS) {
    throw new Error(`at most ${String(MAX_ACCOUNTS)} accounts`)
  }
  const account: Account = {
    id: accountId(state.accounts),
    label: label.trim().slice(0, 60) || `Konto ${String(state.accounts.length + 1)}`,
    primary: false,
  }
  state.accounts = [...state.accounts, account]
  ensureAccountDirs(account.id)
  await persist()
  log.info(`account ${account.id} added`)
  return account
}

export async function renameAccount(id: string, label: string): Promise<Account[]> {
  state.accounts = state.accounts.map((a) =>
    a.id === id ? { ...a, label: label.trim().slice(0, 60) || a.label } : a,
  )
  await persist()
  return accounts()
}

/**
 * Removes an account from the list. **The data stays on disk.**
 *
 * Deleting a directory full of somebody's messages because they clicked a button in a list is not
 * a thing this application does silently. The directory is named in the log and in the return
 * value so it can be removed deliberately, by a person who meant it.
 */
export async function removeAccount(id: string): Promise<{ accounts: Account[]; dataDir: string }> {
  if (id === PRIMARY_ACCOUNT_ID) throw new Error('the first account cannot be removed')
  const { accountPaths } = await import('../paths')
  const dataDir = accountPaths(id).root

  state.accounts = state.accounts.filter((a) => a.id !== id)
  if (state.activeId === id) state.activeId = PRIMARY_ACCOUNT_ID
  await persist()
  log.info(`account ${id} removed from the list; its data stays at ${dataDir}`)
  return { accounts: accounts(), dataDir }
}

export async function setActiveAccount(id: string): Promise<string> {
  if (!state.accounts.some((a) => a.id === id)) throw new Error(`unknown account ${id}`)
  state.activeId = id
  await persist()
  return id
}
