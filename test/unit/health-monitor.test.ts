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
