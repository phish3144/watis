/**
 * "Chat with a number" and the `whatsapp:` / `wa.me` handlers (PLAN.md Phase 8).
 *
 * Opening a chat with an unsaved number is the one thing the official desktop client makes
 * genuinely awkward, and it needs no bridge: WhatsApp Web already understands the URL.
 */

export interface ParsedTarget {
  /** Digits only, no plus, which is what wa.me expects. */
  number: string
  /** Prefilled message, if the link carried one. */
  text?: string | undefined
}

/**
 * Normalises what a person would actually type or paste: `+49 170 1234567`, `0049…`, `(0170) …`.
 *
 * A leading national trunk zero cannot be resolved without knowing the country, so a bare `0170…`
 * is rejected rather than guessed at — a message sent to the wrong country is worse than a prompt
 * asking for the full number.
 */
export function normaliseNumber(input: string, defaultCountry?: string): string | undefined {
  const trimmed = input.trim()
  if (trimmed === '') return undefined

  let digits = trimmed.replace(/[\s()/.-]/g, '')

  if (digits.startsWith('+')) digits = digits.slice(1)
  else if (digits.startsWith('00')) digits = digits.slice(2)
  else if (digits.startsWith('0')) {
    if (!defaultCountry) return undefined
    digits = defaultCountry.replace(/\D/g, '') + digits.slice(1)
  }

  if (!/^\d{7,15}$/.test(digits)) return undefined
  return digits
}

/** Accepts `wa.me/…`, `whatsapp://send?phone=…` and `api.whatsapp.com/send?phone=…`. */
export function parseWhatsAppUrl(raw: string): ParsedTarget | undefined {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }

  const text = url.searchParams.get('text') ?? undefined

  if (url.protocol === 'whatsapp:') {
    const phone = url.searchParams.get('phone')
    const number = phone ? normaliseNumber(phone) : undefined
    return number ? { number, ...(text ? { text } : {}) } : undefined
  }

  if (
    url.hostname === 'wa.me' ||
    url.hostname === 'api.whatsapp.com' ||
    url.hostname === 'web.whatsapp.com'
  ) {
    const fromPath = url.pathname.replace(/^\/+/, '').split('/')[0] ?? ''
    const phone = url.searchParams.get('phone') ?? fromPath
    const number = normaliseNumber(phone)
    return number ? { number, ...(text ? { text } : {}) } : undefined
  }

  return undefined
}

/**
 * The URL that opens the chat. Note it carries no `text=` even when one was parsed: prefilling the
 * box is fine, but this project never sends, and a link that both opens and could be submitted by
 * a stray Enter is a foot-gun the read-only rule does not need.
 */
export function chatUrlFor(target: ParsedTarget): string {
  return `https://web.whatsapp.com/send?phone=${encodeURIComponent(target.number)}`
}
