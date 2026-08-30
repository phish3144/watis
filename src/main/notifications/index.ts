import { Notification } from 'electron'
import type { BaseWindow, WebContents } from 'electron'
import { settings } from '../config/store'
import { log } from '../logging'

/**
 * Turns WhatsApp's in-page notifications into native ones.
 *
 * Three behaviours the official client does not have:
 *  - no toast for the chat that is already on screen in a focused window,
 *  - one toast per chat per coalescing window, carrying a count instead of a flood,
 *  - a do-not-disturb schedule that can wrap past midnight.
 *
 * A click calls WhatsApp's own onclick handler back in the page, which is what opens the right
 * chat. Nothing here sends anything.
 */

export interface IncomingNotification {
  id: string
  title: string
  body: string
  tag: string
  icon: string
}

interface Pending {
  count: number
  latest: IncomingNotification
  timer: NodeJS.Timeout
}

function minutesOfDay(value: string): number {
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10))
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

/** Handles a window that wraps past midnight, e.g. 22:00 to 07:00. */
export function isWithinQuietHours(now: Date, from: string, to: string): boolean {
  const current = now.getHours() * 60 + now.getMinutes()
  const start = minutesOfDay(from)
  const end = minutesOfDay(to)
  return start <= end ? current >= start && current < end : current >= start || current < end
}

export class NotificationManager {
  private readonly pending = new Map<string, Pending>()
  private activeChat = ''
  private paused = false

  constructor(
    private readonly window: () => BaseWindow | undefined,
    private readonly waContents: () => WebContents | undefined,
  ) {}

  setActiveChat(title: string): void {
    this.activeChat = title
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    if (paused) this.flushTimers()
  }

  isPaused(): boolean {
    return this.paused
  }

  private suppressed(notification: IncomingNotification): string | undefined {
    const config = settings()
    if (!config.notifications) return 'notifications disabled'
    if (this.paused) return 'paused'
    if (config.dndEnabled && isWithinQuietHours(new Date(), config.dndFrom, config.dndTo)) {
      return 'quiet hours'
    }
    if (
      config.suppressWhenVisible &&
      this.window()?.isFocused() === true &&
      this.activeChat !== '' &&
      notification.title.trim() === this.activeChat.trim()
    ) {
      return 'chat already visible and focused'
    }
    return undefined
  }

  /** Chat identity for coalescing. WhatsApp's tag is per-chat when present. */
  private keyFor(notification: IncomingNotification): string {
    return notification.tag || notification.title
  }

  handle(notification: IncomingNotification): void {
    const reason = this.suppressed(notification)
    if (reason) {
      log.debug(`notification suppressed (${reason})`)
      return
    }

    const key = this.keyFor(notification)
    const windowMs = settings().coalesceWindowMs

    if (windowMs <= 0) {
      this.present(notification, 1)
      return
    }

    const existing = this.pending.get(key)
    if (existing) {
      existing.count += 1
      existing.latest = notification
      return
    }

    // First one in the window shows immediately; anything that follows is summarised when the
    // window closes. That keeps a single message instant and a burst quiet.
    this.present(notification, 1)
    const timer = setTimeout(() => {
      const entry = this.pending.get(key)
      this.pending.delete(key)
      if (entry && entry.count > 1) this.present(entry.latest, entry.count)
    }, windowMs)
    timer.unref()
    this.pending.set(key, { count: 1, latest: notification, timer })
  }

  private present(notification: IncomingNotification, count: number): void {
    if (!Notification.isSupported()) return

    const body = count > 1 ? `${count} neue Nachrichten` : notification.body || 'Neue Nachricht'

    const toast = new Notification({
      title: notification.title || 'WhatsApp',
      body,
      silent: false,
      ...(notification.icon.startsWith('data:') ? { icon: notification.icon } : {}),
    })

    toast.on('click', () => {
      const window = this.window()
      if (window) {
        if (window.isMinimized()) window.restore()
        window.show()
        window.focus()
      }
      // Calling WhatsApp's own handler is what opens the right chat.
      this.waContents()?.send('wa:notification-event', { id: notification.id, type: 'click' })
    })

    toast.on('close', () => {
      this.waContents()?.send('wa:notification-event', { id: notification.id, type: 'close' })
    })

    toast.show()
  }

  private flushTimers(): void {
    for (const entry of this.pending.values()) clearTimeout(entry.timer)
    this.pending.clear()
  }

  dispose(): void {
    this.flushTimers()
  }
}
