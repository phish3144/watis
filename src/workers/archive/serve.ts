import type { ArchiveRequest, ArchiveStats } from '@shared/ipc/archive-protocol'
import { parseQuery } from '@shared/search/query'
import type { ArchiveRepository } from './repository'

/**
 * The archive requests that only touch the database, answered the same way by the desktop's
 * archive worker and by the browser extension's (ADR 0010).
 *
 * What is left to each worker is what touches storage outside the database — blobs on a disk or
 * in OPFS, exports, backups. Everything here is one switch, so a search, a page of messages or a
 * gallery cannot come back shaped differently in one shell than in the other.
 */

export type Served = { handled: true; value: unknown } | { handled: false }

export function serveRepository(repo: ArchiveRepository, request: ArchiveRequest): Served {
  const value = answer(repo, request)
  return value === UNHANDLED ? { handled: false } : { handled: true, value }
}

const UNHANDLED = Symbol('unhandled')

function answer(repo: ArchiveRepository, request: ArchiveRequest): unknown {
  switch (request.op) {
    case 'import': {
      // Order matters: chats and contacts first, so a message arriving in the same batch as its
      // chat still resolves, and media last, because its search document reads the message's
      // timestamp.
      const written =
        repo.upsertChats(request.chats ?? []) +
        repo.upsertContacts(request.contacts ?? []) +
        repo.upsertMessages(request.messages ?? []) +
        repo.upsertMedia(request.media ?? [])
      return { written }
    }
    case 'search':
      return {
        hits: repo.search(parseQuery(request.query), request.limit, request.offset, request.order),
      }
    case 'messagesPage':
      return {
        messages: repo.messagesPage({
          chatId: request.chatId,
          limit: request.limit,
          ...(request.before ? { before: request.before } : {}),
          ...(request.after ? { after: request.after } : {}),
        }),
      }
    case 'context':
      return { messages: repo.contextAround(request.msgId, request.radius) }
    case 'hitPreviews':
      return { previews: repo.hitPreviews(request.hits, request.terms) }
    case 'gallery':
      return { items: repo.gallery(request) }
    case 'jumpToDate':
      return { cursor: repo.firstMessageOnOrAfter(request.chatId, request.ts) ?? null }
    case 'months':
      return { months: repo.monthsWithMessages(request.chatId) }
    case 'names':
      return { names: repo.findChatsAndContacts(request.query, request.limit) }
    case 'chats':
      return { chats: repo.chats(request.limit) }
    case 'senderNames':
      return { names: repo.senderNames(request.jids) }
    case 'saveSyncState':
      return { written: repo.saveSyncState(request.rows) }
    case 'syncState':
      return { rows: repo.syncState(request.chatId) }
    case 'resetBackfill':
      return { reset: repo.resetBackfill() }
    case 'stats':
      return repo.stats() satisfies ArchiveStats
    case 'markMedia':
      repo.markMedia(request.mediaId, request.status)
      return { ok: true }
    case 'pendingMedia':
      return { media: repo.pendingMedia(request.limit) }
    case 'media':
      return { media: repo.mediaById(request.mediaId) ?? null }
    case 'addReminder':
      return { id: repo.addReminder(request.msgId, request.dueTs, request.note) }
    case 'reminders':
      return { reminders: repo.reminders(request.includeDone) }
    case 'dueReminders':
      return { reminders: repo.dueReminders(request.nowTs) }
    case 'completeReminder':
      repo.completeReminder(request.id)
      return { ok: true }
    default:
      return UNHANDLED
  }
}
