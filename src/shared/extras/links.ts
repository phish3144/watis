/**
 * Link collection per chat (PLAN.md Phase 8).
 *
 * Extracted from the message body we already store, so it needs nothing from the bridge and cannot
 * break when WhatsApp changes. No network: a title preview would mean fetching every link a chat
 * ever contained, which the project's network rules forbid outright.
 */

export interface ExtractedLink {
  url: string
  /** Registrable-ish host for grouping; not a public-suffix parse, just the hostname. */
  host: string
}

// Deliberately conservative: a trailing bracket or full stop is far more often punctuation than
// part of the URL.
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/

export function extractLinks(text: string | null | undefined): ExtractedLink[] {
  if (!text) return []
  const seen = new Set<string>()
  const out: ExtractedLink[] = []

  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0].replace(TRAILING_PUNCTUATION, '')
    let parsed: URL
    try {
      parsed = new URL(raw)
    } catch {
      continue
    }
    if (seen.has(parsed.href)) continue
    seen.add(parsed.href)
    out.push({ url: parsed.href, host: parsed.hostname })
  }
  return out
}

/** Groups a chat's links by host, most recent first inside each group. */
export function groupByHost(
  links: readonly { url: string; host: string; ts: number }[],
): { host: string; links: { url: string; ts: number }[] }[] {
  const groups = new Map<string, { url: string; ts: number }[]>()
  for (const link of links) {
    const bucket = groups.get(link.host)
    const entry = { url: link.url, ts: link.ts }
    if (bucket) bucket.push(entry)
    else groups.set(link.host, [entry])
  }
  return [...groups.entries()]
    .map(([host, entries]) => ({ host, links: entries.sort((a, b) => b.ts - a.ts) }))
    .sort((a, b) => b.links.length - a.links.length || a.host.localeCompare(b.host))
}
