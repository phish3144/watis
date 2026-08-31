import { describe, expect, it } from 'vitest'
import {
  indexOf,
  pageDirection,
  scrollTopAfterPrepend,
  scrollTopFor,
  visibleRange,
  type Windowing,
} from '../../src/renderer/src/archive/virtual-list'

const w = (over: Partial<Windowing> = {}): Windowing => ({
  count: 1000,
  rowHeight: 60,
  viewportHeight: 600,
  scrollTop: 0,
  overscan: 2,
  ...over,
})

describe('visibleRange', () => {
  it('renders only the window plus overscan', () => {
    const r = visibleRange(w({ scrollTop: 600 }))
    expect(r.startIndex).toBe(8)
    expect(r.endIndex).toBe(22)
  })

  it('never starts before the first row', () => {
    expect(visibleRange(w({ scrollTop: 0 })).startIndex).toBe(0)
  })

  it('never renders past the end of a short list', () => {
    const r = visibleRange(w({ count: 5, scrollTop: 0 }))
    expect(r.endIndex).toBe(5)
    expect(r.paddingBottom).toBe(0)
  })

  it('pads so the scrollbar reflects the whole list', () => {
    const r = visibleRange(w({ scrollTop: 6000 }))
    expect(r.paddingTop).toBe(r.startIndex * 60)
    expect(r.paddingTop + (r.endIndex - r.startIndex) * 60 + r.paddingBottom).toBe(1000 * 60)
  })

  it('handles an empty list without dividing by zero', () => {
    expect(visibleRange(w({ count: 0 }))).toEqual({
      startIndex: 0,
      endIndex: 0,
      paddingTop: 0,
      paddingBottom: 0,
    })
    expect(visibleRange(w({ rowHeight: 0 })).endIndex).toBe(0)
  })
})

describe('pageDirection', () => {
  it('asks for older messages near the top, because a chat reads newest-first', () => {
    expect(pageDirection(w({ scrollTop: 100 }))).toBe('older')
  })

  it('asks for newer messages near the bottom', () => {
    expect(pageDirection(w({ scrollTop: 1000 * 60 - 600 }))).toBe('newer')
  })

  it('asks for nothing in the middle', () => {
    expect(pageDirection(w({ scrollTop: 20_000 }))).toBeUndefined()
  })

  it('asks for nothing when everything already fits', () => {
    expect(pageDirection(w({ count: 3 }))).toBeUndefined()
  })
})

describe('scrollTopAfterPrepend', () => {
  it('keeps the content under the cursor still', () => {
    // Without this the view slides by exactly the height of what arrived — the most noticeable bug
    // an infinite list can have.
    expect(scrollTopAfterPrepend(300, 50, 60)).toBe(3300)
  })

  it('is a no-op when nothing was added', () => {
    expect(scrollTopAfterPrepend(300, 0, 60)).toBe(300)
  })
})

describe('jumping to a message', () => {
  it('finds the row index by id', () => {
    expect(indexOf(['a', 'b', 'c'], 'b')).toBe(1)
    expect(indexOf(['a'], 'nope')).toBeUndefined()
  })

  it('centres the row rather than pinning it to the top edge', () => {
    expect(scrollTopFor(100, { rowHeight: 60, viewportHeight: 600 })).toBe(5730)
  })

  it('does not scroll above the start for an early row', () => {
    expect(scrollTopFor(0, { rowHeight: 60, viewportHeight: 600 })).toBe(0)
  })
})
