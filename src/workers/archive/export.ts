import type { ChatRow, MediaRow, MessageRow } from './repository'

/**
 * Export formats (PLAN.md Phase 6). The archive is only a real backup if it can leave the
 * application, so all three are written to be readable without WatIs?: JSON is lossless, HTML opens
 * in any browser, and TXT matches what WhatsApp's own export produces.
 */

export interface ExportMessage extends MessageRow {
  senderName?: string | null | undefined
  media?: MediaRow | null | undefined
}

export interface ExportChat {
  chat: ChatRow
  messages: readonly ExportMessage[]
}

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * WhatsApp's own export writes local time, and so do we — an archive that reads differently from
 * the app it mirrors invites the reader to mistrust it.
 */
export function formatTimestamp(tsSeconds: number, date = new Date(tsSeconds * 1000)): string {
  const yy = pad(date.getFullYear() % 100)
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${yy}, ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** `[dd.mm.yy, hh:mm] Name: Text` — the shape WhatsApp's own export uses. */
export function toText(chat: ExportChat): string {
  const lines: string[] = []
  for (const m of chat.messages) {
    const who = m.fromMe ? 'Du' : (m.senderName ?? m.senderJid ?? 'Unbekannt')
    const body = m.revoked
      ? 'Diese Nachricht wurde gelöscht.'
      : (m.body ?? (m.media ? `<Anhang: ${m.media.filename ?? m.media.mime ?? 'Datei'}>` : ''))
    // A body with newlines stays one logical message; WhatsApp's export indents nothing, so
    // neither do we.
    lines.push(`[${formatTimestamp(m.ts)}] ${who}: ${body}`)
  }
  return lines.join('\n')
}

/** Lossless: raw_json is carried through, so a later schema can be rebuilt from an old export. */
export function toJson(chat: ExportChat): string {
  return JSON.stringify(
    {
      chat: chat.chat,
      exportedAt: null,
      messages: chat.messages.map((m) => ({
        ...m,
        raw: m.rawJson === null || m.rawJson === undefined ? null : safeParse(m.rawJson),
      })),
    },
    null,
    2,
  )
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    // A raw payload we cannot parse is still worth exporting verbatim rather than dropping.
    return raw
  }
}

const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )

/**
 * Self-contained HTML with relative media links, so the file and its `media/` folder can be copied
 * anywhere together and still work — no absolute paths, no network, no script.
 */
export function toHtml(chat: ExportChat, options: { mediaDir?: string } = {}): string {
  const mediaDir = options.mediaDir ?? 'media'
  const title = escapeHtml(chat.chat.name ?? chat.chat.id)

  const rows = chat.messages
    .map((m) => {
      const who = escapeHtml(m.fromMe ? 'Du' : (m.senderName ?? m.senderJid ?? 'Unbekannt'))
      const when = escapeHtml(formatTimestamp(m.ts))
      const classes = ['msg', m.fromMe ? 'me' : 'them', m.revoked ? 'revoked' : ''].filter(Boolean)
      const body = m.revoked
        ? '<em>Diese Nachricht wurde gelöscht.</em>'
        : escapeHtml(m.body ?? '').replace(/\n/g, '<br>')
      const attachment = m.media
        ? `<div class="att"><a href="${escapeHtml(mediaDir)}/${escapeHtml(
            m.media.filename ?? `${m.media.sha256 ?? m.media.id}`,
          )}">${escapeHtml(m.media.filename ?? m.media.mime ?? 'Anhang')}</a></div>`
        : ''
      const edited = m.edited ? ' <span class="tag">bearbeitet</span>' : ''
      return `<li class="${classes.join(' ')}"><div class="meta">${who} · ${when}${edited}</div><div class="body">${body}</div>${attachment}</li>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="de">
<meta charset="utf-8">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; --bg:#eff2f0; --fg:#101c1a; --card:#fff; --muted:#55655f; --me:#d9f2ec; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0c1513; --fg:#e2ebe7; --card:#16221f; --muted:#8ba099; --me:#1d3a34; } }
  body { margin:0; padding:2rem 1rem; background:var(--bg); color:var(--fg);
         font:15px/1.55 system-ui, sans-serif; }
  main { max-width:44rem; margin:0 auto; }
  h1 { font-size:1.3rem; margin:0 0 1.5rem; }
  ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:.5rem; }
  .msg { background:var(--card); border-radius:.6rem; padding:.6rem .8rem; max-width:80%; }
  .msg.me { align-self:flex-end; background:var(--me); }
  .meta { color:var(--muted); font-size:.78rem; margin-bottom:.2rem; }
  .revoked .body { color:var(--muted); }
  .att a { color:inherit; }
  .tag { font-size:.7rem; opacity:.7; }
</style>
<main>
<h1>${title}</h1>
<ul>
${rows}
</ul>
</main>
</html>`
}

export interface IntegrityReport {
  chats: number
  messages: number
  media: number
  /** Media rows whose blob is missing from the store. */
  missingBlobs: string[]
  /** Media rows that carry no hash, so their blob cannot be located at all. */
  unhashed: string[]
  ok: boolean
}

/**
 * An export nobody verified is a backup nobody has. This counts what went out and names what could
 * not be resolved, rather than reporting success because no exception was thrown.
 */
export function buildIntegrityReport(input: {
  chats: number
  messages: number
  media: readonly MediaRow[]
  blobExists: (row: MediaRow) => boolean
}): IntegrityReport {
  const missingBlobs: string[] = []
  const unhashed: string[] = []

  for (const row of input.media) {
    if (row.status === 'skipped' || row.status === 'pending') continue
    if (!row.sha256) {
      unhashed.push(row.id)
      continue
    }
    if (!input.blobExists(row)) missingBlobs.push(row.id)
  }

  return {
    chats: input.chats,
    messages: input.messages,
    media: input.media.length,
    missingBlobs,
    unhashed,
    ok: missingBlobs.length === 0 && unhashed.length === 0,
  }
}
