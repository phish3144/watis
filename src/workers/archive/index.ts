import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type Database from 'better-sqlite3'
import { parseArchiveRequest, type ArchiveStats } from '@shared/ipc/archive-protocol'
import { parseQuery } from '@shared/search/query'
import { connectToHost } from '../shared/host-channel'
import { openArchive } from './db'
import { ArchiveRepository } from './repository'

/**
 * The archive worker: SQLite (WAL), FTS5 and export.
 *
 * The database is opened HERE and nowhere else. better-sqlite3 is synchronous, so whichever process
 * holds the handle stops dead during a long query — which is why the main process must never have
 * one (PLAN.md §5.6).
 */

let db: Database.Database | undefined
let repo: ArchiveRepository | undefined

function handle(payload: unknown): unknown {
  const request = parseArchiveRequest(payload)
  if (!request) throw new Error('malformed archive request')
  if (!db || !repo) throw new Error('archive is not open')

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
    case 'chats':
      return { chats: repo.chats(request.limit) }
    case 'saveSyncState':
      return { written: repo.saveSyncState(request.rows) }
    case 'syncState':
      return { rows: repo.syncState(request.chatId) }
    case 'stats':
      return repo.stats() satisfies ArchiveStats
    case 'snapshot':
      // VACUUM INTO writes a defragmented copy without locking out readers for the duration.
      repo.snapshot(request.toFile)
      return { ok: true }
  }
}

async function main(): Promise<void> {
  // Named by the supervisor from appPaths(). Falling back to the working directory would put the
  // archive wherever the process happened to start — outside %LOCALAPPDATA%\\watis, which the
  // project forbids outright, and somewhere no uninstall or storage overview would ever find it.
  // A missing variable is a wiring fault, so it fails here rather than writing to the wrong disk.
  const directory = process.env.WATIS_ARCHIVE_DIR
  if (!directory)
    throw new Error('WATIS_ARCHIVE_DIR is not set; refusing to guess where the archive lives')
  const file = join(directory, 'archive.sqlite')
  await mkdir(dirname(file), { recursive: true })

  const host = await connectToHost({
    name: 'archive',
    onRequest: handle,
    onShutdown: (reason) => {
      host.log('info', `shutting down: ${reason}`)
      // Checkpointing folds the WAL back into the database, so the next start does not have to
      // replay it — and so a copy of the file taken while we are stopped is complete.
      try {
        db?.pragma('wal_checkpoint(TRUNCATE)')
        db?.close()
      } catch (error) {
        host.log('warn', `closing the archive failed: ${String(error)}`)
      }
    },
  })

  try {
    db = openArchive(file)
    repo = new ArchiveRepository(db)
    host.log('info', `archive open at ${file}`)
  } catch (error) {
    host.send({ type: 'fatal', message: `could not open the archive: ${String(error)}` })
  }
}

void main()
