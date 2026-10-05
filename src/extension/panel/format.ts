import { t } from './strings'

/** Dates the way people say them: "heute 14:02", "gestern", "12. März", "12.03.25". */
export function when(ts: number, now = new Date()): string {
  const date = new Date(ts * 1000)
  const time = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 24 * 60 * 60 * 1000
  if (date.getTime() >= startOfToday) return `${t('common.today')} ${time}`
  if (date.getTime() >= startOfToday - day) return `${t('common.yesterday')} ${time}`
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })
  }
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/** Full timestamp, for a tooltip. */
export function exactly(ts: number): string {
  return new Date(ts * 1000).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
}

/** The day heading in a chat: "Montag, 3. März 2026". */
export function dayHeading(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return ''
  if (n < 1024) return `${String(n)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toLocaleString('de-DE', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit] ?? ''}`
}

export function count(n: number): string {
  return n.toLocaleString('de-DE')
}

/** 84.4 → "1:24" */
export function seconds(value: number): string {
  const total = Math.floor(value)
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, '0')}`
}

/** What a phone-number jid looks like to a person: "+49 1555 0000001". */
export function jidLabel(jid: string | null | undefined): string {
  if (!jid) return ''
  const user = jid.split('@')[0] ?? jid
  return /^\d{6,}$/.test(user) ? `+${user}` : user
}

export function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()
    .split(/\s+/)
  const letters =
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')
  return letters.toUpperCase() || '#'
}
