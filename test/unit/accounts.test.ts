import { describe, expect, it } from 'vitest'
import {
  accountId,
  accountSubdir,
  isValidAccountId,
  normaliseAccounts,
  partitionFor,
  primaryAccount,
  PRIMARY_ACCOUNT_ID,
  MAX_ACCOUNTS,
} from '@shared/accounts'

describe('accounts', () => {
  it('keeps the primary account on the original layout', () => {
    // An installation that never heard of accounts already has its data there. Moving somebody's
    // archive to tidy up a directory tree is not a trade this project makes.
    expect(accountSubdir(PRIMARY_ACCOUNT_ID)).toBe('')
    expect(partitionFor(PRIMARY_ACCOUNT_ID)).toBe('persist:wa')
  })

  it('gives every other account its own directory and partition', () => {
    expect(accountSubdir('acct-2')).toBe('accounts/acct-2')
    expect(partitionFor('acct-2')).toBe('persist:acct-2')
  })

  it('generates ids rather than accepting them', () => {
    // Ids reach the filesystem and a partition name; a label somebody typed never becomes a path.
    const existing = [primaryAccount()]
    expect(accountId(existing)).toBe('acct-2')
    expect(accountId([...existing, { id: 'acct-2', label: 'x', primary: false }])).toBe('acct-3')
  })

  it('rejects an id that is not one it would have generated', () => {
    expect(isValidAccountId('default')).toBe(true)
    expect(isValidAccountId('acct-2')).toBe(true)
    expect(isValidAccountId('../escape')).toBe(false)
    expect(isValidAccountId('acct-0')).toBe(false)
    expect(isValidAccountId('acct-')).toBe(false)
    expect(isValidAccountId('persist:wa')).toBe(false)
  })

  it('always produces a primary account, whatever was stored', () => {
    expect(normaliseAccounts(undefined)).toEqual([primaryAccount()])
    expect(normaliseAccounts('nonsense')).toEqual([primaryAccount()])
    expect(normaliseAccounts([]).map((a) => a.id)).toEqual([PRIMARY_ACCOUNT_ID])
    expect(normaliseAccounts([{ id: 'acct-2', label: 'Arbeit' }])[0]?.primary).toBe(true)
  })

  it('drops entries that could reach outside the data root', () => {
    const accounts = normaliseAccounts([
      { id: 'default', label: 'Privat' },
      { id: '../../etc', label: 'böse' },
      { id: 'acct-2', label: 'Arbeit' },
    ])
    expect(accounts.map((a) => a.id)).toEqual(['default', 'acct-2'])
  })

  it('drops duplicates rather than opening one archive twice', () => {
    const accounts = normaliseAccounts([
      { id: 'acct-2', label: 'A' },
      { id: 'acct-2', label: 'B' },
    ])
    expect(accounts.filter((a) => a.id === 'acct-2')).toHaveLength(1)
  })

  it('caps the list', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `acct-${String(i + 2)}`, label: 'x' }))
    expect(normaliseAccounts(many).length).toBeLessThanOrEqual(MAX_ACCOUNTS)
  })

  it('falls back to the id when a label is empty', () => {
    expect(normaliseAccounts([{ id: 'acct-2', label: '   ' }]).at(-1)?.label).toBe('acct-2')
  })
})
