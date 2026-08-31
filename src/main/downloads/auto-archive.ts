/**
 * Auto-archive rules (PLAN.md Phase 2): "in chat X, save every document automatically".
 *
 * Deliberately at the UI level, without the bridge: a rule that fires on what the download hook
 * already sees needs nothing from WhatsApp's internals, so it cannot break when they change.
 */

export interface AutoArchiveRule {
  /** Chat name, or '*' for every chat. */
  chat: string
  /** Which attachments the rule covers. */
  kinds: readonly ('document' | 'image' | 'video' | 'audio')[]
  /** Off without deleting the rule. */
  enabled?: boolean
  /** Skip anything larger, so a rule cannot quietly pull gigabytes. */
  maxBytes?: number | undefined
}

export type AttachmentKind = 'document' | 'image' | 'video' | 'audio' | 'other'

export function kindOf(mime: string | null | undefined, filename?: string | null): AttachmentKind {
  const type = (mime ?? '').toLowerCase()
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('application/') || type.startsWith('text/')) return 'document'

  const name = (filename ?? '').toLowerCase()
  if (/\.(pdf|docx?|xlsx?|pptx?|txt|csv|odt)$/.test(name)) return 'document'
  if (/\.(jpe?g|png|gif|webp|heic)$/.test(name)) return 'image'
  if (/\.(mp4|mov|mkv|webm)$/.test(name)) return 'video'
  if (/\.(mp3|ogg|opus|m4a|wav)$/.test(name)) return 'audio'
  return 'other'
}

export interface RuleDecision {
  save: boolean
  /** Which rule decided, so the UI can show why a file appeared. */
  rule?: AutoArchiveRule | undefined
  reason?: string | undefined
}

export function decideAutoArchive(
  rules: readonly AutoArchiveRule[],
  attachment: {
    chat: string
    mime?: string | null
    filename?: string | null
    size?: number | null
  },
): RuleDecision {
  const kind = kindOf(attachment.mime, attachment.filename)
  if (kind === 'other') return { save: false, reason: 'kind not covered by any rule' }

  for (const rule of rules) {
    if (rule.enabled === false) continue
    if (rule.chat !== '*' && rule.chat !== attachment.chat) continue
    if (!rule.kinds.includes(kind)) continue
    if (rule.maxBytes !== undefined && (attachment.size ?? 0) > rule.maxBytes) {
      // A matching rule that declines on size is still the rule that decided; saying so beats a
      // silent no.
      return {
        save: false,
        rule,
        reason: `larger than the rule's limit of ${String(rule.maxBytes)} bytes`,
      }
    }
    return { save: true, rule }
  }

  return { save: false, reason: 'no rule matched' }
}
