/**
 * A bounded ring buffer with batched draining.
 *
 * §3.1 forbids one IPC call per message: a busy group can produce hundreds of events a second, and a
 * round trip each would drown both processes. Events accumulate here and leave in batches on a
 * timer.
 *
 * Bounded on purpose. If the archive worker stalls, the buffer must drop rather than grow until the
 * process dies — a visible gap the UI can report beats an out-of-memory crash. `dropped` is what the
 * backpressure counter shows.
 */
export class RingBuffer<T> {
  readonly #items: (T | undefined)[]
  readonly #capacity: number
  #head = 0
  #size = 0
  #dropped = 0

  constructor(capacity: number) {
    if (capacity <= 0) throw new RangeError('ring buffer capacity must be positive')
    this.#capacity = capacity
    this.#items = new Array<T | undefined>(capacity)
  }

  get size(): number {
    return this.#size
  }

  get dropped(): number {
    return this.#dropped
  }

  get capacity(): number {
    return this.#capacity
  }

  /** Returns false when the value displaced an older one. */
  push(value: T): boolean {
    const tail = (this.#head + this.#size) % this.#capacity
    this.#items[tail] = value
    if (this.#size === this.#capacity) {
      // Full: the write lands on the oldest entry, which is therefore lost.
      this.#head = (this.#head + 1) % this.#capacity
      this.#dropped++
      return false
    }
    this.#size++
    return true
  }

  /** Removes and returns up to `max` items, oldest first. */
  drain(max: number): T[] {
    const count = Math.min(max, this.#size)
    const out: T[] = []
    for (let i = 0; i < count; i++) {
      const index = (this.#head + i) % this.#capacity
      out.push(this.#items[index] as T)
      this.#items[index] = undefined
    }
    this.#head = (this.#head + count) % this.#capacity
    this.#size -= count
    return out
  }

  clear(): void {
    this.#items.fill(undefined)
    this.#head = 0
    this.#size = 0
  }
}
