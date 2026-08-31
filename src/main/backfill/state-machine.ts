/**
 * The backfill: walking each chat back to whatever WhatsApp Web is willing to hand over.
 *
 * Two constraints shape this, and both come from outside the code:
 *
 *  - **It only runs when the user starts it** (ADR 0006). Opening a chat marks it read, so a
 *    background sweep would mark chats read that nobody wanted to see — exactly what the read-only
 *    rule forbids. The UI says so before the first chat is opened.
 *  - **The depth limit is read at runtime, never hardcoded** (ADR 0005 A). WhatsApp Web serves at
 *    most about 90 days; `getEarliestHistorySyncDate()` returns the real figure, and WhatsApp can
 *    change it.
 *
 * Everything the machine does to the outside world goes through `Effects`, so the whole thing runs
 * against fakes in tests — which is the only way to exercise the error and resume paths at all.
 */

export type ChatState = 'queued' | 'running' | 'done' | 'failed' | 'paused'

export interface ChatProgress {
  chatId: string
  state: ChatState
  /** Oldest timestamp reached so far; undefined until the first batch arrives. */
  oldestTs?: number | undefined
  batches: number
  messages: number
  lastError?: string | undefined
}

export interface BackfillSnapshot {
  running: boolean
  /** The date the backfill can actually reach, read from WhatsApp — not a number from our source. */
  reachableTs?: number | undefined
  current?: string | undefined
  chats: ChatProgress[]
}

export interface LoadResult {
  /** How many older messages arrived. Zero means this chat has reached its floor. */
  loaded: number
  oldestTs?: number | undefined
  /** WhatsApp itself says there is nothing older to fetch. */
  atFloor?: boolean
}

export interface Effects {
  /** `getEarliestHistorySyncDate()`; undefined when the bridge cannot answer. */
  earliestReachableTs(): Promise<number | undefined>
  /** Opens the chat and asks for one page of older messages. */
  loadOlder(chatId: string): Promise<LoadResult>
  /** Human-paced delay between batches. */
  wait(ms: number): Promise<void>
  /** False while the user is active or the phone is unreachable — both mean: not now. */
  canRun(): Promise<boolean>
  persist(snapshot: BackfillSnapshot): Promise<void> | void
  onChange?(snapshot: BackfillSnapshot): void
}

export interface BackfillOptions {
  /** Between batches within a chat. */
  batchDelayMs?: number
  /** How often to re-check when paused. */
  idleCheckMs?: number
  /** Give up on a chat after this many consecutive failures. */
  maxAttempts?: number
  /** Safety net: a chat that never reports its floor must still end. */
  maxBatchesPerChat?: number
}

export class BackfillMachine {
  readonly #effects: Effects
  readonly #options: Required<BackfillOptions>
  #chats = new Map<string, ChatProgress>()
  #running = false
  #stopRequested = false
  #current: string | undefined
  #reachableTs: number | undefined

  constructor(effects: Effects, options: BackfillOptions = {}) {
    this.#effects = effects
    this.#options = {
      batchDelayMs: options.batchDelayMs ?? 1500,
      idleCheckMs: options.idleCheckMs ?? 30_000,
      maxAttempts: options.maxAttempts ?? 3,
      maxBatchesPerChat: options.maxBatchesPerChat ?? 2000,
    }
  }

  /**
   * Chats are queued in the order given; the caller sorts them (direct chats and marked groups
   * first, per the plan) and may re-queue one to the front while the run is in progress.
   */
  enqueue(chatIds: readonly string[]): void {
    for (const id of chatIds) {
      if (!this.#chats.has(id)) {
        this.#chats.set(id, { chatId: id, state: 'queued', batches: 0, messages: 0 })
      }
    }
    this.#emit()
  }

  /** Moves a chat to the front of the queue without disturbing the one in flight. */
  prioritise(chatId: string): void {
    const existing = this.#chats.get(chatId)
    if (!existing || existing.state === 'running') return
    const rest = [...this.#chats.entries()].filter(([id]) => id !== chatId)
    this.#chats = new Map([[chatId, { ...existing, state: 'queued' }], ...rest])
    this.#emit()
  }

  snapshot(): BackfillSnapshot {
    return {
      running: this.#running,
      reachableTs: this.#reachableTs,
      current: this.#current,
      chats: [...this.#chats.values()].map((c) => ({ ...c })),
    }
  }

  stop(): void {
    this.#stopRequested = true
  }

  /**
   * Runs until every queued chat is done, failed, or the caller stops it. Resumable: a chat already
   * marked done stays done, so a restart continues rather than starting over.
   */
  async run(): Promise<BackfillSnapshot> {
    if (this.#running) return this.snapshot()
    this.#running = true
    this.#stopRequested = false
    this.#reachableTs = await this.#effects.earliestReachableTs()

    try {
      for (const [chatId, progress] of this.#chats) {
        if (this.#stopRequested) break
        if (progress.state === 'done' || progress.state === 'failed') continue
        await this.#runChat(chatId)
      }
    } finally {
      this.#running = false
      this.#current = undefined
      await this.#effects.persist(this.snapshot())
      this.#emit()
    }
    return this.snapshot()
  }

  async #runChat(chatId: string): Promise<void> {
    const progress = this.#chats.get(chatId)
    if (!progress) return

    this.#current = chatId
    progress.state = 'running'
    this.#emit()

    let attempts = 0
    while (!this.#stopRequested) {
      // One chat at a time, and only while the user is idle and the phone is reachable. Pausing is
      // a state the UI shows, not a silent stall.
      if (!(await this.#effects.canRun())) {
        progress.state = 'paused'
        this.#emit()
        await this.#effects.wait(this.#options.idleCheckMs)
        if (this.#stopRequested) break
        progress.state = 'running'
        this.#emit()
        continue
      }

      let result: LoadResult
      try {
        result = await this.#effects.loadOlder(chatId)
        attempts = 0
      } catch (error) {
        attempts++
        progress.lastError = String(error)
        if (attempts >= this.#options.maxAttempts) {
          progress.state = 'failed'
          this.#emit()
          await this.#effects.persist(this.snapshot())
          return
        }
        // Back off, then try the same chat again — a transient bridge hiccup should not cost
        // the whole chat.
        await this.#effects.wait(this.#options.batchDelayMs * attempts)
        continue
      }

      progress.batches++
      progress.messages += result.loaded
      if (result.oldestTs !== undefined) progress.oldestTs = result.oldestTs
      this.#emit()

      if (result.loaded === 0 || result.atFloor === true) {
        progress.state = 'done'
        break
      }
      if (progress.batches >= this.#options.maxBatchesPerChat) {
        // A chat that never reports its floor must still terminate, or the run never ends.
        progress.state = 'done'
        progress.lastError = 'batch limit reached before WhatsApp reported the floor'
        break
      }

      await this.#effects.persist(this.snapshot())
      await this.#effects.wait(this.#options.batchDelayMs)
    }

    if (progress.state === 'running' || progress.state === 'paused') progress.state = 'queued'
    this.#current = undefined
    this.#emit()
    await this.#effects.persist(this.snapshot())
  }

  #emit(): void {
    this.#effects.onChange?.(this.snapshot())
  }

  /** Restores a persisted run so a restart continues instead of starting over. */
  static restore(
    snapshot: BackfillSnapshot,
    effects: Effects,
    options?: BackfillOptions,
  ): BackfillMachine {
    const machine = new BackfillMachine(effects, options)
    for (const chat of snapshot.chats) {
      machine.#chats.set(chat.chatId, {
        ...chat,
        // Anything caught mid-flight by the restart goes back into the queue; "running" cannot
        // survive a process that is no longer there.
        state: chat.state === 'running' || chat.state === 'paused' ? 'queued' : chat.state,
      })
    }
    machine.#reachableTs = snapshot.reachableTs
    return machine
  }
}
