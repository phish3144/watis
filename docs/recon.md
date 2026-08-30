# wawrap — Konsolidierter Technik-Brief

**Stand: 2026-08-30** · Konsolidiert aus vier Recon-Reports und drei adversarialen Verifikationsläufen, plus eigener Nachprüfung.
**Status: entscheidungsreif.** Alle tragenden Behauptungen wurden gegen Live-Quellen geprüft; wo ich selbst gemessen habe, steht der Befehl dabei.

---

## 0. Wie dieses Dokument zu lesen ist

Drei Vertrauensstufen, konsequent markiert:

| Marker | Bedeutung |
|---|---|
| **[VERIFIZIERT]** | Ich habe es in dieser Sitzung selbst ausgeführt oder gegen die Primärquelle geprüft. Befehl bzw. URL steht dabei. |
| **[RECON]** | Aus einem Recon-Report übernommen, plausibel und unwidersprochen, aber von mir nicht erneut ausgeführt. |
| **[UNGEKLÄRT]** | Reports widersprechen sich oder niemand konnte es prüfen. Dazu steht jeweils, wie es billig zu klären ist. |

Wo ein Verifier eine Recon-Behauptung **korrigiert** hat, gilt der Verifier. Diese Stellen sind ausdrücklich als Korrektur ausgewiesen.

---

## 1. Executive Summary

Der Stack trägt. Drei Punkte im PLAN.md sind jedoch falsch oder unentschieden, und eine Projektphase ist eine Wette, kein Bauvorhaben.

1. **Die Suche funktioniert so, wie geplant, nicht.** `ORDER BY rank` über den Gesamtkorpus kostet bei 1,5 Mio. Dokumenten 1155,9 ms; `ORDER BY rowid DESC` kostet 0,286 ms. Faktor 4000. Das Ziel p95 < 200 ms ist mit bm25-Ranking physikalisch unerreichbar und mit monotoner `doc_id` trivial.
2. **Das FTS5-Schema korrumpiert sich still.** Es fehlen sämtliche Trigger; und selbst mit Triggern zerstört `INSERT OR REPLACE` bei `recursive_triggers=OFF` den Index. `integrity-check` meldet in der Default-Form „OK".
3. **Zwei harte Constraint-Konflikte**, beide aus dem Quellcode belegt: Windows-Toasts erzwingen eine Verknüpfung im Roaming-Profil; „Direct Reply" ist ein Sendevorgang und bricht das Read-Only-Constraint.
4. **Phase 3 ist machbar, aber unbefristet teuer** — und niemand hat die Live-Seite je gesehen.

Aufgelöst wurde außerdem ein direkter Widerspruch zwischen zwei Recon-Reports zur Installer-Konfiguration (Abschnitt 6).

---

## 2. Gepinnte Abhängigkeiten

Alle Versionen **exakt** pinnen, keine Carets. `save-exact=true` in `.npmrc`.

| Paket | Version | Lizenz | Begründung |
|---|---|---|---|
| `electron` | **44.0.0** | MIT | Einzige vernünftige Wahl, siehe §3. Chromium 152, Node 24.18.1, NODE_MODULE_VERSION 149. **[VERIFIZIERT]** |
| `better-sqlite3` | **13.0.3** | MIT | Node-API, alle 8 Prebuilds im Tarball, kein Rebuild. SQLite 3.53.4 mit FTS5 + STAT4. **[VERIFIZIERT]** |
| `@types/better-sqlite3` | **9.6.0** | MIT | Zwingend — das Paket liefert keine eigenen Typen (sonst TS7016). **[VERIFIZIERT]** |
| `vite` | **7.3.6** | MIT | **NICHT 8.x.** Mit electron-vite 5 harter ERESOLVE-Fehler. **[VERIFIZIERT]** |
| `electron-vite` | **5.0.0** | MIT | Letzte stabile Version; peer `vite ^5 \|\| ^6 \|\| ^7`. **[VERIFIZIERT]** |
| `electron-builder` | **26.15.7** | MIT | **Explizit pinnen** — `latest` liefert das ältere 26.15.3. **[VERIFIZIERT]** |
| `electron-updater` | **6.8.9** | MIT | Teilt `builder-util-runtime` mit electron-builder 26. 7.x nur Alpha. **[VERIFIZIERT]** |
| `typescript` | **7.0.2** | Apache-2.0 | Nativer Compiler. Lizenz hat sich geändert. **[VERIFIZIERT]** |
| `zod` | **4.5.4** | MIT | IPC-Schemata. **[VERIFIZIERT]** |
| `react` | **19.2.8** | MIT | Eigene UI. **[VERIFIZIERT]** |
| `tailwindcss` + `@tailwindcss/vite` | **4.3.3** | MIT | v4 läuft über das Vite-Plugin, nicht über PostCSS. **[VERIFIZIERT]** |
| `better-sqlite3-multiple-ciphers` | 13.0.3 | MIT | **Nur falls** Verschlüsselung kommt. Kein Schema-Wechsel nötig. **[RECON]** |

**Ausdrücklich NICHT im Projekt:** `@electron/rebuild`, `electron-rebuild`, `node-gyp`, `prebuild-install`, `moduleraid`, `electron-windows-notifications`, `node-notifier`.

```bash
# [VERIFIZIERT] am 2026-08-30
$ npm view electron dist-tags --json          # latest 44.0.0, alpha 45.0.0-alpha.1
$ npm view electron-builder dist-tags --json  # latest 26.15.3, v26 26.15.7, next 27.0.0-alpha.7
$ npm view electron-builder@latest version    # 26.15.3   <- veralteter Tag
$ npm view 'electron-builder@^26' version     # 26.15.7   <- tatsächlich neuestes v26
$ npm install electron-vite@5.0.0 vite@8.2.2 --dry-run   # npm error code ERESOLVE
$ npm install electron-vite@5.0.0 vite@7.3.6 --dry-run   # added 134 packages in 5s
```

### 2.1 Der Prebuild-Befund

```bash
# [VERIFIZIERT]
$ npm install better-sqlite3@13.0.3
added 2 packages in 698ms          # <- keine Kompilierung, kein node-gyp

$ ls node_modules/better-sqlite3/prebuilds/
darwin-arm64.node  darwin-x64.node   linux-arm64.node     linux-x64.node
linuxmusl-arm64.node linuxmusl-x64.node win32-arm64.node  win32-x64.node

$ node -e "const p=require('./node_modules/better-sqlite3/package.json');
           console.log('gypfile:',p.gypfile,'install:',p.scripts&&p.scripts.install)"
gypfile: false install: undefined
```

Damit ist die gesamte Rebuild-Fragestellung des ursprünglichen Plans hinfällig. Die Prebuilds sind Node-API-basiert (`NAPI_VERSION=10`) und damit **ABI-unabhängig** — ein Electron-Bump kann sie nicht mehr brechen.

> **Fallstrick:** `electron-builder` ruft trotzdem `@electron/rebuild` auf und **scheitert hart** bei jedem Cross-Arch-Job (`node-gyp does not support cross-compiling native modules from source`). Gegenmittel: `npmRebuild: false`. Netter Nebeneffekt: Beide macOS-Architekturen lassen sich auf einem einzigen arm64-Runner bauen.

---

## 3. Entscheidung: Electron 44.0.0

**[VERIFIZIERT]** — `npm view electron dist-tags`, Quelle für die Termine: <https://releases.electronjs.org/schedule>

| Major | Stable | EOL | Bewertung |
|---|---|---|---|
| 41 | 2026-03-10 | **2026-08-25** | Tot seit fünf Tagen. |
| 42 | 2026-05-05 | **2026-10-20** | Falle — EOL in sieben Wochen. |
| 43 | 2026-06-30 | 2027-01-05 | Rückfallebene. |
| **44** | **2026-08-25** | **2027-03-02** | **Gewählt.** ~6 Monate Laufzeit. |
| 45 | 2026-10-20 | 2027-04-27 | Nächster Sprung. |

Die Supportpolicy sind die letzten drei stabilen Majors ([electron-timelines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines), **[VERIFIZIERT]**). Electron 42 als „konservative" Wahl wäre ein Trugschluss: v1 erschiene auf einer ungepatchten Basis.

**Untergrenze 42**, niemals darunter: Windows-Inline-Reply ist auf 41 kaputt.

```bash
# [VERIFIZIERT] — Tag-Diff der Toast-Implementierung
$ for t in v41.0.0 v42.0.0 v44.0.0; do
    curl -sS https://raw.githubusercontent.com/electron/electron/$t/shell/browser/notifications/win/windows_toast_notification.cc \
    | grep -c 'ExtractUserInputs'; done
v41.0.0 -> 0     # Antworttext wird bei laufender App verworfen
v42.0.0 -> 2     # behoben
v44.0.0 -> 2
```

### 3.1 Breaking Changes in 44, die uns treffen

**[VERIFIZIERT]** gegen <https://www.electronjs.org/docs/latest/breaking-changes> und die Typdefinitionen aus dem npm-Tarball:

- **`clipboard` ist im Renderer entfernt.** Bricht zur Laufzeit, nicht beim Build. Renderer nutzt `navigator.clipboard`; alles andere über validiertes IPC.
- **`openAsHidden` existiert nicht mehr.** `grep -c openAsHidden electron.d.ts` → **44: 0**, 43: 3, 42: 3. „Minimiert starten" läuft über `args` plus eigene `argv`-Prüfung.
- **macOS 12 entfernt** → `LSMinimumSystemVersion: 13.0`, CI auf `macos-14+`.
- **Windows ia32 und Linux armv7l entfernt.** Für uns irrelevant (x64-Ziel).
- **`net.request`** weist Anfragen mit `Sec-Fetch-Dest: document/frame/iframe/fencedframe` ab — **außer wenn `Sec-Fetch-Mode: navigate` gesetzt ist.**

> **Korrektur (Verifier schlägt Recon).** Die Recon stellte die `net.request`-Einschränkung als absolut dar. Die Doku nennt ausdrücklich die `navigate`-Ausnahme. **[VERIFIZIERT]** Praktisch folgenlos für wawrap, aber beim Zitieren korrekt wiedergeben.

### 3.2 API-Oberfläche, direkt aus `electron.d.ts@44.0.0`

```bash
# [VERIFIZIERT] — npm pack electron@44.0.0 && tar -xzf … && grep …
setBadgeCount(count?: number): boolean;   // @platform linux,darwin   <- KEIN Windows
setOverlayIcon(overlay, description);     // @platform win32
hasReply?: boolean;                       // @platform darwin,win32
setToastActivatorCLSID(id: string): void;         // Zeile 1848
static handleActivation(callback): void;          // Zeile 10601
executeJavaScriptInIsolatedWorld(worldId, scripts, userGesture?) // Zeile 18114
grep -c 'openAsHidden'  -> 0        # entfernt
grep -c "'sessionData'" -> 1        # weiterhin vorhanden
grep -c 'class BrowserView' -> 3    # deprecated, aber vorhanden
```

`setBadgeCount` trägt **keinen** `@deprecated`-Marker — es ist schlicht auf Windows nicht implementiert und dort ein stiller No-Op.

---

## 4. SQLite / FTS5 — der wichtigste Abschnitt

### 4.1 Umgebung

```bash
# [VERIFIZIERT]
sqlite: 3.53.4
FTS5: true   STAT4: true   THREADSAFE=2
```

### 4.2 Der Performance-Befund

Eigener Benchmark, 1,5 Mio. Dokumente, WAL, `synchronous=NORMAL`, Median aus 7 Läufen. **[VERIFIZIERT]**

| Query | p50 |
|---|---|
| `ORDER BY rank LIMIT 50` | **1155,9 ms** |
| `ORDER BY search_fts.rowid DESC LIMIT 50` | **0,286 ms** |
| `ORDER BY d.ts DESC LIMIT 50` | 469,7 ms |
| 6-Term-OR + `rank` | 3260,9 ms |
| 6-Term-OR + `rowid DESC` | 1,229 ms |
| 2000er-Fenster, danach bm25 | 39,6 ms |
| `count(*)` als Preflight | 58,9 ms |

```
EXPLAIN QUERY PLAN
  rowid DESC -> SCAN search_fts VIRTUAL TABLE INDEX 192:M2   <- Early Exit
  rank       -> SCAN search_fts VIRTUAL TABLE INDEX 32:M2    <- voller Scan
```

**Der Mechanismus:** FTS5 hat kein Top-k-Early-Exit für bm25. Die Kosten sind O(Treffer), nicht O(LIMIT). Ein absteigender rowid-Scan bricht dagegen nach 50 Zeilen ab.

> Mein Korpus ist mit 70 % Trefferquote dichter als der der Recon (8,4 %), daher meine höheren Absolutwerte. Das Verhältnis ist identisch und der Mechanismus korpus-unabhängig. Bei echtem, zipf-verteiltem Text sind seltene Begriffe schneller — **häufige Begriffe („ok", „danke") liegen im selben Bereich oder schlechter.** Genau das ist der Fall, der `ORDER BY rank` bricht.

**Konsequenz:** `doc_id = ts_ms*64 + seq` (monoton in ts), jede Suche über `ORDER BY rowid DESC`. Preis laut Recon: +59 % FTS-Index, +24 % Dateigröße, +12 % Insert-Zeit. **[RECON]** Das ist der Preis für eine funktionierende Suche.

### 4.3 Die stille Korruption

Alle Fälle selbst reproduziert. **[VERIFIZIERT]**

| Szenario | FTS-Treffer | Zeilen | `integrity-check` (Default) | `integrity-check(rank=1)` |
|---|---|---|---|---|
| Naiver `DELETE`-Trigger, 1 von 5 gelöscht | 5 | 4 | **OK** ❌ | `database disk image is malformed` ✅ |
| Korrekte Trigger, `DELETE` | 4 | 4 | OK | OK |
| `INSERT OR REPLACE`, `rt=OFF` | 5 | 5 | **OK** ❌ | `database disk image is malformed` ✅ |
| `INSERT OR REPLACE`, `rt=ON` | 4 | 5 | OK | OK |
| Upsert `ON CONFLICT DO UPDATE`, `rt=OFF` | 4 | 5 | OK | OK |

**Drei Regeln, jede einzeln belegt:**

1. `DELETE FROM search_fts WHERE rowid = …` funktioniert **nicht**. Es muss das `'delete'`-Kommando mit **allen** alten Spaltenwerten sein.
2. `PRAGMA recursive_triggers = ON` auf **jeder** Verbindung. Sonst umgeht `INSERT OR REPLACE` den Delete-Trigger.
3. Health-Check **nur** mit `rank=1`. Die Default-Form findet Desynchronisation nicht.

### 4.4 Korrigiertes DDL — `0001_init.sql`

End-to-end validiert: Diakritika-Faltung, Upsert-Pfad und FK-CASCADE geprüft, `integrity-check(rank=1)` bleibt OK. **[VERIFIZIERT]**

```sql
-- ts ist durchgängig epoch MILLISEKUNDEN, UTC, NOT NULL.

CREATE TABLE chats (
  chat_id      INTEGER PRIMARY KEY,
  jid          TEXT    NOT NULL UNIQUE,
  name         TEXT,
  kind         TEXT    NOT NULL CHECK (kind IN ('dm','group','broadcast','newsletter','status')),
  last_msg_ts  INTEGER,
  is_archived  INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1)),
  updated_ts   INTEGER NOT NULL
) STRICT;
CREATE INDEX ix_chats_recent ON chats(last_msg_ts DESC) WHERE is_archived = 0;

CREATE TABLE contacts (
  contact_id INTEGER PRIMARY KEY,
  jid        TEXT NOT NULL UNIQUE,
  name       TEXT, pushname TEXT, phone TEXT,
  updated_ts INTEGER NOT NULL
) STRICT;

CREATE TABLE messages (
  mid          INTEGER PRIMARY KEY,
  chat_id      INTEGER NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  wa_id        TEXT    NOT NULL,     -- WhatsApp key.id: nur INNERHALB eines Chats eindeutig
  sender_id    INTEGER REFERENCES contacts(contact_id),
  ts           INTEGER NOT NULL,
  kind         TEXT    NOT NULL,
  body         TEXT,
  quoted_mid   INTEGER REFERENCES messages(mid) ON DELETE SET NULL,
  quoted_wa_id TEXT,                 -- Rohwert behalten: Zitat evtl. noch nicht synchronisiert
  edited       INTEGER NOT NULL DEFAULT 0 CHECK (edited  IN (0,1)),
  revoked      INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0,1)),
  from_me      INTEGER NOT NULL DEFAULT 0 CHECK (from_me IN (0,1))
) STRICT;
CREATE UNIQUE INDEX ux_messages_chat_waid ON messages(chat_id, wa_id);
CREATE INDEX ix_messages_chat_ts ON messages(chat_id, ts DESC, mid DESC);
CREATE INDEX ix_messages_ts      ON messages(ts DESC, mid DESC);  -- ~183 MB bei 5M: weglassen ohne globale Timeline
CREATE INDEX ix_messages_quoted  ON messages(quoted_mid) WHERE quoted_mid IS NOT NULL;

-- raw_json AUSGELAGERT: Hot Table 195,8 MB inline vs. 23,3 MB ausgelagert (Faktor 8,4)
CREATE TABLE messages_raw (
  mid INTEGER PRIMARY KEY REFERENCES messages(mid) ON DELETE CASCADE,
  raw BLOB NOT NULL                  -- gzip(JSON.stringify(...))
) STRICT;

CREATE TABLE media (
  media_id   INTEGER PRIMARY KEY,
  mid        INTEGER NOT NULL REFERENCES messages(mid) ON DELETE CASCADE,
  chat_id    INTEGER NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  mime       TEXT, size INTEGER,
  sha256     BLOB,                   -- 32-Byte-BLOB, nicht 64-Zeichen-Hex
  filename   TEXT, rel_path TEXT,    -- Datei liegt auf Platte, nur Metadaten hier
  status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','downloading','done','failed','skipped','gone')),
  updated_ts INTEGER NOT NULL
) STRICT;
CREATE INDEX ix_media_pending ON media(status, updated_ts) WHERE status IN ('pending','failed');

-- doc_id ist KEIN Autoincrement: ts_ms*64 + seq, in der Anwendung vergeben.
-- Das ist der Unterschied zwischen 0,286 ms und 1155,9 ms.
CREATE TABLE search_docs (
  doc_id   INTEGER PRIMARY KEY,
  mid      INTEGER NOT NULL REFERENCES messages(mid) ON DELETE CASCADE,
  media_id INTEGER,
  chat_id  INTEGER NOT NULL,
  ts       INTEGER NOT NULL,
  source   TEXT NOT NULL CHECK (source IN ('body','ocr','asr','pdf','caption','filename')),
  text     TEXT NOT NULL
) STRICT;
CREATE INDEX ix_search_docs_mid ON search_docs(mid);
-- COALESCE, weil NULLs in einem UNIQUE-Index als verschieden gelten
CREATE UNIQUE INDEX ux_search_docs ON search_docs(mid, source, COALESCE(media_id,0));

CREATE VIRTUAL TABLE search_fts USING fts5(
  text,
  source        UNINDEXED,
  chat_id       UNINDEXED,
  content       = 'search_docs',
  content_rowid = 'doc_id',
  tokenize      = 'unicode61 remove_diacritics 2',
  detail        = 'full'
);

-- ===========================================================================
-- DIE DREI TRIGGER. Jede Abweichung korrumpiert den Index STILL.
-- 'delete' muss ALLE alten Spaltenwerte erneut liefern, auch UNINDEXED.
-- ===========================================================================
CREATE TRIGGER search_docs_ai AFTER INSERT ON search_docs BEGIN
  INSERT INTO search_fts(rowid, text, source, chat_id)
  VALUES (new.doc_id, new.text, new.source, new.chat_id);
END;

CREATE TRIGGER search_docs_ad AFTER DELETE ON search_docs BEGIN
  INSERT INTO search_fts(search_fts, rowid, text, source, chat_id)
  VALUES ('delete', old.doc_id, old.text, old.source, old.chat_id);
END;

CREATE TRIGGER search_docs_au AFTER UPDATE ON search_docs BEGIN
  INSERT INTO search_fts(search_fts, rowid, text, source, chat_id)
  VALUES ('delete', old.doc_id, old.text, old.source, old.chat_id);
  INSERT INTO search_fts(rowid, text, source, chat_id)
  VALUES (new.doc_id, new.text, new.source, new.chat_id);
END;
```

**Begleitregeln:**
- `PRAGMA recursive_triggers = ON` auf jeder Verbindung.
- `INSERT OR REPLACE` / `REPLACE INTO` auf `search_docs` im Code-Review **verbieten**. Stattdessen `ON CONFLICT(mid, source, COALESCE(media_id,0)) DO UPDATE` — in beiden Modi sicher.
- FK `ON DELETE CASCADE` feuert den Delete-Trigger korrekt, auch bei `rt=OFF`. **[VERIFIZIERT]**
- Health-Check: `INSERT INTO search_fts(search_fts, rank) VALUES('integrity-check', 1);` — ~6,1 s bei 5M **[RECON]**, gehört in den archive-Worker.
- Reparatur: `INSERT INTO search_fts(search_fts) VALUES('rebuild');`

### 4.5 Die zwei Query-Formen, die ausgeliefert werden

```sql
-- 1) RECENCY (Default) — 0,286 ms
SELECT d.mid, d.chat_id, d.ts, d.source,
       snippet(search_fts, 0, '<b>', '</b>', '…', 12) AS snip
  FROM search_fts
  JOIN search_docs d ON d.doc_id = search_fts.rowid
 WHERE search_fts MATCH :q
 ORDER BY search_fts.rowid DESC
 LIMIT 50;
-- Keyset-Fortsetzung:  AND search_fts.rowid < :after_doc_id

-- 2) BEST MATCH — Kandidatenfenster, DANN bm25. Nie über den Gesamtkorpus.
WITH cand AS (
  SELECT search_fts.rowid AS doc_id, bm25(search_fts, 1.0, 0.0, 0.0) AS r
    FROM search_fts
   WHERE search_fts MATCH :q
   ORDER BY search_fts.rowid DESC
   LIMIT 2000
)
SELECT d.mid, d.chat_id, d.ts, c.r
  FROM cand c JOIN search_docs d ON d.doc_id = c.doc_id
 ORDER BY c.r ASC          -- bm25 ist negativ, kleiner = besser
 LIMIT 50;
```

**Anti-Patterns (alle gemessen):** blankes `ORDER BY rank`; `ORDER BY d.ts DESC`; 1-Zeichen-Präfixe (UI erzwingt Minimum 3). Ein `rowid`-Bereichsfilter rettet `rank` **nicht** — die Recon maß 720 ms statt 696 ms. **[RECON]**

### 4.6 Keyset-Pagination

`(ts, mid)` ist ein totaler Ordnung (mid ist PK), also keine Duplikate und keine übersprungenen Zeilen über Seitengrenzen. SQLite läuft einen DESC-Index in beide Richtungen ohne Sortierschritt. **[RECON]** — plausibel und mit `ix_messages_chat_ts` konsistent.

```sql
-- älter (zurück in der Zeit); Cursor = LETZTE Zeile auf dem Schirm
SELECT mid, ts, sender_id, kind, body, from_me, revoked
  FROM messages
 WHERE chat_id = :chat_id AND (ts, mid) < (:cur_ts, :cur_mid)
 ORDER BY ts DESC, mid DESC LIMIT 50;
```

Cursor als `base64url("<ts>.<mid>")` übertragen und an der IPC-Grenze mit zod validieren. Niemals `OFFSET`.

### 4.7 Prozess-Topologie

- **Kein `Database`-Handle im Main-Prozess.** better-sqlite3 ist synchron, `SQLITE_THREADSAFE=2`, ohne Progress-Callback. Ein 500-Zeilen-Batch-Commit liegt bei 68 ms p50 **[RECON]** — dem Vierfachen des 16-ms-Budgets.
- Genau **ein** Writer (archive-Worker), N Read-Only-Verbindungen.
- `mmap_size` nur read-only (I/O-Fehler in gemappter Page = SIGBUS).
- Watchdog: `monitorEventLoopDelay({resolution: 10})`, Auflösung vom Messwert abziehen. **`performance.eventLoopUtilization()` ist im Main-Prozess unbrauchbar** (konstant Null, weil Chromiums Message Pump die Schleife treibt). **[RECON]**
- Snapshots via `VACUUM INTO` blockieren Writer nicht, **pinnen aber das WAL**: gemessen 1,4 GB Zuwachs in 15 s. **[RECON]** Ingest vorher pausieren, danach `wal_checkpoint(TRUNCATE)`.

---

## 5. Windows-Installer — die Analyse

### 5.1 Aufgelöster Widerspruch: `oneClick`

Report 1 empfahl `oneClick: false`, Report 2 `oneClick: true`. **Direkter Widerspruch.** Ich habe die NSIS-Quellen von `app-builder-lib@26.15.7` gelesen — **Report 2 gewinnt.** **[VERIFIZIERT]**

```js
// NsisTarget.js:444-452
if (options.perMachine === true)      { defines.INSTALL_MODE_PER_ALL_USERS = null }
if (!oneClick || options.perMachine === true) {
  defines.INSTALL_MODE_PER_ALL_USERS_REQUIRED = null    // <- greift bei oneClick:false IMMER
}
// NsisTarget.js:453-456
if (options.allowToChangeInstallationDirectory && oneClick) {
  throw new InvalidConfigurationError("… please set oneClick to false")
}
```

```nsis
; installer.nsi:20-28
!ifdef INSTALL_MODE_PER_ALL_USERS
  RequestExecutionLevel admin
!else
  RequestExecutionLevel user        ; <- bei perMachine:false
!endif

; assistedInstaller.nsh:18-20 — Radioseite wird bei perMachine:false EINKOMPILIERT
!ifndef INSTALL_MODE_PER_ALL_USERS
  !insertmacro PAGE_INSTALL_MODE
!endif
```

**Der entscheidende Punkt** — `UAC_RunElevated` steht in `multiUserUi.nsh` an den Zeilen 51, 79 und 155, und **die Zeilen 51 und 155 sind nicht durch `MULTIUSER_INSTALLMODE_ALLOW_ELEVATION` geschützt.** Nur Zeile 110 referenziert dieses Define. `allowElevation: false` entfernt den UAC-Pfad also **nicht**.

**Präzise Wahrheit:**
- `oneClick:false` + `perMachine:false` → Installer startet als `user` (kein erzwungenes UAC), **bietet aber** die Radioseite „für alle Benutzer" an, deren Handler `UAC_RunElevated` ruft.
- `oneClick:true` + `perMachine:false` → keine Radioseite, kein erreichbarer Elevationspfad.

Der Preis ist real und nicht verhandelbar: **`allowToChangeInstallationDirectory` und garantiertes No-UAC schließen sich gegenseitig aus.**

### 5.2 Konfigurationsblock

```yaml
# electron-builder.yml
appId: com.wawrap.app          # <- IDENTISCH mit app.setAppUserModelId()
productName: wawrap
directories: { output: release, buildResources: build }

# better-sqlite3 13 ist N-API mit Prebuilds. true lässt jeden Cross-Arch-Job HART scheitern.
npmRebuild: false

asar: true
asarUnpack:
  - '**/node_modules/better-sqlite3/prebuilds/**'   # Gürtel und Hosenträger

files:
  - out/**
  - package.json
  # 27 MB -> 3,9 MB. NUR die ungewollten Plattformen negieren.
  # NICHT '!prebuilds/**' + Re-Include (verifiziert: .node verschwindet komplett).
  # NICHT den ${platform}-Makro (verifiziert: expandiert zum BUILD-HOST).
  - '!node_modules/better-sqlite3/{deps,src,build,binding.gyp}/**'
  - '!node_modules/better-sqlite3/prebuilds/linux*'
  - '!node_modules/better-sqlite3/prebuilds/darwin*'

win:
  target: [{ target: nsis, arch: [x64] }]

nsis:
  oneClick: true            # MUSS true sein — siehe §5.1
  perMachine: false         # RequestExecutionLevel = user
  packElevateHelper: false  # entfernt resources/elevate.exe physisch
  allowElevation: false     # unter oneClick:true wirkungslos; als Absicherung setzen
  createStartMenuShortcut: true    # ERFORDERLICH für Windows-Toasts (trägt die AUMID)
  createDesktopShortcut: true
  runAfterFinish: true
  deleteAppDataOnUninstall: false  # niemals 200 GB Archiv löschen
  differentialPackage: true
  artifactName: '${productName}-${version}-win-${arch}-setup.${ext}'

mac:
  category: public.app-category.social-networking
  target:
    - { target: dmg, arch: [arm64, x64] }
    - { target: zip, arch: [arm64, x64] }   # zip ist für Auto-Update ZWINGEND
  minimumSystemVersion: '13.0'              # Electron 44 hat macOS 12 entfernt
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  identity: null            # deterministisch; v26 hat den Ad-hoc-Fallback entfernt
  notarize: false

publish:
  provider: github
  owner: <owner>
  repo: wawrap             # öffentliches Repo => kein Token im Binary
```

**Warum das nicht elevieren kann** (drei unabhängige Gründe):
1. `perMachine:false` → `RequestExecutionLevel user` im Manifest.
2. `oneClick:true` → keine Install-Mode-Radioseite, also kein `UAC_RunElevated`-Aufruf.
3. `packElevateHelper:false` → `resources/elevate.exe` existiert nicht; electron-updater hat schlicht keine Binärdatei zum Elevieren.

Zusätzlich: `isAdminRightsRequired` wird nur bei `isPerMachine` in die Update-Metadaten geschrieben (`NsisTarget.js:316`), sodass `NsisUpdater` seinen `callUsingElevation()`-Zweig nie nimmt.

> **Fallstrick:** `perMachine:true` **erzwingt** `packElevateHelper` wieder auf true (`nsisUtil.js:66-68`, mit Warnung). Deshalb die CI-Assertion in §9.

**Nicht abschaltbar:** `Setup.exe /allusers` erzwingt per-machine. Dokumentieren; die App kann beim Start prüfen, ob `process.execPath` unter `%LOCALAPPDATA%` liegt, und warnen (nicht blockieren).

### 5.3 Wohin geschrieben wird

| Pfad | Inhalt |
|---|---|
| `%LOCALAPPDATA%\Programs\wawrap\` | Programmdateien (`FOLDERID_UserProgramFiles`) |
| `%LOCALAPPDATA%\wawrap\` | Unsere Daten: `session`, `archive`, `blobs` |
| `%LOCALAPPDATA%\wawrap-updater\pending\` | Updater-Cache — **Geschwister**verzeichnis, nie in unseren Daten |
| `HKCU\Software\...\Uninstall\...` | Deinstallationseintrag |
| `%APPDATA%\...\Start Menu\Programs\wawrap.lnk` | ⚠️ **Roaming** — siehe §7 |

`updaterCacheDirName = sanitizedName.toLowerCase() + "-updater"` (`appInfo.js:126`) — die Trennung ist konstruktionsbedingt, nicht konfiguriert. **[RECON]**

---

## 6. Benachrichtigungen und der Roaming-Konflikt

### 6.1 Der Konflikt, aus der Quelle

```bash
# [VERIFIZIERT] — shell/browser/notifications/win/windows_toast_activator.cc @ v44.0.0
146: void EnsureCLSIDRegistry() {
152:   base::win::RegKey key(HKEY_CURRENT_USER, key_path.c_str(), KEY_SET_VALUE);
159:   base::win::RegKey server_key(HKEY_CURRENT_USER, local_server.c_str(), …);
227: void EnsureShortcut() {
239:   SHGetKnownFolderPath(FOLDERID_Programs, 0, nullptr, &programs_path)
248:   base::FilePath lnk_path = programs.Append(product_name + L".lnk");
294:   prop_store->SetValue(PKEY_AppUserModel_ID, pv_id);
302:   prop_store->SetValue(PKEY_AppUserModel_ToastActivatorCLSID, pv_clsid);
347:   EnsureShortcut(); EnsureCLSIDRegistry();
```

**Gute Nachricht:** Die Registry-Seite schreibt **ausschließlich `HKEY_CURRENT_USER`**. Kein HKLM, kein Dienst, keine Elevation. Das No-Admin-Constraint ist unberührt.

**Schlechte Nachricht:** `FOLDERID_Programs` = `%APPDATA%\Microsoft\Windows\Start Menu\Programs` = **Roaming-Profil**. Electron legt die Verknüpfung unaufgefordert beim ersten Notification-Presenter an — auch für Benachrichtigungen der Seite selbst. Ohne sie erscheinen **keine** Toasts; das ist eine Windows-Plattformvorgabe, keine Electron-Entscheidung ([notifications.md](https://www.electronjs.org/docs/latest/tutorial/notifications), **[VERIFIZIERT]**).

**Empfehlung:** Constraint präzisieren auf *keine Nutzdaten* außerhalb `%LOCALAPPDATA%`. Eine `.lnk` ist keine Nutzdatei, ist pro Benutzer und wird vom Uninstaller entfernt.

### 6.2 Direct Reply bricht Read-Only

Die Betriebssystemseite ist gelöst (`hasReply` = `@platform darwin,win32`, Bug seit 42 behoben). Blockiert ist allein die WhatsApp-Seite: **Antworten heißt senden.** Der Plan enthält beide Aussagen gleichzeitig. Empfehlung: für v1 streichen.

### 6.3 Umsetzungsregeln

- `app.setToastActivatorCLSID()` mit **fest einkompilierter GUID** vor `whenReady()`. Ohne Setter erzeugt Electron pro Lauf eine zufällige CLSID → Cold-Start-Aktivierung bricht.
- `appId` (electron-builder) === `app.setAppUserModelId()`. Abweichung = **stille** Toast-Fehlschläge, in Dev nicht reproduzierbar. Deshalb eine gemeinsame Konstante.
- `Notification.handleActivation()` ist der richtige Einstieg (Cold Start, Action Center, GC'te Objekte), nicht nur Instanz-Events.
- Für WhatsApps eigene Benachrichtigungen `window.Notification` in der Seite überschreiben und aus dem Main-Prozess rendern — nur so gibt es `id`/`groupId`-Coalescing und Kontrolle über stummgeschaltete Chats.
- **Unread-Count aus IndexedDB** (`model-storage` → `chat`), nicht aus `document.title`. Liefert `unreadCount`, `archive`, `muteExpiration`. **[RECON]** — das ist, was Ferdium heute ausliefert.
- Badge: `setOverlayIcon` (win32) / `setBadgeCount` (darwin). PNGs zur Build-Zeit vorrendern — `nativeImage` dekodiert **kein SVG** und liefert still ein leeres Bild.
- macOS: Benachrichtigungen **erfordern Code-Signing**; unsignierte Builds feuern `failed`. In CI kein Bug, sondern erwartet.

---

## 7. OCR / Whisper — kein Verdikt möglich

**Hier rate ich nicht.** Zu OCR und ASR wurde **kein Recon-Report geliefert**. Ich habe keine geprüften Aussagen zu Engines, Modellgrößen, Lizenzen oder Durchsatz.

Was sich aus den anderen Reports **ableiten** lässt:

- Das Schema trägt es bereits: `content_text(source ∈ ocr|asr|pdf|caption|filename, engine, engine_version)` plus ein `UNIQUE`-Index, der verhindert, dass ein Engine-Upgrade jede Zeile dupliziert. Leer kostet das praktisch nichts.
- **`.onnx`-Modelle fallen NICHT unter electron-builders Smart-Unpack.** Automatisch entpackt werden nur `.node`, `.dll`, `.exe`, `.dylib`, `.so` (`unpackDetector.js:10`, **[RECON]**, empirisch bestätigt). Modelle brauchen explizites `asarUnpack` oder besser `extraResources` (liegt dann außerhalb des asar und braucht kein Pfad-Rewriting).
- Ein etwaiges ffmpeg-Sidecar wäre eine **weitere unsignierte Binärdatei** mit demselben SmartScreen-Profil wie der Installer, plus eigenen Lizenzfragen. Der Verifier hat das zu Recht angemerkt.
- `detail_json` (Wortboxen) gehört in eine Seitentabelle — groß und nie abgefragt.

**Empfehlung:** Aus v1 streichen, Schema unverändert lassen. Vor jeder Zusage ein eigener Recon-Auftrag: Modellgrößen, Lizenzen (auch der Trainingsdaten), Installer-Zuwachs und CPU-Kosten pro Mediendatei bei 100k+ Dateien.

---

## 8. Bridge-Feasibility (Phase 3) — das ehrliche Verdikt

### 8.1 Was gesichert ist

**Der alte Weg ist tot.** `moduleRaid` ist seit 2021 unveröffentlicht, `window.Store` existiert nicht mehr.

```bash
# [VERIFIZIERT] — die Injektionsdateien sind weg
$ for f in Store.js LegacyStore.js ExposeStore.js Utils.js; do
    curl -so /dev/null -w "$f %{http_code}\n" \
    https://raw.githubusercontent.com/wwebjs/whatsapp-web.js/main/src/util/Injected/$f; done
Store.js 404   LegacyStore.js 404   ExposeStore.js 404   Utils.js 200
```

**Der neue Weg funktioniert.** WA Web liefert seit 2.3000 Metas Comet/Haste-Runtime mit echtem globalem `require(id)`, `__d`, `importNamespace(id)` und `require('__debug')().modulesMap`.

```bash
# [VERIFIZIERT] — starkes Indiz, dass `require` ein echtes WA-Global ist
$ curl -sS …/main/src/util/Injected/Utils.js | grep -cE 'window\.require\s*='
0        # wird NIRGENDS zugewiesen
$ curl -sS …/main/src/util/Injected/Utils.js | grep -oE "require\('WAWeb[A-Za-z]+'\)" | sort | uniq -c
37 require('WAWebCollections')     19 require('WAWebWidFactory')     …
```

Eine Bibliothek, die einen Bezeichner 37-mal aufruft und nie zuweist, setzt voraus, dass die Seite ihn bereitstellt.

**IndexedDB ist keine Alternative:** Nachrichtentexte liegen AES-CBC-verschlüsselt unter einem *non-extractable* CryptoKey. Es gibt nichts, was sich offline lesen ließe. **[RECON]**

### 8.2 Was niemand geprüft hat

```bash
# [VERIFIZIERT] — und das ist das Problem
$ curl -sS -o /dev/null -w "http=%{http_code}\n" -A '<Chrome UA>' https://web.whatsapp.com/
http=400
```

**Weder die drei Recon-Agenten noch ich konnten `web.whatsapp.com` laden.** Jede Aussage über `require`, `__d`, `modulesMap`, `window.Debug.VERSION` ist Inferenz aus Bibliotheks-Quellcode. Die Inferenz ist stark — aber sie ist **keine Beobachtung**, und sie sagt nichts darüber, ob eine clientseitige Prüfung nach dem Laden der App-Shell greift.

### 8.3 Die Wartungsrechnung — Korrektur an der Recon

Die Recon nannte „4–6 Builds/Tag". **Das ist zu niedrig.** Eigene Auszählung aus `wa-version`:

```
# [VERIFIZIERT] — Builds pro Tag, letzte 14 erfasste Tage
2026-08-17: 11   2026-08-22: 14   2026-08-27:  4
2026-08-18: 10   2026-08-23: 12   2026-08-28:  2
2026-08-19: 12   2026-08-24: 12   2026-08-29:  6
2026-08-20: 11   2026-08-25: 12   2026-08-30:  3 (Teiltag)
2026-08-21: 11   2026-08-26: 12
Mittel (ohne Teiltag): 9,92 · Maximum: 14
```

Noch anschaulicher: Die Recon meldete `2.3000.1046374537-alpha` als „aktuell". Dieser Build wurde um 06:33 UTC veröffentlicht — als ich prüfte, war bereits `2.3000.1046380673-alpha` (12:48 UTC) da. **Die „aktuelle" Version war binnen Stunden veraltet.**

Dazu: Im Juli 2026 wurde die Modell-Property `_serialized` in `$1` umbenannt und zwang beide Referenzbibliotheken zu Dual-Compat-Patches. **[RECON]**

### 8.4 Verdikt

> **Phase 3 ist technisch machbar, aber es ist kein Bauvorhaben — es ist eine Wette mit laufenden Kosten.**

**Dafür:** Zwei unabhängige, aktiv gepflegte Bibliotheken tun heute genau das gegen dasselbe Ziel. wa-js committet täglich (zuletzt 2026-08-27/28 **[VERIFIZIERT]**) und behandelt die progressive Modulregistrierung korrekt. Es gibt keinen Hinweis, dass der Store nach WASM gewandert ist. **[RECON]**

**Dagegen:**
1. Rund 10 Builds/Tag, ohne Ankündigung, mit umbenannten Feldern in minifiziertem Code.
2. Niemand hat die Live-Seite gesehen. Die größte Unbekannte ist ungeprüft.
3. Sperrrisiko: WhatsApps Policy sagt ausdrücklich, dass die Verknüpfung mit einer inoffiziellen App zur Sperre führen kann. Für Protokoll-Clients sind Warnwellen dokumentiert; für In-Page-Wrapper gibt es keine — was Abwesenheit von Evidenz ist, nicht Evidenz von Sicherheit. **[RECON]**
4. Kein Ausweichpfad: IndexedDB ist verschlüsselt.

**Empfohlenes Vorgehen:**

1. **Spike zuerst.** Ein Wegwerf-Electron-44-Shell, Login per QR, Dump der Capability-Matrix. Ein Tag. Ersetzt die größte Unbekannte durch Messwerte. Vor jeder Terminzusage.
2. **Phasen 0–2 bridge-unabhängig bauen.** Archiv, FTS5-Suche und UI müssen gegen lokale Daten vollwertig read-only funktionieren. Wenn die Bridge an einem beliebigen Dienstag bricht, will man ein Banner sehen, kein totes Produkt.
3. **Capability-Matrix statt Boolean.** Loader-Typ, Modulanzahl nach Settle, `VERSION_STR`, id-Shape (`_serialized` vs. `$1`), Auflösbarkeit von Chat/Msg/Contact, History-API, Medienpfad. Einzelne Features degradieren, nicht die App.
4. **Nie eine feste WA-Version pinnen.** Bei 10 Builds/Tag gibt es nichts zu pinnen.
5. **Nicht spoofen.** Kein `setDeviceName`-Override, kein erzwungenes `markAvailable()`. Spoofing macht aus einer legitim aussehenden Browsersitzung eine Fingerprint-Anomalie.

---

## 9. Lehren aus dem Stand der Technik

Aus `whatsapp-web.js` (1.34.7) und `wa-js` (4.6.0). **[RECON]**, außer wo markiert.

1. **Progressive Modulregistrierung ist der häufigste Fehler.** Ein zu früher Probe liefert `undefined` und pinnt den Getter dauerhaft, wenn gecacht wird — dokumentierte Ursache von wa-js #3419/#3481. Gegenmittel: Modulanzahl pollen, bis 750 ms Ruhe herrscht (Deckel 20 s), dann ein Canary-Modul. **Negative Treffer niemals cachen**, außer die Modulanzahl ist unverändert.
2. **Feste Modul-IDs sind eine Zeitbombe.** Zweistufig auflösen: Fast Path über bekannte IDs, Fallback über Duck-Typing-Scan der `modulesMap`.
3. **Jeder Feldzugriff ist versionsfragil.** Ein einziger Accessor (`sid(key) => key._serialized ?? key.$1 ?? …`) statt 200 Aufrufstellen. Genau das war die Juli-2026-Bruchstelle.
4. **Chats öffnen ist NICHT read-only.** Ein Chat aktiv zu machen markiert ihn als gelesen und sendet Lesebestätigungen. Backfill darf `Cmd.openChatAt`/`openChatBottom` nie aufrufen — `loadEarlierMsgs` bzw. `msgFindByDirection` paginieren ohne Aktivierung. Als Lint-Regel absichern.
5. **Listener lecken.** WA Web ist eine SPA und re-initialisiert seinen Store ohne Navigation. Registrierte Listener in einem Array halten und vor jeder Neuregistrierung abmelden.
6. **Widerrufe und Reaktionen sind keine Collection-Events** — beide brauchen Monkey-Patches in WhatsApps Hot Path. Handler-Rumpf: flach kopieren, `queueMicrotask`, `try/catch`, in **jedem** Pfad das Original aufrufen. Ein Throw dort friert WhatsApps UI ein.
7. **Base64 über IPC ist bei 200 GB falsch.** Blob → `ReadableStream` → transferierbare `ArrayBuffer`-Chunks → utilityProcess schreibt auf Platte. Der Main-Prozess berührt nie Medien-Bytes.
8. **`wa-js` ist die bessere Referenz:** Apache-2.0, **null** Runtime-Dependencies, ein Browser-Bundle — kein Puppeteer. `whatsapp-web.js` zieht Puppeteer und ist nur zum Lesen tauglich.
9. **Live-Smoke-Test als Frühwarnsystem.** wa-js lädt `web.whatsapp.com` unauthentifiziert (Module lösen vor dem Login auf) und prüft alle Module. Das verschafft Stunden bis Tage Vorlauf statt eines Nutzer-Bugreports.

---

## 10. Risikoregister

| # | Risiko | Sev | Gegenmaßnahme | Status |
|---|---|---|---|---|
| R1 | FTS5 desynchronisiert still; `integrity-check` meldet fälschlich OK | **Hoch** | Exakte Trigger, `recursive_triggers=ON`, `REPLACE` verboten, nächtlicher Check mit `rank=1` + Auto-`rebuild` | **[VERIFIZIERT]**, gelöst |
| R2 | Suche verfehlt p95 < 200 ms um Faktor 4000 | **Hoch** | Monotone `doc_id`, `ORDER BY rowid DESC`, bm25 nur im 2000er-Fenster, 3-Zeichen-Minimum | **[VERIFIZIERT]**, gelöst |
| R3 | `setPath` nach `ready` scheitert **still**; Session schreibt weiter ins Roaming-Profil | **Hoch** | Pre-Ready-Block + Startup-Assertion gegen `getStoragePath()` | **[RECON]**, gelöst |
| R4 | Main-Prozess blockiert > 16 ms durch DB-Zugriff | **Hoch** | Kein DB-Handle im Main; Watchdog via `monitorEventLoopDelay` | Gelöst |
| R5 | `oneClick:false` führt UAC-Pfad wieder ein | **Hoch** | `oneClick:true`; CI-Assertion auf die drei Flags | **[VERIFIZIERT]**, gelöst |
| R6 | `npmRebuild` an → jeder Cross-Arch-Job scheitert | **Hoch** | `npmRebuild: false` | **[RECON]**, gelöst |
| R7 | Bridge bricht durch WA-Update (~10 Builds/Tag) | **Hoch** | Capability-Matrix, Duck-Typing, id-Accessor, Live-Smoke-Test in CI; Phasen 0–2 bridge-unabhängig | Gemindert, nie gelöst |
| R8 | Konto-Sperre durch inoffiziellen Client | **Hoch** | Strikt read-only, kein Spoofing, gedrosselter Backfill mit Jitter, Nutzeraufklärung beim ersten Start | Gemindert, nicht eliminierbar |
| R9 | Windows-Toasts brauchen Roaming-`.lnk` | **Hoch** | Constraint präzisieren (§6.1) — sonst kein Feature | **[VERIFIZIERT]**, Eigentümerentscheidung |
| R10 | Direct Reply bricht Read-Only | **Hoch** | Für v1 streichen | Eigentümerentscheidung |
| R11 | Medien-Pipeline sprengt den Speicher bei 200 GB | **Hoch** | Blob-Streaming mit transferierbaren Chunks, begrenzte Nebenläufigkeit, Backpressure | **[RECON]**, geplant |
| R12 | `clipboard` im Renderer entfernt → Laufzeitbruch | **Hoch** | Über Main + IPC; vor Release nach `clipboard` greppen | **[VERIFIZIERT]**, gelöst |
| R13 | **NEU:** Unsignierter Installer → SmartScreen beim Erststart | Mittel | Kein UAC-Prompt und kein Blocker, aber es sieht wie eine Warnung aus. Authenticode einplanen, wenn wawrap Dritte erreicht | **Vom Verifier ergänzt** — in allen Recon-Reports übersehen |
| R14 | **NEU:** AppLocker/SRP verbietet Ausführung aus `%LOCALAPPDATA%` | Mittel | App-seitig **nicht** lösbar. Geltungsbereich auf unverwaltete Consumer-Systeme festschreiben; für verwaltete Flotten als Einschränkung dokumentieren. **Nicht umgehen versuchen.** | **Vom Verifier ergänzt** |
| R15 | **NEU:** Aktionsfähige Toasts brauchen COM-Aktivator (getrennt von der AUMID) | Niedrig | Für einfache Toasts genügt die AUMID. Für Action-Buttons: HKCU-CLSID + `INotificationActivationCallback` — weiterhin ohne Admin, aber Mehrarbeit | **Vom Verifier ergänzt** |
| R16 | Überlebender utilityProcess hält WAL → Update scheitert | Mittel | `shutdownWorkers()` mit Timeout vor `quitAndInstall()` | **[RECON]**, geplant |
| R17 | `VACUUM INTO` während Ingest lässt WAL um GB wachsen | Mittel | Ingest pausieren, `journal_size_limit`, Plattenplatz prüfen, danach `wal_checkpoint(TRUNCATE)` | **[RECON]**, geplant |
| R18 | `appId` ≠ AUMID → Toasts scheitern **still** | Mittel | Eine gemeinsame Konstante; Smoke-Test auf echtem Windows | Gelöst |
| R19 | Sec-CH-UA verrät den UA-Spoof | Mittel | Spoof minimal und kohärent halten; OS nie fälschen | Akzeptiert |
| R20 | macOS-Autostart/Toasts scheitern unsigniert still | Mittel | Nicht ausliefern, bis Notarisierung in CI ist. In Dev erwartetes Verhalten, kein Bug | Dokumentiert |
| R21 | `_serialized` → `$1`-artige Umbenennungen füllen das Archiv mit NULLs | **Hoch** | Ein id-Accessor; zod-Validierung weist Zeilen ohne id ab, statt sie zu schreiben; Ingest stoppen und Banner zeigen | **[RECON]**, geplant |

---

## 11. Ungeklärt

| Frage | Warum offen | Billigste Klärung |
|---|---|---|
| Verhalten der Live-WA-Seite (`require`, `__d`, `modulesMap`) | HTTP 400 aus jeder Sandbox — niemand konnte laden | **Der Spike.** Ein Tag, ersetzt alles durch Messwerte |
| Braucht Win11 24H2 noch die Start-Menü-Verknüpfung für einfache Toasts? | Electrons Doku sagt ja; keine autoritative 2026-Quelle gefunden | Auf einer echten Win11-Maschine testen, bevor Toasts zugesagt werden |
| Läuft der Installer wirklich ohne UAC? | Kein Wine in der Sandbox; Beleg ist Quellcode + Abwesenheit von `elevate.exe` | Einmal auf einem echten Windows-Standardkonto ausführen |
| Ist explizites `asarUnpack` für better-sqlite3 nötig? | Report 2 zeigte empirisch, dass Smart-Unpack reicht; Reports 1 und 3 verlangen es explizit | Kostenlos: beides tun. Explizites `asarUnpack` schadet nicht, CI-Smoke-Test entscheidet |
| Windows-Toast-Zustellung, AUMID-Match | Keine Windows-Maschine in der Recon verfügbar | Smoke-Test auf echter Installation, der eine Notification feuert und `show` prüft |
| FTS5-Verhalten der win32/darwin-Prebuilds | Nur linux-x64 ausgeführt; gleiche `defines.gypi`, also per Konstruktion identisch | CI-Smoke-Test auf allen drei Zielen |
| OCR/ASR insgesamt | **Kein Report geliefert** | Eigener Recon-Auftrag (§7) |

---

## 12. Quellen

**Selbst ausgeführt am 2026-08-30:** `npm view` für alle gepinnten Pakete; `npm install better-sqlite3@13.0.3`; FTS5-Korrektheitsmatrix und 1,5-Mio.-Zeilen-Benchmark; `npm pack electron@44.0.0` + Grep über `electron.d.ts`; `npm pack app-builder-lib@26.15.7` + Lesen der NSIS-Templates und `NsisTarget.js`; `curl` gegen `windows_toast_activator.cc` und `windows_toast_notification.cc` (v41/v42/v44); `curl` gegen `web.whatsapp.com` (HTTP 400); Auszählung von `wa-version/versions.json`; ERESOLVE-Test electron-vite × vite.

**Dokumentation:** [electron-timelines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines) · [releases.electronjs.org/schedule](https://releases.electronjs.org/schedule) · [breaking-changes](https://www.electronjs.org/docs/latest/breaking-changes) · [notifications](https://www.electronjs.org/docs/latest/tutorial/notifications) · [app](https://www.electronjs.org/docs/latest/api/app) · [native-image](https://www.electronjs.org/docs/latest/api/native-image) · [sqlite.org/fts5](https://sqlite.org/fts5.html) · [sqlite.org/lang_vacuum](https://sqlite.org/lang_vacuum.html)

**Quellcode:** `electron/electron` @ v44.0.0 · `app-builder-lib` 26.15.7 (npm-Tarball) · `wppconnect-team/wa-js` main · `wwebjs/whatsapp-web.js` main · `ferdium/ferdium-recipes` whatsapp

---

*Ende. Änderungen an §4.4 (DDL), §5.2 (Installer) und §3 (Electron-Pin) bitte nur mit erneuter Messung — jede Zeile darin geht auf ein reproduziertes Ergebnis zurück.*