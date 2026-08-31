import { beforeEach, describe, expect, it, vi } from 'vitest'

const shown: { title: string; body: string }[] = []
let supported = true

vi.mock('electron', () => ({
  Notification: class {
    static isSupported(): boolean {
      return supported
    }
    constructor(readonly options: { title: string; body: string }) {}
    on(): void {
      /* click handling is not what this tests */
    }
    show(): void {
      shown.push(this.options)
    }
  },
}))
vi.mock('../../src/main/logging', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { createReminderService } = await import('../../src/main/reminders')

describe('the reminder service', () => {
  let due: {
    id: number
    msgId: string
    chatId: string | null
    body: string | null
    note: string | null
  }[]
  let requests: { op: string; [key: string]: unknown }[]

  const archive = (request: unknown): Promise<unknown> => {
    const r = request as { op: string; id?: number }
    requests.push(r)
    if (r.op === 'dueReminders') return Promise.resolve({ reminders: due })
    if (r.op === 'completeReminder') {
      due = due.filter((d) => d.id !== r.id)
      return Promise.resolve({ ok: true })
    }
    return Promise.resolve({})
  }

  beforeEach(() => {
    shown.length = 0
    supported = true
    due = []
    requests = []
  })

  it('says nothing when nothing is due', async () => {
    const service = createReminderService({ archive })
    expect(await service.check()).toBe(0)
    expect(shown).toHaveLength(0)
  })

  it('shows the note when there is one, and the message otherwise', async () => {
    due = [
      { id: 1, msgId: 'm1', chatId: 'c1', body: 'Angebot kommt', note: 'nachhaken' },
      { id: 2, msgId: 'm2', chatId: 'c1', body: 'Termin Dienstag', note: null },
    ]
    await createReminderService({ archive }).check()
    expect(shown.map((s) => s.body)).toEqual(['nachhaken', 'Termin Dienstag'])
  })

  it('marks a reminder done as it shows it', async () => {
    // Not when it is clicked: a reminder nobody clicks has still been delivered, and repeating it
    // every minute until somebody does would be a punishment.
    due = [{ id: 7, msgId: 'm1', chatId: 'c1', body: 'x', note: null }]
    const service = createReminderService({ archive })
    await service.check()
    expect(requests.some((r) => r.op === 'completeReminder' && r.id === 7)).toBe(true)

    await service.check()
    expect(shown).toHaveLength(1)
  })

  it('still completes a reminder on a platform with no notifications', async () => {
    supported = false
    due = [{ id: 1, msgId: 'm1', chatId: null, body: null, note: 'etwas' }]
    await createReminderService({ archive }).check()
    expect(shown).toHaveLength(0)
    expect(requests.some((r) => r.op === 'completeReminder')).toBe(true)
  })

  it('survives an archive that is not answering', async () => {
    const service = createReminderService({
      archive: () => Promise.reject(new Error('archive is not ready')),
    })
    await expect(service.check()).resolves.toBe(0)
  })

  it('does not stack overlapping checks', async () => {
    due = [{ id: 1, msgId: 'm1', chatId: 'c1', body: 'x', note: null }]
    const service = createReminderService({ archive })
    const first = service.check()
    await service.check()
    await first
    expect(requests.filter((r) => r.op === 'dueReminders')).toHaveLength(1)
  })

  it('falls back to a generic line when there is neither note nor body', async () => {
    due = [{ id: 1, msgId: 'm1', chatId: null, body: null, note: null }]
    await createReminderService({ archive }).check()
    expect(shown[0]?.body).toContain('erinnert')
  })
})
