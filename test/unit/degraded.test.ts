import { describe, expect, it } from 'vitest'
import { assess, canStillReadMessages, faultFromError } from '@shared/health/degraded'

const available = (state: ReturnType<typeof assess>, key: string): boolean =>
  state.capabilities.find((c) => c.key === key)?.available ?? false

describe('assess', () => {
  it('reports everything working', () => {
    const state = assess([])
    expect(state.severity).toBe('ok')
    expect(state.banner).toBeUndefined()
    expect(state.capabilities.every((c) => c.available)).toBe(true)
  })

  it('keeps the archive searchable when the bridge dies', () => {
    // Losing the bridge must not cost the user what is already archived — that distinction is the
    // difference between a degraded application and a dead one.
    const state = assess(['bridge-unavailable'])
    expect(available(state, 'search')).toBe(true)
    expect(available(state, 'archiveGrows')).toBe(false)
    expect(state.severity).toBe('degraded')
  })

  it('calls it broken only when search is gone', () => {
    expect(assess(['archive-unavailable']).severity).toBe('broken')
  })

  it('never takes reading away, whatever fails', () => {
    // WhatsApp Web keeps running in its view; the wrapper failing must not cost the messenger.
    const state = assess([
      'disk-full',
      'archive-unavailable',
      'bridge-unavailable',
      'index-unavailable',
    ])
    expect(canStillReadMessages(state)).toBe(true)
  })

  it('attributes a capability to the fault worth acting on', () => {
    // Both would stop the archive growing; a full disk is the one the user can do something about.
    const state = assess(['whatsapp-offline', 'disk-full'])
    expect(state.capabilities.find((c) => c.key === 'archiveGrows')?.because).toBe('disk-full')
  })

  it('shows the fault that explains the most', () => {
    expect(assess(['phone-offline', 'disk-full']).banner).toBe('health.disk-full')
  })

  it('stops only the backfill when the phone is away', () => {
    const state = assess(['phone-offline'])
    expect(available(state, 'backfill')).toBe(false)
    expect(available(state, 'archiveGrows')).toBe(true)
    expect(available(state, 'search')).toBe(true)
  })

  it('keeps reading and searching when the archive is merely locked', () => {
    const state = assess(['archive-locked'])
    expect(available(state, 'search')).toBe(true)
    expect(available(state, 'archiveGrows')).toBe(false)
  })

  it('deduplicates repeated faults', () => {
    expect(assess(['disk-full', 'disk-full']).faults).toEqual(['disk-full'])
  })
})

describe('faultFromError', () => {
  it('recognises the failures that actually happen', () => {
    expect(faultFromError(new Error('ENOSPC: no space left on device'))).toBe('disk-full')
    expect(faultFromError(new Error('SQLITE_BUSY: database is locked'))).toBe('archive-locked')
    expect(faultFromError(new Error('archive worker is not ready'))).toBe('archive-unavailable')
    expect(faultFromError(new Error('archive worker did not answer within 30000 ms'))).toBe(
      'archive-unavailable',
    )
  })

  it('says nothing about an error it does not recognise, rather than guessing', () => {
    expect(faultFromError(new Error('something else entirely'))).toBeUndefined()
  })
})
