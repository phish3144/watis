import { describe, expect, it, vi } from 'vitest'
import {
  BackfillMachine,
  type BackfillSnapshot,
  type Effects,
  type LoadResult,
} from '../../src/main/backfill/state-machine'

/** A bridge that hands out a fixed number of pages per chat, then reports the floor. */
function fakeBridge(pages: Record<string, number>, overrides: Partial<Effects> = {}) {
  const remaining = { ...pages }
  const persisted: BackfillSnapshot[] = []
  const opened: string[] = []

  const effects: Effects = {
    earliestReachableTs: () => Promise.resolve(1_600_000_000),
    loadOlder: (chatId): Promise<LoadResult> => {
      opened.push(chatId)
      const left = remaining[chatId] ?? 0
      if (left <= 0) return Promise.resolve({ loaded: 0, atFloor: true })
      remaining[chatId] = left - 1
      return Promise.resolve({ loaded: 50, oldestTs: 1_600_000_000 + left })
    },
    wait: () => Promise.resolve(),
    canRun: () => Promise.resolve(true),
    persist: (s) => {
      persisted.push(s)
    },
    ...overrides,
  }
  return { effects, persisted, opened }
}

describe('BackfillMachine', () => {
  it('walks a chat until WhatsApp reports the floor', async () => {
    const { effects, opened } = fakeBridge({ c1: 3 })
    const machine = new BackfillMachine(effects)
    machine.enqueue(['c1'])

    const snapshot = await machine.run()
    expect(snapshot.chats[0]).toMatchObject({ chatId: 'c1', state: 'done', messages: 150 })
    // Three pages plus the one that reports the floor.
    expect(opened).toHaveLength(4)
  })

  it('stops on an empty page even without an explicit floor flag', async () => {
    const effects = fakeBridge({}).effects
    effects.loadOlder = () => Promise.resolve({ loaded: 0 })
    const machine = new BackfillMachine(effects)
    machine.enqueue(['c1'])

    expect((await machine.run()).chats[0]?.state).toBe('done')
  })

  it('does one chat at a time, in queue order', async () => {
    const { effects, opened } = fakeBridge({ c1: 1, c2: 1 })
    const machine = new BackfillMachine(effects)
    machine.enqueue(['c1', 'c2'])
    await machine.run()

    // c1 must be finished before c2 is touched at all.
    expect(opened.indexOf('c2')).toBeGreaterThan(opened.lastIndexOf('c1'))
  })

  it('reads the reachable date from the bridge instead of assuming one', async () => {
    // ADR 0005 A: the 90-day figure is WhatsApp's and can change.
    const { effects } = fakeBridge({ c1: 0 })
    effects.earliestReachableTs = () => Promise.resolve(1_712_345_678)
    const machine = new BackfillMachine(effects)
    machine.enqueue(['c1'])

    expect((await machine.run()).reachableTs).toBe(1_712_345_678)
  })

  it('reports an unknown reachable date rather than inventing one', async () => {
    const { effects } = fakeBridge({ c1: 0 })
    effects.earliestReachableTs = () => Promise.resolve(undefined)
    const machine = new BackfillMachine(effects)
    machine.enqueue(['c1'])

    expect((await machine.run()).reachableTs).toBeUndefined()
  })

  it('pauses while the user is active and resumes afterwards', async () => {
    let allowed = false
    const { effects, opened } = fakeBridge({ c1: 1 })
    const states: string[] = []
    effects.canRun = () => {
      const answer = allowed
      allowed = true
      return Promise.resolve(answer)
    }
    effects.onChange = (s) => {
      const state = s.chats[0]?.state
      if (state && states[states.length - 1] !== state) states.push(state)
    }

    const machine = new BackfillMachine(effects)
    machine.enqueue(['c1'])
    await machine.run()

    expect(states).toContain('paused')
    expect(states[states.length - 1]).toBe('done')
    expect(opened.length).toBeGreaterThan(0)
  })

  it('retries a failing chat and gives up after the attempt limit', async () => {
    const { effects } = fakeBridge({})
    effects.loadOlder = () => Promise.reject(new Error('bridge weg'))
    const wait = vi.fn(() => Promise.resolve())
    effects.wait = wait

    const machine = new BackfillMachine(effects, { maxAttempts: 3 })
    machine.enqueue(['c1'])
    const snapshot = await machine.run()

    expect(snapshot.chats[0]).toMatchObject({ state: 'failed' })
    expect(snapshot.chats[0]?.lastError).toContain('bridge weg')
    // Backs off between attempts rather than hammering.
    expect(wait).toHaveBeenCalledTimes(2)
  })

  it('recovers from a transient failure without losing the chat', async () => {
    let calls = 0
    const { effects } = fakeBridge({})
    effects.loadOlder = () => {
      calls++
      if (calls === 1) return Promise.reject(new Error('kurzer Aussetzer'))
      return Promise.resolve({ loaded: 0, atFloor: true })
    }

    const machine = new BackfillMachine(effects)
    machine.enqueue(['c1'])
    expect((await machine.run()).chats[0]?.state).toBe('done')
  })

  it('keeps one failing chat from stopping the others', async () => {
    const { effects } = fakeBridge({ c2: 1 })
    const original = effects.loadOlder
    effects.loadOlder = (id) => (id === 'c1' ? Promise.reject(new Error('kaputt')) : original(id))

    const machine = new BackfillMachine(effects, { maxAttempts: 1 })
    machine.enqueue(['c1', 'c2'])
    const snapshot = await machine.run()

    expect(snapshot.chats.find((c) => c.chatId === 'c1')?.state).toBe('failed')
    expect(snapshot.chats.find((c) => c.chatId === 'c2')?.state).toBe('done')
  })

  it('terminates a chat that never reports its floor', async () => {
    // Otherwise the run would never end.
    const { effects } = fakeBridge({})
    effects.loadOlder = () => Promise.resolve({ loaded: 10 })
    const machine = new BackfillMachine(effects, { maxBatchesPerChat: 5 })
    machine.enqueue(['c1'])

    const snapshot = await machine.run()
    expect(snapshot.chats[0]).toMatchObject({ state: 'done', batches: 5 })
    expect(snapshot.chats[0]?.lastError).toContain('batch limit')
  })

  it('stops when asked and leaves the chat resumable', async () => {
    const { effects } = fakeBridge({ c1: 100 })
    const machine = new BackfillMachine(effects)
    effects.onChange = (s) => {
      if ((s.chats[0]?.batches ?? 0) >= 2) machine.stop()
    }
    machine.enqueue(['c1'])
    const snapshot = await machine.run()

    expect(snapshot.running).toBe(false)
    expect(snapshot.chats[0]?.state).toBe('queued')
    expect(snapshot.chats[0]?.batches).toBeGreaterThanOrEqual(2)
  })

  it('resumes from a persisted run instead of starting over', async () => {
    const { effects, opened } = fakeBridge({ c2: 1 })
    const restored = BackfillMachine.restore(
      {
        running: false,
        chats: [
          { chatId: 'c1', state: 'done', batches: 9, messages: 450 },
          { chatId: 'c2', state: 'queued', batches: 0, messages: 0 },
        ],
      },
      effects,
    )

    await restored.run()
    expect(opened).not.toContain('c1')
    expect(opened).toContain('c2')
  })

  it('re-queues a chat that was mid-flight when the process died', async () => {
    const { effects, opened } = fakeBridge({ c1: 1 })
    const restored = BackfillMachine.restore(
      {
        running: true,
        current: 'c1',
        chats: [{ chatId: 'c1', state: 'running', batches: 4, messages: 200 }],
      },
      effects,
    )
    await restored.run()

    // "running" cannot survive a process that is gone; it must be picked up again.
    expect(opened).toContain('c1')
    expect(restored.snapshot().chats[0]?.state).toBe('done')
  })

  it('persists progress as it goes, so a crash loses at most one batch', async () => {
    const { effects, persisted } = fakeBridge({ c1: 3 })
    const machine = new BackfillMachine(effects)
    machine.enqueue(['c1'])
    await machine.run()

    expect(persisted.length).toBeGreaterThan(3)
  })

  it('moves a chat to the front when the user asks', async () => {
    const { effects, opened } = fakeBridge({ a: 1, b: 1, c: 1 })
    const machine = new BackfillMachine(effects)
    machine.enqueue(['a', 'b', 'c'])
    machine.prioritise('c')
    await machine.run()

    expect(opened[0]).toBe('c')
  })

  it('ignores enqueueing the same chat twice', () => {
    const { effects } = fakeBridge({})
    const machine = new BackfillMachine(effects)
    machine.enqueue(['c1', 'c1'])
    expect(machine.snapshot().chats).toHaveLength(1)
  })
})
