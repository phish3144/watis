/**
 * The archive schema (PLAN.md §5.4) and its migrations.
 *
 * Migrations are an append-only list indexed by `user_version`. A migration is never edited once it
 * has shipped — a database in the field has already run it, and rewriting history here would leave
 * those installations on a schema no code describes any more.
 */

export interface Migration {
  readonly version: number
  readonly name: string
  readonly sql: string
}

/**
 * Every text that reaches the search index goes through `wa_index_form` (ADR 0002). Registering it
 * as a SQL function rather than normalising in JS keeps the triggers in §5.4 doing what they say
 * they do: one source of truth, `search_docs`, fed by the tables that own the text.
 */
export const INDEX_FORM_FUNCTION = 'wa_index_form'

const INITIAL = `
CREATE TABLE chats (
  id           TEXT PRIMARY KEY,
  jid          TEXT,
  name         TEXT,
  kind         TEXT CHECK (kind IN ('dm', 'group', 'broadcast', 'channel')),
  last_msg_ts  INTEGER,
  is_archived  INTEGER NOT NULL DEFAULT 0,
  raw_json     TEXT
) STRICT;

CREATE TABLE contacts (
  jid      TEXT PRIMARY KEY,
  name     TEXT,
  pushname TEXT,
  phone    TEXT
) STRICT;

-- WhatsApp message ids are strings and are never reshaped (PLAN.md §5.4).
CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL,
  sender_jid TEXT,
  ts         INTEGER NOT NULL,
  kind       TEXT,
  body       TEXT,
  quoted_id  TEXT,
  media_id   TEXT,
  edited     INTEGER NOT NULL DEFAULT 0,
  revoked    INTEGER NOT NULL DEFAULT 0,
  from_me    INTEGER NOT NULL DEFAULT 0,
  raw_json   TEXT
) STRICT;

CREATE TABLE media (
  id       TEXT PRIMARY KEY,
  msg_id   TEXT,
  chat_id  TEXT,
  mime     TEXT,
  size     INTEGER,
  sha256   TEXT,
  filename TEXT,
  status   TEXT NOT NULL DEFAULT 'pending'
           CHECK (status IN ('pending', 'done', 'failed', 'skipped'))
) STRICT;

CREATE TABLE sync_state (
  chat_id        TEXT PRIMARY KEY,
  oldest_ts      INTEGER,
  newest_ts      INTEGER,
  backfill_done  INTEGER NOT NULL DEFAULT 0,
  depth_limit_ts INTEGER,
  priority       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  updated_ts     INTEGER
) STRICT;

CREATE TABLE content_text (
  id             INTEGER PRIMARY KEY,
  msg_id         TEXT,
  media_id       TEXT,
  source         TEXT NOT NULL CHECK (source IN ('ocr', 'pdf', 'docx', 'text', 'transcript')),
  text           TEXT NOT NULL,
  detail_json    TEXT,
  engine         TEXT,
  engine_version TEXT,
  lang           TEXT,
  confidence     REAL,
  created_ts     INTEGER
) STRICT;

CREATE TABLE index_jobs (
  id         INTEGER PRIMARY KEY,
  media_id   TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('ocr', 'pdf', 'docx', 'text', 'transcript')),
  priority   INTEGER NOT NULL DEFAULT 0,
  attempts   INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'queued'
             CHECK (status IN ('queued', 'running', 'done', 'failed', 'skipped')),
  last_error TEXT,
  updated_ts INTEGER
) STRICT;

-- The single source for the full-text index. text holds the NORMALISED form (ADR 0002); the
-- original stays in messages.body / content_text.text, which is where the hit display reads it.
CREATE TABLE search_docs (
  rowid    INTEGER PRIMARY KEY,
  msg_id   TEXT,
  media_id TEXT,
  chat_id  TEXT,
  ts       INTEGER,
  source   TEXT NOT NULL,
  text     TEXT NOT NULL
) STRICT;

CREATE VIRTUAL TABLE search_fts USING fts5(
  text,
  source UNINDEXED,
  chat_id UNINDEXED,
  content='search_docs',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- Indexes from §5.4.
CREATE INDEX idx_messages_chat_ts   ON messages (chat_id, ts);
CREATE INDEX idx_messages_sender_ts ON messages (sender_jid, ts);
CREATE INDEX idx_media_sha256       ON media (sha256);
CREATE INDEX idx_media_chat_mime    ON media (chat_id, mime);
CREATE INDEX idx_index_jobs_queue   ON index_jobs (status, priority);
CREATE INDEX idx_search_docs_msg    ON search_docs (msg_id);
CREATE INDEX idx_content_text_media ON content_text (media_id, source);

-- One search_docs row per (message, source) and per (media, source). Without this a re-import
-- would silently duplicate every document in the index.
CREATE UNIQUE INDEX idx_search_docs_identity
  ON search_docs (source, IFNULL(msg_id, ''), IFNULL(media_id, ''));

-- --- search_docs -> search_fts -------------------------------------------------------------
-- External-content FTS5 does not observe its content table on its own; these three triggers are
-- what keeps the index and the table in step.
CREATE TRIGGER search_docs_ai AFTER INSERT ON search_docs BEGIN
  INSERT INTO search_fts (rowid, text, source, chat_id)
  VALUES (new.rowid, new.text, new.source, new.chat_id);
END;

CREATE TRIGGER search_docs_ad AFTER DELETE ON search_docs BEGIN
  INSERT INTO search_fts (search_fts, rowid, text, source, chat_id)
  VALUES ('delete', old.rowid, old.text, old.source, old.chat_id);
END;

CREATE TRIGGER search_docs_au AFTER UPDATE ON search_docs BEGIN
  INSERT INTO search_fts (search_fts, rowid, text, source, chat_id)
  VALUES ('delete', old.rowid, old.text, old.source, old.chat_id);
  INSERT INTO search_fts (rowid, text, source, chat_id)
  VALUES (new.rowid, new.text, new.source, new.chat_id);
END;

-- --- messages.body -> search_docs ----------------------------------------------------------
CREATE TRIGGER messages_ai_search AFTER INSERT ON messages
WHEN new.body IS NOT NULL AND new.body <> '' AND new.revoked = 0 BEGIN
  INSERT INTO search_docs (msg_id, chat_id, ts, source, text)
  VALUES (new.id, new.chat_id, new.ts, 'body', ${INDEX_FORM_FUNCTION}(new.body))
  ON CONFLICT (source, IFNULL(msg_id, ''), IFNULL(media_id, ''))
  DO UPDATE SET text = excluded.text, ts = excluded.ts, chat_id = excluded.chat_id;
END;

-- An edit rewrites the indexed text; a revoke removes it. Both arrive as UPDATEs, because the
-- message row itself stays (PLAN.md keeps revoked messages, it just marks them).
CREATE TRIGGER messages_au_search AFTER UPDATE OF body, revoked ON messages BEGIN
  DELETE FROM search_docs WHERE msg_id = old.id AND source = 'body';
  INSERT INTO search_docs (msg_id, chat_id, ts, source, text)
  SELECT new.id, new.chat_id, new.ts, 'body', ${INDEX_FORM_FUNCTION}(new.body)
  WHERE new.body IS NOT NULL AND new.body <> '' AND new.revoked = 0;
END;

CREATE TRIGGER messages_ad_search AFTER DELETE ON messages BEGIN
  DELETE FROM search_docs WHERE msg_id = old.id;
END;

-- --- media.filename -> search_docs ---------------------------------------------------------
CREATE TRIGGER media_ai_search AFTER INSERT ON media
WHEN new.filename IS NOT NULL AND new.filename <> '' BEGIN
  INSERT INTO search_docs (msg_id, media_id, chat_id, source, text)
  VALUES (new.msg_id, new.id, new.chat_id, 'filename', ${INDEX_FORM_FUNCTION}(new.filename))
  ON CONFLICT (source, IFNULL(msg_id, ''), IFNULL(media_id, ''))
  DO UPDATE SET text = excluded.text;
END;

CREATE TRIGGER media_ad_search AFTER DELETE ON media BEGIN
  DELETE FROM search_docs WHERE media_id = old.id;
END;

-- --- content_text.text -> search_docs ------------------------------------------------------
-- OCR, PDF and transcript text. Re-indexing with a newer engine replaces the row for that source
-- only, leaving the other sources of the same media untouched (§5.4).
CREATE TRIGGER content_text_ai_search AFTER INSERT ON content_text BEGIN
  INSERT INTO search_docs (msg_id, media_id, chat_id, ts, source, text)
  SELECT new.msg_id, new.media_id, m.chat_id, m.ts, new.source, ${INDEX_FORM_FUNCTION}(new.text)
  FROM (SELECT chat_id, ts FROM messages WHERE id = new.msg_id
        UNION ALL SELECT NULL, NULL LIMIT 1) AS m
  WHERE new.text <> ''
  ON CONFLICT (source, IFNULL(msg_id, ''), IFNULL(media_id, ''))
  DO UPDATE SET text = excluded.text;
END;

CREATE TRIGGER content_text_ad_search AFTER DELETE ON content_text BEGIN
  DELETE FROM search_docs
  WHERE source = old.source
    AND IFNULL(media_id, '') = IFNULL(old.media_id, '')
    AND IFNULL(msg_id, '') = IFNULL(old.msg_id, '');
END;
`

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial schema', sql: INITIAL },
]

export const LATEST_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0)
