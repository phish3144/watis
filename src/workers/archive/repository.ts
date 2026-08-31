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
  jid?: string | null
  name?: string | null
  kind?: 'dm' | 'group' | 'broadcast' | 'channel' | null
  lastMsgTs?: number | null
  isArchived?: boolean
  rawJson?: string | null
}

export interface ContactRow {
  jid: string
  name?: string | null
  pushname?: string | null
  phone?: string | null
}

export interface MessageRow {
  id: string
  chatId: string
  senderJid?: string | null
  ts: number
  kind?: string | null
  body?: string | null
  quotedId?: string | null
  mediaId?: string | null
  edited?: boolean
  revoked?: boolean
  fromMe?: boolean
  rawJson?: string | null
}

export interface MediaRow {
  id: string
  msgId?: string | null
  chatId?: string | null
  mime?: string | null
  size?: number | null
  sha256?: string | null
  filename?: string | null
  status?: 'pending' | 'done' | 'failed' | 'skipped'
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
