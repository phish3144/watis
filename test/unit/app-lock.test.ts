import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root: string

vi.mock('electron', () => ({}))
vi.mock('../../src/main/paths', () => ({ appPaths: () => ({ root }) }))
vi.mock('../../src/main/logging', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { AppLock } = await import('../../src/main/lock')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'watis-lock-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('AppLock', () => {
  it('is not in the way when no PIN is set', async () => {
    const lock = new AppLock()
    await lock.load()
    expect(lock.state()).toMatchObject({ configured: false, locked: false })
    expect(lock.isLocked).toBe(false)
    // Unlocking an unconfigured lock succeeds rather than refusing: there is nothing to prove.
    expect(lock.unlock('anything')).toBe(true)
  })

  it('never writes the PIN itself to disk', async () => {
    // The stored form does not protect the archive — nothing in this feature does. It exists
    // because people reuse PINs, and leaving a banking PIN in a file beside their messages
    // would be its own small harm.
    const lock = new AppLock()
    await lock.configure('4711', 0)
    const stored = readFileSync(join(root, 'lock.json'), 'utf8')
    expect(stored).not.toContain('4711')
    const parsed = JSON.parse(stored) as { salt: string; hash: string }
    expect(parsed.salt).toMatch(/^[0-9a-f]{32}$/)
    expect(parsed.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('accepts the right PIN and refuses a wrong one', async () => {
    const lock = new AppLock()
    await lock.configure('4711', 0)
    lock.lock()
    expect(lock.unlock('1234')).toBe(false)
    expect(lock.isLocked).toBe(true)
    expect(lock.unlock('4711')).toBe(true)
    expect(lock.isLocked).toBe(false)
  })

  it('starts locked when a PIN was configured before', async () => {
    // Anything else would be a lock that only works when the machine happened to be idle.
    await new AppLock().configure('4711', 0)
    const restarted = new AppLock()
    await restarted.load()
    expect(restarted.isLocked).toBe(true)
    expect(restarted.unlock('4711')).toBe(true)
  })

  it('uses a fresh salt each time, so the same PIN does not store the same hash', async () => {
    const first = new AppLock()
    await first.configure('4711', 0)
    const a = JSON.parse(readFileSync(join(root, 'lock.json'), 'utf8')) as { hash: string }
    const second = new AppLock()
    await second.configure('4711', 0)
    const b = JSON.parse(readFileSync(join(root, 'lock.json'), 'utf8')) as { hash: string }
    expect(a.hash).not.toBe(b.hash)
  })

  it('removes the file when the PIN is cleared', async () => {
    const lock = new AppLock()
    await lock.configure('4711', 0)
    await lock.configure('', 0)
    expect(existsSync(join(root, 'lock.json'))).toBe(false)
    expect(lock.state().configured).toBe(false)
  })

  it('locks after the idle limit and not before', async () => {
    const lock = new AppLock()
    await lock.configure('4711', 300)
    expect(lock.lockIfIdle(299)).toBe(false)
    expect(lock.isLocked).toBe(false)
    expect(lock.lockIfIdle(300)).toBe(true)
    expect(lock.isLocked).toBe(true)
    // Already locked: nothing further to report.
    expect(lock.lockIfIdle(9999)).toBe(false)
  })

  it('never locks on idle when the limit is zero', async () => {
    const lock = new AppLock()
    await lock.configure('4711', 0)
    expect(lock.lockIfIdle(100_000)).toBe(false)
  })

  it('treats a damaged lock file as no lock rather than locking everybody out', async () => {
    // A file that cannot be read is not a reason to make the archive unreachable.
    const lock = new AppLock()
    await lock.configure('4711', 0)
    rmSync(join(root, 'lock.json'))
    const restarted = new AppLock()
    await restarted.load()
    expect(restarted.state().configured).toBe(false)
  })
})
