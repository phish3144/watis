import { Notification } from 'electron'
import { log } from '../logging'

/**
 * Fires local reminders (PLAN.md Phase 8).
 *
 * "Remind me about this message" is a note to yourself. Nothing is sent to WhatsApp, nothing is
 * marked, nobody else learns it exists — which is exactly why the feature is allowed under the
 * read-only rule at all.
 *
 * Polled rather than scheduled with one timer per reminder. A timer set for tomorrow does not
 * survive a quit, and it does not survive the machine sleeping either: on wake, `setTimeout` fires
 * late by however long the lid was closed. A due-time in the database and a check every minute is
 * both simpler and correct across both.
 */

const CHECK_MS = 60_000

export interface ReminderService {
  start(): void
  stop(): void
  check(): Promise<number>
}

interface DueReminder {
  id: number
  msgId: string
  chatId: string | null
  body: string | null
  note: string | null
}

export function createReminderService(options: {
  archive: (request: unknown) => Promise<unknown>
  /** Opens the chat the reminder points at. Undefined when the bridge cannot. */
  openChat?: ((chatId: string, msgId: string) => void) | undefined
  checkIntervalMs?: number | undefined
}): ReminderService {
  let timer: NodeJS.Timeout | undefined
  let checking = false

  const check = async (): Promise<number> => {
    if (checking) return 0
    checking = true
    try {
      const result = (await options.archive({
        op: 'dueReminders',
        nowTs: Math.floor(Date.now() / 1000),
      })) as { reminders?: DueReminder[] }

      const due = result.reminders ?? []
      for (const reminder of due) {
        show(reminder, options.openChat)
        // Marked done as it is shown, not when it is clicked. A reminder nobody clicks has still
        // been delivered, and repeating it every minute until somebody does would be a punishment.
        await options.archive({ op: 'completeReminder', id: reminder.id })
      }
      return due.length
    } catch (error: unknown) {
      log.warn(`could not check reminders: ${String(error)}`)
      return 0
    } finally {
      checking = false
    }
  }

  return {
    start() {
      if (timer) return
      timer = setInterval(() => void check(), options.checkIntervalMs ?? CHECK_MS)
      timer.unref?.()
      void check()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = undefined
    },
    check,
  }
}

function show(
  reminder: DueReminder,
  openChat: ((chatId: string, msgId: string) => void) | undefined,
): void {
  if (!Notification.isSupported()) {
    log.info(`reminder due for ${reminder.msgId}, but this platform shows no notifications`)
    return
  }

  const toast = new Notification({
    title: 'Erinnerung',
    body: reminder.note ?? reminder.body ?? 'Du wolltest an diese Nachricht erinnert werden.',
  })
  if (reminder.chatId && openChat) {
    const { chatId, msgId } = reminder
    toast.on('click', () => {
      openChat(chatId, msgId)
    })
  }
  toast.show()
}
