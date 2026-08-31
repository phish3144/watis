import { describe, expect, it } from 'vitest'
import { RingBuffer } from '@shared/ipc/ring-buffer'

describe('RingBuffer', () => {
  it('drains in insertion order', () => {
    const b = new RingBuffer<number>(10)
    for (const n of [1, 2, 3]) b.push(n)
    expect(b.drain(10)).toEqual([1, 2, 3])
    expect(b.size).toBe(0)
  })

  it('drains at most the requested number', () => {
    const b = new RingBuffer<number>(10)
    for (let i = 0; i < 6; i++) b.push(i)
    expect(b.drain(4)).toEqual([0, 1, 2, 3])
    expect(b.drain(10)).toEqual([4, 5])
  })

  it('drops the oldest entry when full and counts it', () => {
    // A stalled worker must cost a visible gap, not the whole process.
    const b = new RingBuffer<number>(3)
    expect(b.push(1)).toBe(true)
    b.push(2)
    b.push(3)
    expect(b.push(4)).toBe(false)

    expect(b.dropped).toBe(1)
    expect(b.size).toBe(3)
    expect(b.drain(10)).toEqual([2, 3, 4])
  })

  it('keeps working after wrapping many times', () => {
    const b = new RingBuffer<number>(4)
    for (let i = 0; i < 100; i++) b.push(i)
    expect(b.drain(10)).toEqual([96, 97, 98, 99])
    expect(b.dropped).toBe(96)
  })

  it('interleaves pushes and drains without losing order', () => {
    const b = new RingBuffer<string>(4)
    b.push('a')
    b.push('b')
    expect(b.drain(1)).toEqual(['a'])
    b.push('c')
    b.push('d')
    b.push('e')
    expect(b.drain(10)).toEqual(['b', 'c', 'd', 'e'])
    expect(b.dropped).toBe(0)
  })

  it('clears', () => {
    const b = new RingBuffer<number>(4)
    b.push(1)
    b.clear()
    expect(b.size).toBe(0)
    expect(b.drain(4)).toEqual([])
  })

  it('refuses a non-positive capacity', () => {
    expect(() => new RingBuffer<number>(0)).toThrow(RangeError)
  })
})
