/**
 * The do-not-disturb window, shared by the desktop's notification manager and the browser
 * extension's background (ADR 0010).
 */

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
