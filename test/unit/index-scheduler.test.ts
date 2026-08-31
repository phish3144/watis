import { describe, expect, it } from 'vitest'
import { decide, explain, type SchedulerSignals } from '../../src/workers/content-index/scheduler'

const signals = (over: Partial<SchedulerSignals> = {}): SchedulerSignals => ({
  idleSeconds: () => 300,
  onMainsPower: () => true,
  paused: () => false,
  ...over,
})

describe('decide', () => {
  it('runs when idle, on mains and not paused', () => {
    expect(decide(signals())).toEqual({ run: true, concurrency: 1 })
  })

  it('waits while the user is active', () => {
    expect(decide(signals({ idleSeconds: () => 5 }))).toEqual({ run: false, reason: 'user-active' })
  })

  it('waits on battery', () => {
    expect(decide(signals({ onMainsPower: () => false }))).toEqual({
      run: false,
      reason: 'on-battery',
    })
  })

  it('runs on battery when the user allows it', () => {
    expect(decide(signals({ onMainsPower: () => false }), { allowOnBattery: true }).run).toBe(true)
  })

  it('runs on a machine that has no battery to report', () => {
    // Treating "unknown" as "on battery" would mean a desktop never indexes at all.
    expect(decide(signals({ onMainsPower: () => undefined })).run).toBe(true)
  })

  it('lets the pause switch outrank every other signal', () => {
    expect(
      decide(signals({ paused: () => true, idleSeconds: () => 9999, onMainsPower: () => true })),
    ).toEqual({ run: false, reason: 'paused' })
  })

  it('honours the idle threshold', () => {
    expect(decide(signals({ idleSeconds: () => 30 }), { idleThresholdSeconds: 20 }).run).toBe(true)
    expect(decide(signals({ idleSeconds: () => 10 }), { idleThresholdSeconds: 20 }).run).toBe(false)
  })

  it('clamps concurrency into a sane range', () => {
    expect(decide(signals(), { concurrency: 0 })).toMatchObject({ concurrency: 1 })
    expect(decide(signals(), { concurrency: 99 })).toMatchObject({ concurrency: 4 })
  })
})

describe('explain', () => {
  it('says why the queue is not moving', () => {
    expect(explain({ run: false, reason: 'on-battery' })).toBe('wartet auf Netzstrom')
    expect(explain({ run: false, reason: 'paused' })).toBe('pausiert')
    expect(explain({ run: true, concurrency: 2 })).toContain('2')
  })
})
