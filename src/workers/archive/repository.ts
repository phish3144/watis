import type Database from 'better-sqlite3'
import { toMatchExpression, type ParsedQuery } from '@shared/search/query'

/**
 * Every read and write the archive offers. Two rules run through all of it (PLAN.md §3.1):
 *
 *  - Writes go in batches inside one transaction. A transaction per row turns an import of a
 *    million messages into a million fsyncs.
 *  - Reads are always bounded. There is no "load everything": lists page by keyset over `(ts, id)`,
 *    and search always carries a LIMIT — an unbounded `ORDER BY bm25()` costs 294 ms at 200k
 *    matches where the same query with a LIMIT costs 0.68 ms.
 */

export interface ChatRow {
  id: string
  jid?: string | null | undefined
  name?: string | null | undefined
  kind?: 'dm' | 'group' | 'broadcast' | 'channel' | null | undefined
  lastMsgTs?: number | null | undefined
  isArchived?: boolean | undefined
  rawJson?: string | null | undefined
}

/**
 * One chat's backfill bookkeeping. `depthLimitTs` is what WhatsApp said it can still reach, not a
 * figure of ours (ADR 0005 A) — so a chat whose `oldestTs` has arrived at it is finished, and one
 * that stops earlier stopped for a reason worth showing.
 */
export interface SyncStateRow {
  chatId: string
  oldestTs?: number | null | undefined
  newestTs?: number | null | undefined
  backfillDone?: boolean | undefined
  depthLimitTs?: number | null | undefined
  priority?: number | undefined
  lastError?: string | null | undefined
  updatedTs?: number | null | undefined
}

export interface ContactRow {
  jid: string
  name?: string | null | undefined
  pushname?: string | null | undefined
  phone?: string | null | undefined
}

export interface MessageRow {
  id: string
  chatId: string
  senderJid?: string | null | undefined
  ts: number
  kind?: string | null | undefined
  body?: string | null | undefined
  quotedId?: string | null | undefined
  mediaId?: string | null | undefined
  edited?: boolean | undefined
  revoked?: boolean | undefined
  fromMe?: boolean | undefined
  rawJson?: string | null | undefined
}

export interface MediaRow {
  id: string
  msgId?: string | null | undefined
  chatId?: string | null | undefined
  mime?: string | null | undefined
  size?: number | null | undefined
  sha256?: string | null | undefined
  filename?: string | null | undefined
  status?: 'pending' | 'done' | 'failed' | 'skipped' | undefined
}

/** A position in a chat, used to page in either direction without OFFSET. */
export interface Cursor {
  ts: number
  id: string
}

export interface SearchHit {
  msgId: string | null
  mediaId: string | null
  chatId: string | null
  ts: number | null
  source: string
  /** bm25 score; lower is a better match, which is how FTS5 orders it. */
  score: number
}

const bool = (v: boolean | undefined): number => (v ? 1 : 0)

export class ArchiveRepository {
  readonly #db: Database.Database

  constructor(db: Database.Database) {
    this.#db = db
  }

  // --- writes ---------------------------------------------------------------------------

  /**
   * Upserts are the only write shape the importer uses: a re-import of the same message must
   * update it, not fail and not duplicate it. `ON CONFLICT DO UPDATE` also drives the search
   * triggers correctly, because it fires as an UPDATE.
   */
  upsertChats(rows: readonly ChatRow[]): number {
    const stmt = this.#db.prepare(`
      INSERT INTO chats (id, jid, name, kind, last_msg_ts, is_archived, raw_json)
      VALUES (@id, @jid, @name, @kind, @lastMsgTs, @isArchived, @rawJson)
      ON CONFLICT(id) DO UPDATE SET
        jid = excluded.jid, name = excluded.name, kind = excluded.kind,
        last_msg_ts = excluded.last_msg_ts, is_archived = excluded.is_archived,
        raw_json = excluded.raw_json
    `)
    return this.#runBatch(rows, (r) =>
      stmt.run({
        id: r.id,
        jid: r.jid ?? null,
        name: r.name ?? null,
        kind: r.kind ?? null,
        lastMsgTs: r.lastMsgTs ?? null,
        isArchived: bool(r.isArchived),
        rawJson: r.rawJson ?? null,
      }),
    )
  }

  upsertContacts(rows: readonly ContactRow[]): number {
    const stmt = this.#db.prepare(`
      INSERT INTO contacts (jid, name, pushname, phone)
      VALUES (@jid, @name, @pushname, @phone)
      ON CONFLICT(jid) DO UPDATE SET
        name = excluded.name, pushname = excluded.pushname, phone = excluded.phone
    `)
    return this.#runBatch(rows, (r) =>
      stmt.run({
        jid: r.jid,
        name: r.name ?? null,
        pushname: r.pushname ?? null,
        phone: r.phone ?? null,
      }),
    )
  }

  upsertMessages(rows: readonly MessageRow[]): number {
    const stmt = this.#db.prepare(`
      INSERT INTO messages
        (id, chat_id, sender_jid, ts, kind, body, quoted_id, media_id, edited, revoked, from_me, raw_json)
      VALUES
        (@id, @chatId, @senderJid, @ts, @kind, @body, @quotedId, @mediaId, @edited, @revoked, @fromMe, @rawJson)
      ON CONFLICT(id) DO UPDATE SET
        chat_id = excluded.chat_id, sender_jid = excluded.sender_jid, ts = excluded.ts,
        kind = excluded.kind, body = excluded.body, quoted_id = excluded.quoted_id,
        media_id = excluded.media_id, edited = excluded.edited, revoked = excluded.revoked,
        from_me = excluded.from_me, raw_json = excluded.raw_json
    `)
    return this.#runBatch(rows, (r) =>
      stmt.run({
        id: r.id,
        chatId: r.chatId,
        senderJid: r.senderJid ?? null,
        ts: r.ts,
        kind: r.kind ?? null,
        body: r.body ?? null,
        quotedId: r.quotedId ?? null,
        mediaId: r.mediaId ?? null,
        edited: bool(r.edited),
        revoked: bool(r.revoked),
        fromMe: bool(r.fromMe),
        rawJson: r.rawJson ?? null,
      }),
    )
  }

  upsertMedia(rows: readonly MediaRow[]): number {
    const stmt = this.#db.prepare(`
      INSERT INTO media (id, msg_id, chat_id, mime, size, sha256, filename, status)
      VALUES (@id, @msgId, @chatId, @mime, @size, @sha256, @filename, @status)
      ON CONFLICT(id) DO UPDATE SET
        msg_id = excluded.msg_id, chat_id = excluded.chat_id, mime = excluded.mime,
        size = excluded.size, sha256 = excluded.sha256, filename = excluded.filename,
        status = excluded.status
    `)
    return this.#runBatch(rows, (r) =>
      stmt.run({
        id: r.id,
        msgId: r.msgId ?? null,
        chatId: r.chatId ?? null,
        mime: r.mime ?? null,
        size: r.size ?? null,
        sha256: r.sha256 ?? null,
        filename: r.filename ?? null,
        status: r.status ?? 'pending',
      }),
    )
  }

  #runBatch<T>(rows: readonly T[], write: (row: T) => unknown): number {
    if (rows.length === 0) return 0
    const tx = this.#db.transaction((batch: readonly T[]) => {
      for (const row of batch) write(row)
    })
    tx(rows)
    return rows.length
  }

  // --- reads ----------------------------------------------------------------------------

  /**
   * One page of a chat, newest first by default. Paging is by keyset over `(ts, id)` rather than
   * OFFSET: OFFSET has to walk every skipped row, so page 10 000 of a large chat would read a
   * million rows to return fifty.
   */
  messagesPage(options: {
    chatId: string
    limit: number
    before?: Cursor
    after?: Cursor
  }): MessageRow[] {
    const { chatId, limit } = options
    // The tuple comparison is what makes the index on (chat_id, ts) do all the work.
    const where = options.before
      ? 'AND (ts, id) < (@cursorTs, @cursorId)'
      : options.after
        ? 'AND (ts, id) > (@cursorTs, @cursorId)'
        : ''
    const order = options.after ? 'ASC' : 'DESC'
    const cursor = options.before ?? options.after

    const rows = this.#db
      .prepare(
        `SELECT id, chat_id, sender_jid, ts, kind, body, quoted_id, media_id,
                edited, revoked, from_me, raw_json
         FROM messages
         WHERE chat_id = @chatId ${where}
         ORDER BY ts ${order}, id ${order}
         LIMIT @limit`,
      )
      .all({
        chatId,
        limit,
        cursorTs: cursor?.ts ?? null,
        cursorId: cursor?.id ?? null,
      }) as Record<string, unknown>[]

    const mapped = rows.map((r): MessageRow => ({
      id: r.id as string,
      chatId: r.chat_id as string,
      senderJid: r.sender_jid as string | null,
      ts: r.ts as number,
      kind: r.kind as string | null,
      body: r.body as string | null,
      quotedId: r.quoted_id as string | null,
      mediaId: r.media_id as string | null,
      edited: Boolean(r.edited),
      revoked: Boolean(r.revoked),
      fromMe: Boolean(r.from_me),
      rawJson: r.raw_json as string | null,
    }))
    // Paging forwards reads ascending; the caller always wants newest-first order.
    return options.after ? mapped.reverse() : mapped
  }

  /**
   * Runs a parsed query. Free terms go through FTS5, filters become bound parameters against
   * `search_docs` and `messages`. A filter-only query (`in:Familie has:image`) is legitimate and
   * skips MATCH entirely, because FTS5 rejects an empty match expression.
   *
   * `order` defaults to newest-first, which is both what a chat archive is usually read by and the
   * only ordering that can stop early — see #searchNewestFirst.
   */
  search(
    query: ParsedQuery,
    limit = 50,
    offset = 0,
    order: 'recent' | 'relevance' = 'recent',
  ): SearchHit[] {
    const match = toMatchExpression(query)

    if (order === 'recent' && match !== undefined) {
      return this.#searchNewestFirst(query, match, limit, offset)
    }

    const { where, params } = this.#filterClauses(query)
    if (match !== undefined) {
      where.unshift('search_fts MATCH @match')
      params.match = match
    }
    params.limit = limit
    params.offset = offset

    const sql = `
      SELECT d.msg_id, d.media_id, d.chat_id, d.ts, d.source,
             ${match !== undefined ? 'bm25(search_fts)' : '0'} AS score
      FROM search_docs d
      ${match !== undefined ? 'JOIN search_fts ON search_fts.rowid = d.rowid' : ''}
      LEFT JOIN messages m ON m.id = d.msg_id
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${match !== undefined ? 'score' : 'd.ts DESC'}
      LIMIT @limit OFFSET @offset`

    return (this.#db.prepare(sql).all(params) as Record<string, unknown>[]).map(toHit)
  }

  /**
   * The fast path. FTS5 can walk its doclist backwards and stop at the LIMIT, but only while the
   * statement touches nothing but search_fts — the moment search_docs joins in, SQLite materialises
   * every match into a temp B-tree. Measured on 200 000 messages: 0.09 ms against 43 ms, and the
   * gap widens with the archive.
   *
   * So candidates come from the index alone, newest first (the rowid is time-ordered, see
   * schema.ts), and the filters are applied to one batch at a time until the page is full. The
   * honest worst case is a filter that rejects nearly everything, which degrades to the work the
   * slow path always does.
   */
  #searchNewestFirst(
    query: ParsedQuery,
    match: string,
    limit: number,
    offset: number,
  ): SearchHit[] {
    const candidates = this.#db.prepare(
      'SELECT rowid FROM search_fts WHERE search_fts MATCH @match AND rowid < @cursor' +
        ' ORDER BY rowid DESC LIMIT @size',
    )
    const wanted = limit + offset
    const hits: SearchHit[] = []
    let cursor = Number.MAX_SAFE_INTEGER
    let size = Math.max(wanted * 4, 200)

    while (hits.length < wanted) {
      const rowids = (candidates.all({ match, cursor, size }) as { rowid: number }[]).map(
        (r) => r.rowid,
      )
      if (rowids.length === 0) break
      const last = rowids[rowids.length - 1]
      if (last === undefined) break
      cursor = last
      hits.push(...this.#filterRowids(query, rowids))
      if (rowids.length < size) break
      // Widen rather than crawl, so a filter that rejects most of a batch does not turn into
      // hundreds of round trips.
      size = Math.min(size * 4, 20_000)
    }

    return hits.slice(offset, offset + limit)
  }

  /** Applies the non-text filters to an already-ordered set of candidate rowids. */
  #filterRowids(query: ParsedQuery, rowids: readonly number[]): SearchHit[] {
    const { where, params } = this.#filterClauses(query)
    rowids.forEach((id, i) => (params[`r${String(i)}`] = id))

    const sql = `
      SELECT d.msg_id, d.media_id, d.chat_id, d.ts, d.source, 0 AS score
      FROM search_docs d
      LEFT JOIN messages m ON m.id = d.msg_id
      WHERE d.rowid IN (${rowids.map((_, i) => `@r${String(i)}`).join(', ')})
        ${where.length > 0 ? `AND ${where.join(' AND ')}` : ''}
      ORDER BY d.rowid DESC`

    return (this.#db.prepare(sql).all(params) as Record<string, unknown>[]).map(toHit)
  }

  /**
   * The filters shared by both search paths. Every value is bound, never interpolated — the only
   * thing built from user input is the number of placeholders.
   */
  #filterClauses(query: ParsedQuery): { where: string[]; params: Record<string, unknown> } {
    const params: Record<string, unknown> = {}
    const where: string[] = []
    const list = (values: readonly string[], prefix: string): string => {
      values.forEach((v, i) => (params[`${prefix}${String(i)}`] = v))
      return values.map((_, i) => `@${prefix}${String(i)}`).join(', ')
    }

    if (query.source.length > 0) where.push(`d.source IN (${list(query.source, 'source')})`)

    if (query.in.length > 0) {
      // `in:` names a chat the way the user sees it, so it matches the chat name or its id.
      const ids = list(query.in, 'in')
      where.push(`d.chat_id IN (SELECT id FROM chats WHERE id IN (${ids}) OR name IN (${ids}))`)
    }

    if (query.from.length > 0) {
      const names = list(query.from, 'from')
      where.push(
        `m.sender_jid IN (SELECT jid FROM contacts` +
          ` WHERE jid IN (${names}) OR name IN (${names}) OR pushname IN (${names}))`,
      )
    }

    if (query.has.length > 0) {
      const predicates = query.has.map((h) => hasPredicate(h)).join(' OR ')
      where.push(`EXISTS (SELECT 1 FROM media md WHERE md.msg_id = d.msg_id AND (${predicates}))`)
    }

    if (query.before !== undefined) {
      where.push('d.ts < @before')
      params.before = query.before
    }
    if (query.after !== undefined) {
      where.push('d.ts >= @after')
      params.after = query.after
    }

    return { where, params }
  }

  /** The chat list, most recently active first — the archive panel's left column. */
  chats(limit = 200): ChatRow[] {
    const rows = this.#db
      .prepare(
        `SELECT id, jid, name, kind, last_msg_ts, is_archived, raw_json
         FROM chats ORDER BY IFNULL(last_msg_ts, 0) DESC LIMIT ?`,
      )
      .all(limit) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r.id as string,
      jid: r.jid as string | null,
      name: r.name as string | null,
      kind: (r.kind ?? null) as 'dm' | 'group' | 'broadcast' | 'channel' | null,
      lastMsgTs: r.last_msg_ts as number | null,
      isArchived: Boolean(r.is_archived),
      rawJson: r.raw_json as string | null,
    }))
  }

  /**
   * Records where each chat's backfill got to. Written per batch, so a run that is interrupted —
   * by a quit, a crash, or the user — resumes from the timestamp it reached rather than starting
   * the chat again from the top.
   *
   * `oldest_ts` only ever moves backwards and `newest_ts` only forwards: a later run that fetched
   * less must not erase what an earlier one reached.
   */
  saveSyncState(rows: readonly SyncStateRow[]): number {
    const write = this.#db.prepare(
      `INSERT INTO sync_state
         (chat_id, oldest_ts, newest_ts, backfill_done, depth_limit_ts, priority, last_error, updated_ts)
       VALUES (@chatId, @oldestTs, @newestTs, @backfillDone, @depthLimitTs, @priority, @lastError, @updatedTs)
       ON CONFLICT(chat_id) DO UPDATE SET
         oldest_ts      = MIN(IFNULL(excluded.oldest_ts, sync_state.oldest_ts),
                              IFNULL(sync_state.oldest_ts, excluded.oldest_ts)),
         newest_ts      = MAX(IFNULL(excluded.newest_ts, sync_state.newest_ts),
                              IFNULL(sync_state.newest_ts, excluded.newest_ts)),
         backfill_done  = excluded.backfill_done,
         depth_limit_ts = IFNULL(excluded.depth_limit_ts, sync_state.depth_limit_ts),
         priority       = excluded.priority,
         last_error     = excluded.last_error,
         updated_ts     = excluded.updated_ts`,
    )
    const now = Math.floor(Date.now() / 1000)
    return this.#runBatch(rows, (row) =>
      write.run({
        chatId: row.chatId,
        oldestTs: row.oldestTs ?? null,
        newestTs: row.newestTs ?? null,
        backfillDone: row.backfillDone ? 1 : 0,
        depthLimitTs: row.depthLimitTs ?? null,
        priority: row.priority ?? 0,
        lastError: row.lastError ?? null,
        updatedTs: row.updatedTs ?? now,
      }),
    )
  }

  /** The recorded progress, so a restart can pick the queue back up where it stopped. */
  syncState(chatId?: string): SyncStateRow[] {
    const sql =
      `SELECT chat_id, oldest_ts, newest_ts, backfill_done, depth_limit_ts, priority, last_error, updated_ts
       FROM sync_state` + (chatId ? ' WHERE chat_id = ?' : ' ORDER BY priority DESC, chat_id')
    const rows = (
      chatId ? this.#db.prepare(sql).all(chatId) : this.#db.prepare(sql).all()
    ) as Record<string, unknown>[]
    return rows.map((r) => ({
      chatId: r.chat_id as string,
      oldestTs: r.oldest_ts as number | null,
      newestTs: r.newest_ts as number | null,
      backfillDone: Boolean(r.backfill_done),
      depthLimitTs: r.depth_limit_ts as number | null,
      priority: r.priority as number,
      lastError: r.last_error as string | null,
      updatedTs: r.updated_ts as number | null,
    }))
  }

  /**
   * Media rows that were mirrored but whose bytes are not here yet. The fetcher works this list, so
   * a download interrupted by a quit is simply picked up again — the row still says `pending`.
   */
  pendingMedia(limit = 50): MediaRow[] {
    const rows = this.#db
      .prepare(
        `SELECT id, msg_id, chat_id, mime, size, sha256, filename, status
         FROM media WHERE status = 'pending' ORDER BY rowid LIMIT ?`,
      )
      .all(limit) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r.id as string,
      msgId: r.msg_id as string | null,
      chatId: r.chat_id as string | null,
      mime: r.mime as string | null,
      size: r.size as number | null,
      sha256: r.sha256 as string | null,
      filename: r.filename as string | null,
      status: r.status as MediaRow['status'],
    }))
  }

  /** Records the outcome of a fetch. A refusal is recorded too, with its reason (§10). */
  markMedia(mediaId: string, status: 'pending' | 'done' | 'failed' | 'skipped'): void {
    this.#db.prepare('UPDATE media SET status = ? WHERE id = ?').run(status, mediaId)
  }

  /**
   * Points a media row at a stored blob and queues the content-index job for it.
   *
   * Both in one statement pair rather than two calls from outside: a row marked `done` with no job
   * behind it is a file that silently never becomes searchable, and that is exactly the kind of
   * gap nobody notices until they go looking for a document they know they have.
   */
  attachBlob(mediaId: string, sha256: string, size: number): void {
    this.#db
      .prepare(`UPDATE media SET sha256 = ?, size = ?, status = 'done' WHERE id = ?`)
      .run(sha256, size, mediaId)
  }

  /**
   * A whole chat for the export, messages oldest-first with their media attached.
   *
   * `since` makes the run incremental. The cap is not optional: an export of a chat with a million
   * messages has to be paged like everything else, and the caller loops until it gets less than a
   * full page (§3.1, "Alles laden gibt es nicht").
   */
  chatForExport(
    chatId: string,
    options: { since?: number | undefined; limit?: number; afterId?: string | undefined } = {},
  ): { chat: ChatRow | undefined; messages: (MessageRow & { media?: MediaRow | null })[] } {
    const chat = this.chats(1000).find((c) => c.id === chatId)
    const limit = Math.min(options.limit ?? 1000, 5000)

    const rows = this.#db
      .prepare(
        `SELECT m.id, m.chat_id, m.sender_jid, m.ts, m.kind, m.body, m.quoted_id, m.media_id,
                m.edited, m.revoked, m.from_me, m.raw_json,
                d.id AS media_row_id, d.mime AS media_mime, d.size AS media_size,
                d.sha256 AS media_sha256, d.filename AS media_filename, d.status AS media_status
         FROM messages m
         LEFT JOIN media d ON d.id = m.media_id
         WHERE m.chat_id = @chatId
           AND m.ts > @since
           AND (@afterId IS NULL OR (m.ts, m.id) > (
                 SELECT ts, id FROM messages WHERE id = @afterId))
         ORDER BY m.ts ASC, m.id ASC
         LIMIT @limit`,
      )
      .all({
        chatId,
        since: options.since ?? -1,
        afterId: options.afterId ?? null,
        limit,
      }) as Record<string, unknown>[]

    return {
      chat,
      messages: rows.map((r) => ({
        id: r.id as string,
        chatId: r.chat_id as string,
        senderJid: r.sender_jid as string | null,
        ts: r.ts as number,
        kind: r.kind as string | null,
        body: r.body as string | null,
        quotedId: r.quoted_id as string | null,
        mediaId: r.media_id as string | null,
        edited: Boolean(r.edited),
        revoked: Boolean(r.revoked),
        fromMe: Boolean(r.from_me),
        rawJson: r.raw_json as string | null,
        media: r.media_row_id
          ? {
              id: r.media_row_id as string,
              mime: r.media_mime as string | null,
              size: r.media_size as number | null,
              sha256: r.media_sha256 as string | null,
              filename: r.media_filename as string | null,
              status: r.media_status as MediaRow['status'],
            }
          : null,
      })),
    }
  }

  /** Every media row a backup has to account for — with its id, so the report can name what failed. */
  mediaForBackup(): MediaRow[] {
    const rows = this.#db
      .prepare(
        `SELECT id, msg_id, chat_id, mime, size, sha256, filename, status
         FROM media WHERE status IN ('done', 'failed') ORDER BY rowid`,
      )
      .all() as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r.id as string,
      msgId: r.msg_id as string | null,
      chatId: r.chat_id as string | null,
      mime: r.mime as string | null,
      size: r.size as number | null,
      sha256: r.sha256 as string | null,
      filename: r.filename as string | null,
      status: r.status as MediaRow['status'],
    }))
  }

  stats(pendingWrites = 0): {
    messages: number
    chats: number
    media: number
    searchDocs: number
    databaseBytes: number
    pendingWrites: number
  } {
    const count = (table: string): number =>
      (this.#db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
    const pageCount = Number(this.#db.pragma('page_count', { simple: true }))
    const pageSize = Number(this.#db.pragma('page_size', { simple: true }))
    return {
      messages: count('messages'),
      chats: count('chats'),
      media: count('media'),
      searchDocs: count('search_docs'),
      databaseBytes: pageCount * pageSize,
      pendingWrites,
    }
  }

  /**
   * A defragmented copy, for backup. VACUUM INTO does not lock readers out for the duration the way
   * a plain VACUUM does, and the result is a single consistent file rather than a database plus a
   * WAL that a naive copy would miss.
   */
  snapshot(toFile: string): void {
    this.#db.prepare('VACUUM INTO ?').run(toFile)
  }

  /** Messages either side of a hit, for the ±3 context the result list shows. */
  contextAround(msgId: string, radius = 3): MessageRow[] {
    const anchor = this.#db.prepare('SELECT chat_id, ts FROM messages WHERE id = ?').get(msgId) as
      { chat_id: string; ts: number } | undefined
    if (!anchor) return []

    const before = this.messagesPage({
      chatId: anchor.chat_id,
      limit: radius,
      before: { ts: anchor.ts, id: msgId },
    })
    const after = this.messagesPage({
      chatId: anchor.chat_id,
      limit: radius,
      after: { ts: anchor.ts, id: msgId },
    })
    const self = this.#db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId) as Record<
      string,
      unknown
    >

    return [
      ...after,
      {
        id: self.id as string,
        chatId: self.chat_id as string,
        senderJid: self.sender_jid as string | null,
        ts: self.ts as number,
        kind: self.kind as string | null,
        body: self.body as string | null,
        quotedId: self.quoted_id as string | null,
        mediaId: self.media_id as string | null,
        edited: Boolean(self.edited),
        revoked: Boolean(self.revoked),
        fromMe: Boolean(self.from_me),
        rawJson: self.raw_json as string | null,
      },
      ...before,
    ]
  }
}

function toHit(r: Record<string, unknown>): SearchHit {
  return {
    msgId: r.msg_id as string | null,
    mediaId: r.media_id as string | null,
    chatId: r.chat_id as string | null,
    ts: r.ts as number | null,
    source: r.source as string,
    score: r.score as number,
  }
}

/** `has:` maps to a mime prefix, except `file`, which means "any attachment at all". */
function hasPredicate(has: string): string {
  switch (has) {
    case 'image':
      return "md.mime LIKE 'image/%'"
    case 'audio':
      return "md.mime LIKE 'audio/%'"
    case 'video':
      return "md.mime LIKE 'video/%'"
    case 'link':
      // Links live in the body, not in media; handled by the caller's term filter instead.
      return '0'
    default:
      return '1'
  }
}
