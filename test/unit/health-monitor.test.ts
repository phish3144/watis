import { beforeEach, describe, expect, it, vi } from 'vitest'

let online = true
vi.mock('electron', () => ({ net: { isOnline: () => online } }))
vi.mock('../../src/main/logging', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { HealthMonitor } = await import('../../src/main/health/monitor')

describe('HealthMonitor', () => {
  let ready: Record<'archive' | 'contentIndex', boolean>
  let loaded: boolean

  const build = (): InstanceType<typeof HealthMonitor> =>
    new HealthMonitor({
      workerReady: (name) => ready[name],
      whatsappLoaded: () => loaded,
    })

  beforeEach(() => {
    ready = { archive: true, contentIndex: true }
    loaded = true
    online = true
  })

  it('is quiet when everything works', () => {
    const monitor = build()
    monitor.refresh()
    expect(monitor.state().severity).toBe('ok')
  })

  it('follows a worker down and back up', () => {
    const monitor = build()
    ready.archive = false
    monitor.refresh()
    expect(monitor.state().faults).toContain('archive-unavailable')

    ready.archive = true
    monitor.refresh()
    expect(monitor.state().faults).not.toContain('archive-unavailable')
  })

  it('treats a view that never loaded as WhatsApp being offline', () => {
    const monitor = build()
    loaded = false
    monitor.refresh()
    expect(monitor.state().faults).toContain('whatsapp-offline')
  })

  it('reports a full disk from a raw error', () => {
    const monitor = build()
    expect(monitor.report(new Error('ENOSPC: no space left on device'))).toBe('disk-full')
    expect(monitor.state().faults).toContain('disk-full')
  })

  it('ignores an error it does not recognise', () => {
    const monitor = build()
    expect(monitor.report(new Error('chat not found'))).toBeUndefined()
    expect(monitor.state().severity).toBe('ok')
  })

  it('lets a transient fault lapse instead of leaving a permanent banner', () => {
    // A single failed write must not outlive the condition that caused it.
    vi.useFakeTimers()
    try {
      const monitor = build()
      monitor.report(new Error('SQLITE_BUSY'))
      expect(monitor.state().faults).toContain('archive-locked')

      vi.advanceTimersByTime(61_000)
      monitor.refresh()
      expect(monitor.state().faults).not.toContain('archive-locked')
    } finally {
      vi.useRealTimers()
    }
  })

  it('notifies only when the set of faults actually changes', () => {
    const monitor = build()
    const seen: string[][] = []
    monitor.onChange((state) => seen.push([...state.faults]))

    ready.contentIndex = false
    monitor.refresh()
    monitor.refresh()
    monitor.refresh()
    expect(seen).toHaveLength(1)

    ready.contentIndex = true
    monitor.refresh()
    expect(seen).toHaveLength(2)
  })

  it('raises and clears a fault the caller knows about itself', () => {
    const monitor = build()
    monitor.set('bridge-unavailable', true)
    expect(monitor.state().banner).toBe('health.bridge-unavailable')
    monitor.set('bridge-unavailable', false)
    expect(monitor.state().banner).toBeUndefined()
  })
})

describe('a reader can never see a stale answer', () => {
  /**
   * The failure CI finally printed, after two rounds of patching the wrong end:
   *
   *   search=false faults=[archive-unavailable] workers={"archive":true,"contentIndex":true}
   *
   * The worker was ready and the monitor was reporting it unavailable. state() returned a cached
   * copy kept fresh by a one-second poll and, later, by a readiness notification. Both are ways of
   * refreshing a copy; neither removes the window in which the copy is wrong, and the panel showed
   * "broken" over a working archive with a disabled search.
   *
   * So a reader never gets a copy. The sources are three boolean reads.
   */
  it('reflects a worker that came up since the last poll, without waiting for one', () => {
    let archiveReady = false
    const monitor = new HealthMonitor({
      workerReady: (name) => (name === 'archive' ? archiveReady : true),
      whatsappLoaded: () => true,
    })

    // No start(): no timer, no notification. Only what a reader asks for.
    expect(monitor.state().faults).toContain('archive-unavailable')

    archiveReady = true
    expect(monitor.state().faults).not.toContain('archive-unavailable')
    expect(monitor.state().capabilities.find((c) => c.key === 'search')?.available).toBe(true)
  })

  it('reflects a worker that went away, without waiting for one', () => {
    let archiveReady = true
    const monitor = new HealthMonitor({
      workerReady: (name) => (name === 'archive' ? archiveReady : true),
      whatsappLoaded: () => true,
    })
    expect(monitor.state().severity).toBe('ok')

    archiveReady = false
    expect(monitor.state().faults).toContain('archive-unavailable')
  })
})
