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

---

## 13. Benachrichtigungen, Tray und Badge

*(Roaming-`.lnk`-Zwang und der Read-Only-Konflikt bei Direct Reply stehen bereits in §6 — hier nur, was dort fehlt.)*

### 13.1 WhatsApps eigene Notifications abfangen: Override vs. Chromium rendern lassen

Zwei Wege, keine dritte Option:

| | **(a) Chromium rendern lassen** | **(b) `window.Notification` überschreiben** |
|---|---|---|
| Aufwand | keiner — WhatsApps `new Notification(...)` läuft nativ | Preload-Shim + IPC-Bridge |
| `hasReply`, `id`/`groupId`-Coalescing | nicht erreichbar — Chromium kennt Electrons Notification-Konstruktoroptionen nicht | voll nutzbar |
| Stummschaltung pro Chat | nicht steuerbar | steuerbar (Payload läuft durch Main) |
| Klick öffnet den richtigen Chat | Chromium routet auf Fenster-Fokus, „den man nicht zuverlässig in ein Window-Raise verwandeln kann" | WhatsApps eigener `onclick`-Handler wird aufgerufen → öffnet den Chat korrekt |
| Bruchrisiko | keins | wenn WhatsApp `window.Notification` vor der Preload-Injektion selbst kapert oder per `toString()`-Feature-Detection prüft, verstummen Benachrichtigungen **ohne Fehler** |

**Empfehlung: (b).** Injektion über `webFrame.executeJavaScript()` am Preload-Top-Level (world 0 = Main World der Seite) — das läuft garantiert vor jedem Seiten-Script, was zählt, weil WhatsApp `window.Notification` beim Bundle-Eval erfasst (**[VERIFIZIERT]**, `docs/api/web-frame.md@44.0.0` Z.148–183). `contextBridge.executeInMainWorld` wäre die sauberere API, ist in 44 aber **_Experimental_** — nicht darauf bauen.

```javascript
// preload/notification-shim.js — als String in world 0 injiziert
(() => {
  const live = new Map(); let seq = 0;
  const send = (name, detail) =>
    document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(detail) }));
  // WhatsApp liefert icon als blob:-URL, die der Main-Prozess nicht auflösen kann —
  // hier im Main World zu einer data:-URL wandeln.
  const toDataUrl = async (url) => {
    if (!url?.startsWith('blob:')) return url ?? '';
    const blob = await (await fetch(url)).blob();
    return new Promise((res) => { const fr = new FileReader();
      fr.onload = () => res(String(fr.result)); fr.onerror = () => res(''); fr.readAsDataURL(blob) });
  };
  class WrappedNotification extends EventTarget {
    static get permission () { return 'granted' }
    static requestPermission (cb) { cb?.('granted'); return Promise.resolve('granted') }
    constructor (title, options = {}) {
      super();
      this.onclick = null; this.onclose = null;
      this._id = `p${++seq}`; live.set(this._id, this);
      void toDataUrl(options.icon).then((iconDataUrl) =>
        send('wawrap:notif-show', { id: this._id, title: String(title), body: options.body ?? '', iconDataUrl }));
    }
    close () { live.delete(this._id); send('wawrap:notif-close', { id: this._id }) }
  }
  document.addEventListener('wawrap:notif-event', (e) => {
    const { id, type } = JSON.parse(e.detail); const n = live.get(id); if (!n) return;
    // WICHTIG: WhatsApps eigenen Handler aufrufen — das öffnet den Chat, nicht nur ein DOM-Event.
    if (type === 'click' && typeof n.onclick === 'function') n.onclick.call(n, new Event('click'));
  });
  Object.defineProperty(window, 'Notification', { value: WrappedNotification, configurable: true, writable: true });
})();
```

**Nachteile von (b), offen benennen:**

- Fragil gegen WhatsApp-Änderungen — kein Fehler beim Bruch, nur Stille. Gegenmittel: nach Injektion `window.Notification === WrappedNotification` prüfen und einen Watchdog betreiben (kein Toast seit N Minuten trotz steigendem Unread-Count → Diagnose-Log).
- Muss die volle Surface nachbilden (`permission`, `requestPermission`, `maxActions`, `close()`, `onclick`/`onclose`/`onerror`/`onshow`, `EventTarget`) — jede vergessene Eigenschaft ist ein potenzieller stiller Bruch.
- `CustomEvent.detail` muss als JSON-*String* laufen, nicht als Objekt — Strings kopieren zuverlässig über die Isolated-World-Grenze, beliebige Objekte sind Wrapper-abhängig; die Objekt-Variante wurde nicht getestet (**[UNGEKLÄRT]**).
- Als Netz: zusätzlich `session.setPermissionRequestHandler`/`setPermissionCheckHandler` für `'notifications'` auf dem WhatsApp-Origin auf **deny** setzen, damit Chromium nie parallel eine native Toast rendert, falls der Shim auf irgendeinem Codepfad umgangen wird.

Der hardcodierte englische „Reply"-Button-Text in Electrons C++-Toast-Builder (`// TODO(codebytere): we should localize this.`) ist nur relevant, falls Direct Reply doch kommt — bei „für v1 gestrichen" (§6.2) irrelevant.

### 13.2 Unread-Badge: Quelle, Parsing, Fehlermodi

**Primärquelle: IndexedDB, nicht `document.title`.** Ferdium (aktiv gepflegt, WhatsApp-Rezept zuletzt 2026-08-20) liest `indexedDB.open('model-storage')` → Objectstore `chat`, summiert `chat.unreadCount` über `!chat.archive`, getrennt nach `chat.muteExpiration !== 0 || chat.isAutoMuted` (**[RECON]**, Quelle: `ferdium-recipes/recipes/whatsapp/webview.js`, HTTP 200 am 2026-08-30). Das läuft im isolierten Preload-World ohne Main-World-Injektion, weil Storage originbasiert geteilt wird:

```typescript
export async function readUnread(): Promise<{ unread: number; mutedUnread: number; chats: number }> {
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('model-storage');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const rows: any[] = await new Promise((res, rej) => {
    const q = db.transaction('chat', 'readonly').objectStore('chat').getAll();
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  let unread = 0, mutedUnread = 0, chats = 0;
  for (const c of rows) {
    if (!(c.unreadCount > 0) || c.archive) continue;
    chats++;
    if (c.muteExpiration !== 0 || c.isAutoMuted) mutedUnread += c.unreadCount; else unread += c.unreadCount;
  }
  return { unread, mutedUnread, chats };
}
```

**Fehlermodi und Fallback:** Das Schema ist unversioniert und WhatsApps privates Interna — kann sich ohne Ankündigung ändern. Muster: beim ersten Zugriff einen Schema-Probe fahren (erwartete Felder vorhanden?), bei Fehlschlag auf `document.title`-Parsing zurückfallen und eine Warnung loggen — niemals den Main-Prozess crashen oder den Badge auf einem veralteten Wert einfrieren lassen. Titel-Parsing-Muster: `/^\((\d+)\)/` auf `document.title`, gebunden an einen `MutationObserver` auf `document.querySelector('title')`; alles andere als 0 behandeln. **[UNGEKLÄRT]**, was genau der Titel zählt — der Report konnte `web.whatsapp.com` nicht live laden (HTTP 400 aus der Sandbox, wie schon in §8.2 dokumentiert) und konnte drei Dinge nicht klären: ob `N` Nachrichten oder Chats zählt, ob stummgeschaltete Chats mitgezählt werden, ob der Basisstring je lokalisiert wird. Titel-Parsing bleibt deshalb **sekundäres, korrigierendes** Signal hinter einem Feature-Flag, nie die alleinige Quelle. Aria-Labels der Chatliste („3 unread messages") sind lokalisiert und sitzen auf obfuskierten Klassennamen — als Badge-Quelle in keiner Konfidenzstufe empfohlen. Diagnose-Pane sollte anzeigen, welcher Pfad aktiv ist: `unread count source: indexeddb | title | unavailable`.

### 13.3 Badge-Bild: `setOverlayIcon` (Windows) vs. `setBadgeCount` (macOS)

`app.setBadgeCount()` ist **_Linux_ _macOS_ only** (**[VERIFIZIERT]**, `docs/api/app.md@44.0.0` Z.1412) — auf Windows gibt es keinen Cross-Platform-Badge, sondern `win.setOverlayIcon(nativeImage, description)`, ein 16×16-Overlay auf dem Taskleisten-Button.

**Wie das Zahlenbild ohne zweiten Renderer entsteht:** `nativeImage` dekodiert ausschließlich PNG/JPEG (+ ICO von einem Dateipfad auf Windows) — kein SVG. Eine SVG-Data-URL liefert **kein Error, sondern still ein leeres Bild** (Inferenz aus der dokumentierten PNG/JPEG-Beschränkung plus `isEmpty()`, **nicht ausgeführt** — **[UNGEKLÄRT]**, aber die Empfehlung umgeht die Frage ohnehin). Konsequenz: Ziffern-PNGs **zur Build-Zeit vorrendern** — `badge-1.png` … `badge-9.png` plus `badge-9plus.png`, je mit `@2x`-Variante für HiDPI — und mit `nativeImage.createFromPath()` laden. Kein Canvas, kein zweiter Renderer, kein Laufzeit-Rasterizing nötig:

```typescript
const BADGE_DIR = path.join(process.resourcesPath, 'badges');
function badgeImage(n: number): Electron.NativeImage | null {
  if (n <= 0) return null;
  const key = n > 9 ? '9plus' : String(n);
  const img = nativeImage.createFromPath(path.join(BADGE_DIR, `badge-${key}.png`)); // holt @2x automatisch
  return img.isEmpty() ? null : img;
}
function applyBadge(win: BrowserWindow | null, count: number): void {
  if (process.platform === 'win32') {
    win?.setOverlayIcon(badgeImage(count), count > 0 ? `${count} ungelesen` : '');
  } else {
    app.setBadgeCount(count); // 0 löscht; NICHT auf Windows aufrufen, dort ohne Wirkung
  }
}
```

**Fehlermodus:** Das Overlay hängt am Taskleisten-*Button*. Ist das Fenster in den Tray versteckt, gibt es keinen Button — der Badge verschwindet still, genau dann, wenn er am wichtigsten wäre. Zusätzlich hängt es an der Windows-11-Einstellung „Badges auf Taskleisten-Apps anzeigen". Gegenmittel: Count immer zusätzlich in `tray.setToolTip()` spiegeln und, wenn eine sichtbare Zahl bei versteckt gefahren werden soll, das Tray-Icon selbst zwischen vorgerenderten Varianten tauschen — das Overlay ist ein Nice-to-have, nicht die primäre Anzeige.

### 13.4 Tray-Icon, Autostart, globale Shortcuts

**Tray-Icon-Formate pro OS** (**[VERIFIZIERT]**, `docs/api/tray.md@44.0.0` „Platform Considerations"): macOS erwartet Template Images — Dateiname endet auf `Template` (`trayTemplate.png` + `trayTemplate@2x.png`, 16×16 @72dpi / 32×32 @144dpi); das OS invertiert sie automatisch für hellen/dunklen Menüleisten-Hintergrund — **keinen eigenen Dark-Mode-Swap bauen**. Windows empfiehlt ICO (mehrere Größen: 16/20/24/32). Event-/Methodenoberfläche unterscheidet sich: `middle-click` ist Windows-only, `setIgnoreDoubleClickEvents`/`setPressedImage` sind macOS-only.

**Autostart ohne Adminrechte:** `app.setLoginItemSettings` schreibt auf Windows **ausschließlich** `HKEY_CURRENT_USER\...\Run` und `...\Explorer\StartupApproved\Run` (letzteres das Task-Manager-Freigabe-Flag) — HKLM wird nur gelesen, nie geschrieben (**[VERIFIZIERT]**, `shell/browser/browser_win.cc@44.0.0` Z.60–741). **Breaking Change in 44:** die Option `openAsHidden` wurde entfernt (`electron/electron#52351`; in 42/43 noch vorhanden, in 44 `grep -c openAsHidden` → 0). Ersatz: `args: ['--hidden']` beim Setzen und `process.argv.includes('--hidden')` selbst prüfen; beim Rücklesen **dieselben** `args` an `getLoginItemSettings()` übergeben, sonst meldet `openAtLogin` fälschlich `false`. macOS läuft über `SMAppService` und **braucht Code-Signing** — bei unsignierten Builds schlägt `openAtLogin` **still** fehl; `getLoginItemSettings().status` kann `'requires-approval'` liefern (Nutzer muss in Systemeinstellungen bestätigen) — UI entsprechend gaten, Toggle in unsignierten Dev-Builds deaktiviert lassen.

**Globale Shortcuts:** `globalShortcut.register()` liefert `boolean` zurück — `false`, wenn das OS die Kombination bereits vergeben hat; funktioniert erst nach `app.whenReady()`; **immer** `globalShortcut.unregisterAll()` in `will-quit`. Rückgabewert prüfen und im UI klar sagen „diese Kombination ist belegt" statt still zu scheitern; Default auf eine Drei-Tasten-Kombination legen (`CommandOrControl+Shift+W`), Zwei-Tasten-Defaults kollidieren häufiger.

### 13.5 Bündelung: ein Toast pro Chat, 3-Sekunden-Fenster

Electron 44 bringt die dafür nötige Identität mit: `id` → Windows-Toast-Tag / macOS-`UNNotificationRequest`-Identifier; `groupId` → Windows-Group / macOS-`threadIdentifier`; `groupTitle` → Windows-`<header>`. **Erneutes Zeigen mit derselben `id` ersetzt den lebenden Toast in place** (**[VERIFIZIERT]**, `electron.d.ts@44.0.0` + `windows_toast_notification.cc GetToastXml()`).

Coalescing-Logik: erste Nachricht eines Chats sofort zeigen (sofortiges Feedback); weitere Nachrichten desselben Chats innerhalb von 3 s einsammeln, nicht neu toasten; nach Ablauf des Fensters mit **gleicher `id`/`groupId`** und zusammengefasstem Text neu zeigen. Sichtbare Toasts auf ~3 gleichzeitig deckeln (kein Plattform-Konstante — Produktentscheidung, **[UNGEKLÄRT]** ob Windows dokumentiert ein hartes Limit hat), Überlauf in einen „N Nachrichten in M Chats"-Sammel-Toast falten. `id`s dürfen weder `&` noch `=` enthalten — Electron parst die Aktivierungs-Argumente durch Split auf `&` dann `=`; ein `id` mit einem dieser Zeichen lässt den Tag-Lookup **ohne Fehler** ins Leere laufen (bare `return`). Base64-`id`s deshalb meiden (`=`-Padding).

---

## 14. OCR-Engine

### 14.1 Verdikt

| Paket | Version | Veröffentlicht | Lizenz | Downloads/Monat | Status |
|---|---|---|---|---|---|
| **ppu-paddle-ocr** (empfohlen) | 6.4.3 | 2026-08-27 | MIT | 55.141 (15.983/Woche, beschleunigend) | aktiv, einziger gepflegter Node-fähiger PP-OCR-Port |
| onnxruntime-node (Runtime darunter) | 1.29.0 | 2026-08-24 | MIT | — | N-API, kein Electron-Rebuild |
| @paddlejs-models/ocr | 1.2.4 | 2023-11-16 | ISC | — | tot, Browser/WebGL, PP-OCRv2-Ära |
| @gutenye/ocr-node | 1.4.8 | 2024-12-13 | — | — | 20 Monate ohne Release |
| paddleocr (npm) | 1.2.0 | 2026-07-03 | MIT | 6.398 | PP-OCRv5, geringe Nutzung |
| client-side-ocr | 2.1.0 | 2025-07-29 | — | 456 | geringe Nutzung |
| paddleocr.js / rapidocr-onnxruntime | — | — | — | — | existieren nicht auf npm (E404) |
| tesseract.js (Fallback, nicht Primär) | 7.0.0 | 2025-12-15 | Apache-2.0 | — | s. u. — gemessen unzuverlässig ohne Preprocessing |
| OS-nativ (Windows.Media.Ocr / Apple Vision) | — | — | — | — | abgelehnt (s. u.) |

**Modellgrößen (PP-OCRv6, Apache-2.0, redistributionsfähig):**

| Datei | Bytes | SHA-256 (= HF-LFS-`oid`) |
|---|---|---|
| PP-OCRv6_tiny_det.ort | 1.882.568 | `2816e82d26a09d6af722492f80f3059d458377c084eca88f34d84ddf9b385580` |
| PP-OCRv6_tiny_rec.ort | 4.530.048 | `efc46adf1bde1e05b58748268abb0e71791bfa8616c435676bbca13d1ea47767` |
| ppocrv6_tiny_dict.txt | 27.157 | (nicht LFS — eigenen Hash beim Vendoring festhalten) |
| **tiny gesamt** | **6.439.773 (≈6,44 MB)** | Standard-Empfehlung |
| PP-OCRv6_small_det.ort | 9.982.352 | `c21be8d8268f0f45e2693b1d52432a290a56d008f6c1ff28b4baa7c35bab250e` |
| PP-OCRv6_small_rec.ort | 21.290.816 | `40bccd9fa3ae2d14d724bf9d020c8f0edfc801489477b92f7449162a538366df` |
| **small gesamt** | **≈31,3 MB** | optionaler Zweitpass bei niedriger Konfidenz |

Modelle liegen apache-2.0-lizenziert auf einem **persönlichen** HF-Konto (`snowfluke/ppu-paddle-ocr-models`, 0 Likes, 0 erfasste Downloads) — Bus-Factor-Risiko, kein Lizenzrisiko. **Empfehlung:** auf ein eigenes GitHub Release spiegeln (Apache-2.0 erlaubt das ausdrücklich), HF-Revision-SHA statt `/main` pinnen (`bf1d5edb0335d3262be7caf13f766ba274b4cadd`, Stand 2026-08-25), SHA-256 bei jedem Download verifizieren.

**Gemessen** (**[VERIFIZIERT]**, eigener Testlauf des Reports, synthetischer 1600×900-WhatsApp-Dark-Mode-Screenshot, 6 Sprechblasen): PP-OCRv6_tiny liest 6/6 Zeilen, Konfidenz 0,983, 100 % Recall, 361 ms Median (Einzelbild), 273 ms/Bild im Batch (4-Core Xeon 2,8 GHz, `intraOpNumThreads=0`, `concurrency=1`) → 20.000-Bilder-Backlog ≈ 91 Min. dort, extrapoliert 35–60 Min. auf einem 2024er-Achtkerner (**nicht gemessen**). tesseract.js las **unpreprocessed nur 3/6 Zeilen** bei selbstgemeldeter Konfidenz 94 — jede kontrastarme grüne Outgoing-Bubble (`#005c4b`) fiel weg, ein stiller, überzeugt wirkender 50-%-Inhaltsverlust. Mit obligatorischem Graustufen+Invert+Kontrast-Pass erreicht tesseract 6/6 bei Konfidenz 95, verwechselt aber weiterhin zweimal „I" mit „|". Konfidenz ist ein brauchbares Qualitäts-Gate: saubere Bilder 0,98–0,99, degradierte 0,54–0,66 — Schwelle ~0,75 trennt sauber (**[RECON]**, Confidence „medium" im Quellreport).

OS-native OCR (`Windows.Media.Ocr`, Apple Vision `VNRecognizeTextRequest`) wurde **bewusst nicht** gewählt: die einzigen Node-Brücken für Windows.Media.Ocr (`@nodert-win11/windows.media.ocr` u. ä.) sind ~3 Jahre unveröffentlicht, nicht N-API — würde das Pro-Electron-ABI-Rebuild-Problem wieder einführen, das der PP-OCR-Weg gerade vermeidet. Apple Vision ist exzellent, aber nur über ein zweites Toolchain (Swift-Sidecar, signiert/notarisiert) erreichbar.

### 14.2 Was der Spike aus PLAN.md §10 Punkt 7 noch messen muss

Der Report ist explizit, was er **nicht** beantwortet hat:

1. **Reale WhatsApp-Screenshots statt synthetischer Renderings** — Emoji, Sticker, echte Schriftarten, Zitat-Blöcke, Zeitstempel, gemischtes RTL/LTR. Die 100-%-Recall-Zahl „wird den Kontakt mit einem echten Korpus nicht unverändert überstehen".
2. **Reale Telefonfotos, 50–100 Stück.** Die synthetische Degradation (0,85-Downscale-Blur + JPEG q0,8 + 2,5°-Kippung + Vignette) hat Glyphen an der Quelle zerstört — die gemessenen Foto-Werte (tiny: Konf. 0,616/6,9 % Recall) sind **nicht verwendbar** für eine DoD.
3. **Windows- und macOS-Timing** — alle Zahlen liefen auf einem 4-Core-Linux-Xeon; Windows wird abweichen, macOS arm64 vermutlich deutlich schneller.
4. **Genauigkeitsunterschied `processing.engine: 'opencv'` vs. `'canvas-native'`** — alle Läufe nutzten den 15-MB-`@techstark/opencv-js`-Wasm-Default; die schlankere Canvas-Variante wurde nie auf Genauigkeit geprüft.
5. **macOS-x64-ORT-Pin (1.23.2) tatsächlich validieren** — `onnxruntime-node` liefert seit 1.24.1 kein `darwin-x64`-Prebuild mehr (das README behauptet weiterhin Support und ist falsch); der Downgrade-Pin wurde nur aus Tarball-Listings abgeleitet, nie auf echtem Intel-Mac ausgeführt.
6. **`%LOCALAPPDATA%\wawrap\models`-Pfad auf echtem Windows** — nur mit absoluten Pfaden unter Linux getestet; `path.sep`/`path.join`-Nutzung sieht korrekt aus, ist aber ungetestet.
7. **Bus-Factor von `ppu-paddle-ocr` manuell prüfen** — die GitHub-API war in der Recon-Sandbox auf `phish3144/watis` beschränkt; Release-Kadenz (62 Versionen in 15 Monaten, vier allein im August 2026) ist bekannt, Issue-Backlog/Contributor-Zahl nicht.
8. **`asarUnpack` + `utilityProcess` + electron-vite-Externals in echtem Electron smoke-testen** — der N-API-Befund ist aus Binärevidenz solide (`bin/napi-v6`, `napi_versions:[6]`), die Kombination lief nie in einem echten `utilityProcess`.

### 14.3 Bildvorverarbeitung: sharp vs. jimp vs. @napi-rs/canvas

**Gemessen** (Decode + Resize-auf-1600 + Graustufen, 2560×1440-JPEG, **[RECON]**, Confidence „medium" — sharp lief über den langsameren `.raw().toBuffer()`-Pfad, was das Ergebnis zu seinen Ungunsten verzerren kann): `@napi-rs/canvas` 62,8 ms Median, `sharp` 193,7 ms, `jimp` 684,8 ms — jimp ist bei 20.000 Bildern disqualifizierend (~11× langsamer als canvas).

**Für den PP-OCR-Pfad wird keine zusätzliche Abhängigkeit gebraucht.** `ppu-paddle-ocr` nimmt kodierte Bild-Bytes (PNG/JPEG-`ArrayBuffer`) direkt entgegen und dekodiert/skaliert intern über `ppu-ocv`, das transitiv `@napi-rs/canvas 1.0.8` (MIT) zieht — das deckt, anders als `onnxruntime-node`, **alle** Zielplattformen inklusive `darwin-x64` ab (win32-x64-msvc 38,4 MB, darwin-x64 32,3 MB, darwin-arm64 27,1 MB). `processing.engine: 'canvas-native'` setzen, um den 15-MB-`@techstark/opencv-js`-Wasm-Default zu überspringen (Genauigkeitsdelta laut §14.2 Punkt 4 unvalidiert — vor dem Ausrollen selbst prüfen). Den Graustufen+Invert+Kontrast-Pass mit demselben `@napi-rs/canvas` **ausschließlich** für den tesseract-Fallback reservieren, dort ist er nicht optional.

### 14.4 Engine-Interface

```typescript
export interface OcrStamp {
  engineId: 'ppocr' | 'tesseract';
  engineVersion: string;      // npm-Version, z. B. '6.4.3'
  modelId: string;            // z. B. 'PP-OCRv6_tiny'
  modelSha256: string;
  schemaVersion: number;      // von Hand hochzählen, wenn eigenes Pre/Postprocessing sich ändert
}
export const stampKey = (s: OcrStamp) =>
  `${s.engineId}@${s.engineVersion}/${s.modelId}#${s.modelSha256.slice(0, 12)}/v${s.schemaVersion}`;

export interface OcrEngine {
  readonly stamp: OcrStamp;
  init(): Promise<void>;
  recognize(input: Uint8Array, opts?: { signal?: AbortSignal }): Promise<OcrResult>;
  dispose(): Promise<void>;
}
```

Das Schema aus §7 (`content_text(source, engine, engine_version)` + `UNIQUE`-Index) trägt das bereits — `ocr_stamp` als einzelne Spalte für billige `WHERE ocr_stamp <> :currentStamp`-Re-Index-Abfragen ergänzen, wenn von `tiny` auf `small` oder von PP-OCRv6 auf v7 gewechselt wird.

**Blocker, ausdrücklich markiert:**

- **Kein Adminrechte-Problem:** `onnxruntime-node`s Postinstall lädt auf win32/darwin **nichts** herunter (nur `linux/x64` zieht CUDA — irrelevant für die Zielplattformen); `--onnxruntime-node-install=skip` ist der dokumentierte Opt-out.
- **ASAR:** `.node`-Dateien von `onnxruntime-node` und `@napi-rs/canvas` laden nicht aus dem Archiv → `asarUnpack` zwingend, gleiches Muster wie bereits für better-sqlite3 etabliert.
- **`.onnx`/`.ort`-Modelle fallen nicht unter Smart-Unpack** (nur `.node`/`.dll`/`.exe`/`.dylib`/`.so`, bereits in §7 notiert) → `extraResources`.
- **Konstraint-Verletzung im Default:** `ppu-paddle-ocr`s `CACHE_DIR` ist ein hartcodierter Konstantenwert unter `~/.cache/ppu-paddle-ocr` (Windows: außerhalb von `%LOCALAPPDATA%`) — nur mit **absoluten** Modellpfaden umgehbar (verifiziert: Bypass funktioniert auch mit sabotiertem `fetch`).
- **Netz:** Modell-Download von `huggingface.co` ist ein vierter Netz-Zielort neben `web.whatsapp.com`/Medienservern/GitHub Releases. Erfüllt die Hartregel („Modell-Downloads sind die einzige Ausnahme … nach ausdrücklicher Nutzeraktion"), aber der konkrete Host (persönliches Konto, 0 Likes) ist ein eigenständiges Risiko — Spiegelung auf ein eigenes GitHub Release empfohlen, dann bleibt der Netzwerk-Fußabdruck bei den bereits erlaubten Hosts.
- **macOS x64:** kein `darwin-x64`-Prebuild seit `onnxruntime-node` 1.24.1 → **Eigentümerentscheidung nötig**, siehe unten.

---

## 15. Transkription und Dokumenttext

### 15.1 Whisper-Sidecar: Verfügbarkeit Windows und macOS

whisper.cpp `v1.9.3` (getaggt 2026-08-20, MIT — `whisper.cpp` und das gebündelte `ggml` beide „MIT License, Copyright (c) 2023-2026 The ggml authors"). **Der GitHub-Release zu `v1.9.3` trägt keinerlei Binär-Assets** — alle konstruierten Download-URLs unter `/releases/download/v1.9.3/...` liefern `404`; dieselben Dateinamen unter dem parallelen Dev-Tag `b4938` liefern `206` (**[VERIFIZIERT]**, `curl -sSL -o /dev/null -w '%{http_code}'`). `b4938` zeigt auf **denselben Commit** wie `v1.9.3` (`git rev-parse` beider Tags → `371b5a7561823ab2bb32142d2751e35e7534727b`) — Ursache ist `make-release.yml`, das die `v*`-Releases nur mit Body, ohne Upload-Schritt erzeugt.

**Es gibt kein macOS-CLI-Binary — nie.** Das einzige Apple-Artefakt ist `whisper-<tag>-xcframework.zip`, eine iOS/macOS-Bibliothek zum App-Einbetten, kein lauffähiges CLI. Der einzige `macos-latest`-Job im Release-Workflow (`ios-xcode-build`) produziert genau dieses xcframework. **Konsequenz: der macOS-Sidecar muss so oder so selbst in CI gebaut werden** — unabhängig von jeder anderen Entscheidung.

Die offiziellen Windows-Binaries importieren `msvcp140.dll`/`vcruntime140.dll`/`vcruntime140_1.dll` (alle vier Kern-Binaries) sowie `vcomp140.dll` (OpenMP, `ggml-base.dll` + jede `ggml-cpu-*.dll`) — keine dieser DLLs liegt im Zip (**[VERIFIZIERT]**, PE-Import-Table-Dump via `pefile`). Das wäre die VC++-2015-2022-Redistributable auf der Zielmaschine — ein potenzieller Blocker auf einem verwalteten Firmenrechner ohne Adminrechte. whisper.cpps `CMakeLists.txt` setzt keine MSVC-Runtime-Policy, ein Eigenbau linkt also standardmäßig dynamisch (`/MD`):

```yaml
# Windows-CI — statische CRT, kein OpenMP → keine Redistributable, kein Admin
cmake -S wc -B wc/build -A x64 -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF `
  -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded -DGGML_OPENMP=OFF `
  -DGGML_NATIVE=OFF -DGGML_AVX2=ON -DWHISPER_SDL2=OFF -DWHISPER_BUILD_TESTS=OFF
cmake --build wc/build --config Release --target whisper-cli
# CI-Gate: Import-Table darf kein msvcp140/vcruntime140/vcomp140 enthalten
```

**[RECON, mittlere Konfidenz]** — der Report hat diesen Build **nicht ausgeführt** (kein Windows-Host in der Sandbox), nur die CMake-Optionen als vorhanden verifiziert. Als Hypothese behandeln, im ersten echten Windows-CI-Lauf per `dumpbin /dependents` bestätigen und den Build hart scheitern lassen, falls eine der drei DLLs auftaucht.

Für macOS: **pro Architektur separat bauen** (arm64 auf `macos-latest`, x64 auf `macos-15-intel`), nicht per `lipo` vereinen — ggmls CPU-Dispatch verträgt sich nicht gut mit `CMAKE_OSX_ARCHITECTURES`-Universalbuilds. `-DGGML_METAL=OFF -DGGML_ACCELERATE=ON -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF` — Metal aus ist hier richtig (Transkription läuft im Leerlauf/CPU-Idle-Gate nach §-Empfehlung unten), hält das Binary self-contained.

Alle npm-Whisper-Bindings sind disqualifiziert: `nodejs-whisper`/`whisper-node` shellen zu einem auf der Nutzermaschine kompilierten whisper.cpp (Compiler-Toolchain als Voraussetzung — inkompatibel mit dem verwalteten Firmenrechner); `smart-whisper` führt `node-gyp rebuild` beim Install aus (keine Prebuilds, letzter Release 2024-10-02). **Kein Release-Auto-Konsum:** den Commit `371b5a7561823ab2bb32142d2751e35e7534727b` (== Tag `v1.9.3`) als CI-Build-Input pinnen und den eigenen Sidecar als Asset auf dem eigenen GitHub-Release veröffentlichen — „neuestes whisper.cpp-Release" gibt es funktional nicht.

### 15.2 Modellwahl für Deutsch — und was „on demand" daran ändert

**Gemessen** (**[VERIFIZIERT]**, 4-Core Xeon 2,8 GHz, 328,2 s deutsche Sprache, 30 Clips PolyAI/minds14 de-DE, 8-kHz-Telefonie hochgesampelt auf 16 kHz mono, Flags `-l de -t 4 -np -oj -bs 1 -bo 1`):

| Modell | Wandzeit | Echtzeitfaktor | Peak RSS | WER | CER |
|---|---|---|---|---|---|
| `ggml-base.bin` | 42,8 s | 7,66× | 246 MB | 33,1 % | 22,6 % |
| `ggml-small.bin` | 145,4 s | 2,26× | 666 MB | 27,5 % | 20,6 % |
| `ggml-large-v3-turbo-q5_0.bin` | 988,3 s | 0,33× | 775 MB | 22,2 % | 18,9 % |

**Reihenfolge vertrauenswürdig, Absolutwerte nicht** — 8-kHz-Telefonie mit unpunktuierten, crowdgesourcten Referenzen bläht die WER auf; echtes 16-kHz-WhatsApp-Opus wird deutlich besser abschneiden (unverifiziert — vor Standardfestlegung auf 20–30 echten deutschen WhatsApp-Sprachnachrichten nachmessen, ein halber Tag Aufwand). `medium` wurde **nicht** gemessen und wird **nicht** empfohlen: 1,53 GB, ältere Modellgeneration, liegt (inferiert) zwischen `small` und `turbo` — verliert gegen `turbo-q5_0` (574 MB, neuere Generation, gemessen besser) auf jeder Achse.

| Datei | Bytes | SHA-256 | Lizenz |
|---|---|---|---|
| `ggml-base.bin` | 147.951.465 | `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe` | MIT |
| `ggml-small.bin` | 487.601.967 | `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b` | MIT |
| `ggml-large-v3-turbo-q5_0.bin` | 574.041.195 | `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2` | MIT |
| `ggml-silero-v6.2.0.bin` (VAD) | 885.098 | `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987` | MIT |

(HF-Repo `ggerganov/whisper.cpp`, `cardData.license: mit`; Original-OpenAI-Gewichte ebenfalls MIT, verifiziert u. a. via `openai/whisper-large-v3-turbo cardData.license = mit`.)

**Was „on demand" verschiebt:** Die ursprüngliche Analyse war für einen Hintergrund-Backlog gerechnet — bei 10.000 Sprachnachrichten à 30 s kostet `small` (2,26×) rund 37 CPU-Stunden, und `turbo-q5_0` (0,33×) würde einen solchen Backlog laut Report praktisch „nie leeren". **Diese Rechnung entfällt**, weil Transkription jetzt pro Klick auf eine einzelne Sprachnachricht läuft, auf die der Nutzer aktiv wartet. Für eine 30-Sekunden-Nachricht auf der (langsamen) Referenz-CPU: `base` ≈ 4 s, `small` ≈ 13 s, `turbo-q5_0` ≈ 90 s; ein moderner Achtkerner ist grob 2–4× schneller (extrapoliert, nicht gemessen) — 90 s schrumpfen dann auf eine Wartezeit im Rahmen dessen, was ein Nutzer für eine einzelne, vertrauenswürdige Transkription akzeptiert, statt eines nie abarbeitbaren Backlogs.

**Empfehlung:** `small` als Standard (schnelles Gefühl, ~13 s auf Referenzhardware), `turbo-q5_0` als explizite „genauer"-Option pro Sprachnachricht mit sichtbarer Wartezeit-Schätzung statt Spinner. `base` nur als expliziter „schnell, ungenau"-Modus für schwache Hardware — nicht als Default. `medium` gar nicht im UI anbieten. `--vad` (Silero) in beiden Fällen aktivieren, um Stille in langen Nachrichten nichts zu kosten.

**Timestamps:** `-ml 1 -sow` (ein Wort pro Segment) liefert saubere Wort-Zeitstempel für „springe zu 1:24" — verifiziert an einem deutschen Testclip, zusammengesetzte Wörter korrekt zusammengeführt (`Ich`/`möchte`/`gerne`/`Geld`/`Konto`, nicht `K`+`onto`). **Nicht** `-dtw` zuerst nehmen: standardmäßig durch Flash-Attention **still deaktiviert** (braucht zusätzlich `-nfa`), und selbst mit `-nfa` stimmten die `t_dtw`-Werte im Testclip nicht mit den verifiziert korrekten `offsets` überein (**[UNGEKLÄRT]**, mittlere Konfidenz) — `offsets` aus `-oj`/`-ml 1 -sow` verwenden, nicht `-dtw`.

### 15.3 OGG/Opus → 16 kHz Mono PCM ohne ffmpeg

`whisper-cli` kann **kein** OGG/Opus dekodieren — die eingebauten Decoder sind `miniaudio` (WAV/FLAC/MP3) plus `stb_vorbis` (nur Ogg-**Vorbis**); Opus-Support existiert nur hinter `-DWHISPER_COMMON_FFMPEG=ON`, was echtes `libavcodec`/`libavformat` verlinkt (**[VERIFIZIERT]**, Quellcode-Inspektion).

**Verifiziert funktionierend** in reinem Node 22.22, ohne native Module: `codec-parser@2.5.0` (Ogg-Demux) + `opus-decoder@0.7.12` (libopus-WASM), beide MIT, ESM-only, ~350 KB zusammen. libopus resampelt intern auf 16 kHz — kein eigener Resampler nötig. Gemessen: 79,30 s Audio in 407 ms dekodiert (~195× Echtzeit), gegen `ogg-opus-decoder`s 48-kHz-Pfad kreuzgeprüft (RMS 0,14100 vs. 0,14104, 100-ms-Hüllkurven-Pearson-r = 0,992402).

```typescript
// deps: codec-parser@2.5.0, opus-decoder@0.7.12 — beide MIT, ESM
import CodecParser from 'codec-parser';
import { OpusDecoder } from 'opus-decoder';

export async function oggOpusTo16kWav(ogg: Uint8Array): Promise<Buffer> {
  const parser = new CodecParser('application/ogg', { enableFrameCRC32: false });
  const frames: Uint8Array[] = []; let header: any = null;
  for (const page of parser.parseAll(ogg)) for (const cf of page.codecFrames ?? []) {
    header ??= cf.header; frames.push(cf.data);
  }
  if (!header || frames.length === 0) throw new Error('kein ogg/opus-Stream');
  const dec = new OpusDecoder({ sampleRate: 16000, channels: header.channels, preSkip: header.preSkip });
  await dec.ready;
  const { channelData, samplesDecoded } = dec.decodeFrames(frames);
  dec.free();
  // Mono-Mixdown, dann in ein 44-Byte-WAV-Header + PCM16 verpacken (Details ausgelassen)
  // -> als Buffer direkt an `whisper-cli -f -` (stdin) pipen.
}
```

`ffmpeg-static` explizit disqualifiziert: Lizenz `GPL-3.0-or-later` (MIT/öffentliches Repo verträgt sich damit nicht), der `install`-Script lädt das Binary erst bei `npm install` von GitHub (Netzabhängigkeit im CI, nicht im Lockfile fixiert), und die Binaries sind groß (win32-x64 81 MB, darwin-x64 78,8 MB, darwin-arm64 45,6 MB). **[UNGEKLÄRT]:** die Dekodier-Pipeline wurde nur an **einer** stereo-48-kHz-Testdatei verifiziert; WhatsApp-Sprachnachrichten sind mono, und `streamCount`/`coupledStreamCount` kamen im Test `undefined` zurück — vor dem Ausrollen an einem Korpus echter WhatsApp-`.ogg`-Dateien validieren (dekodierte Dauer gegen Container-Dauer prüfen), `ogg-opus-decoder.decodeFile()` als automatischen Fallback behalten, wenn der schnelle Pfad null Samples oder eine Dauer-Abweichung liefert. Beide Pakete sind **ESM-only** — im electron-vite-`utilityProcess`-Bundle entweder diesen Entry als ESM emittieren oder per `await import()` laden.

### 15.4 PDF: pdfjs-dist im reinen Node-`utilityProcess`

`pdfjs-dist 6.3.289` (2026-08-29), Apache-2.0, **ESM-only** (kein CJS-Build, kein Exports-Map), `engines.node: '>=22.13.0 || >=24'`, deklariert `optionalDependencies { '@napi-rs/canvas': '^1.0.0' }` — Canvas ist jetzt Teil des offiziellen Designs, kein Hack mehr.

**Kritisch:** der Nicht-Legacy-Build (`pdfjs-dist/build/pdf.mjs`) **crasht auf Node 22.22** mit `TypeError: Promise.try is not a function` (braucht V8 13.x/Node 23+) — nachdem er selbst warnt „Please use the legacy build in Node.js environments". Zwingend `pdfjs-dist/legacy/build/pdf.mjs` importieren (**[VERIFIZIERT]**, getestet an einer 14-seitigen PDF, 5.021 Zeichen auf Seite 1). Läuft headless **ohne** Worker-Datei, ohne DOM, ohne jsdom — `GlobalWorkerOptions.workerSrc` bleibt am Default, pdf.js fällt transparent auf den Fake-Worker zurück. Cleanup: `loadingTask.destroy()` — `doc.destroy` existiert **nicht**, nur `doc.cleanup()`.

```typescript
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); // NICHT der Standard-Build
// ... getDocument({ data, standardFontDataUrl, cMapUrl, cMapPacked: true, wasmUrl, iccUrl, isEvalSupported: false })
// alle vier Asset-URLs müssen absolute file://-URLs sein, sonst degradieren Fonts/CMaps still.
```

**Eine Seite ohne DOM zu einer Bitmap für die OCR:** man muss den Canvas selbst mit `@napi-rs/canvas` konstruieren und **sowohl** `canvasContext` **als auch** `canvas` an `page.render()` übergeben — pdf.js 6 exportiert keine `DefaultCanvasFactory` mehr, `render()` ohne Canvas wirft `Cannot read properties of undefined (reading 'canvas')`. Gemessen: volle Seite bei 300 DPI (2550×3300) in 696 ms gerendert, 1.621.457 B PNG.

```typescript
const viewport = page.getViewport({ scale: 300 / 72 });
const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise; // beides nötig
const png = canvas.toBuffer('image/png');
```

`@napi-rs/canvas 1.0.8` (MIT) deckt exakt die Zielplattformen ab (`canvas-win32-x64-msvc`, `canvas-darwin-arm64`, `canvas-darwin-x64`) — vorgebaut, kein `node-gyp`, kein Admin. Installations-Fußabdruck von `pdfjs-dist` gesamt 35 MB (`build/` 12 MB, `legacy/` 16 MB, `cmaps/` 1,7 MB, `wasm/` 1,6 MB, `web/` 1,6 MB, `standard_fonts/` 820 KB, `iccs/` 24 KB) — ausliefern: `legacy/` + `cmaps/` + `standard_fonts/` + `wasm/` + `iccs/` (~20 MB), `build/` und `web/` weglassen.

**Verworfene Alternativen:** `unpdf 1.8.1` bettet ein älteres `pdfjs 6.1.200` ein und warf `getMeta()`-Fehler im Test; `pdf-parse@2.4.5` (der npm-`latest`-Tag ist jetzt eine Neuschreibung, pinnt `pdfjs-dist 5.4.296` + `@napi-rs/canvas 0.1.80`; die alte 1.1.4-Linie überlebt unter dem `minor`-Dist-Tag); `mupdf 1.28.0` ist **AGPL-3.0-or-later** — bei MIT/öffentlichem Repo kategorisch ausgeschlossen.

### 15.5 DOCX: mammoth

`mammoth 1.12.2` (BSD-2-Clause, CJS, `engines.node >= 12`, veröffentlicht 2026-08-28) — aktiv gepflegt. Verifiziert: liest `word/document.xml` + Fuß-/Endnoten/Kommentare über `extractRawText`/`convertToHtml`. **Löst aber nie `headerReference`/`footerReference` auf** — Kopf-/Fußzeilentext (Briefköpfe, Seitenfußzeilen, Dokumenttitel) geht **still verloren** (Grep über `mammoth/lib/` bestätigt: null Treffer für `headerReference`/`footerReference`/`word/header`, einzig hartcodierter Teilpfad ist `word/document.xml`). Fix, ~20 Zeilen:

```typescript
import mammoth from 'mammoth';
import { unzipSync, strFromU8 } from 'fflate';

export async function docxText(path: string): Promise<string> {
  const { value } = await mammoth.extractRawText({ path });
  const zip = unzipSync(new Uint8Array(fs.readFileSync(path)));
  const extra: string[] = [];
  for (const name of Object.keys(zip)) {
    if (!/^word\/(header|footer)\d*\.xml$/.test(name)) continue;
    for (const m of strFromU8(zip[name]).matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)) extra.push(m[1]);
  }
  return extra.length ? `${value}\n${extra.join(' ')}` : value;
}
```

XLSX/PPTX bleiben per Projektentscheidung außen vor — zur Vollständigkeit: `officeparser 7.8.0` (MIT, aktiv gepflegt) wäre die einzige gepflegte Mehrformat-Option, zieht aber `pdfjs-dist` **und** `tesseract.js` als harte Abhängigkeiten (49 MB + 44 MB), und `tesseract.js` lädt Trainingsdaten standardmäßig von einer CDN — ein Risiko für die „alles lokal"-Regel, falls das je ohne gebündelte Sprachdaten aktiviert würde. Das bestätigt eher die bestehende Entscheidung, XLSX/PPTX auszulassen, als sie infrage zu stellen.

### 15.6 Blocker-Übersicht

| Bereich | Blocker | Status |
|---|---|---|
| Windows-Whisper-Sidecar | offizielle Binaries brauchen VC++-Redistributable (msvcp140/vcruntime140/vcomp140) | Eigenbau mit statischer CRT, CI-Gate per Import-Table — **[RECON]**, ungetestet |
| macOS-Whisper-Sidecar | existiert upstream gar nicht | Eigenbau zwingend, zwei CI-Jobs (arm64/x64) |
| OCR macOS x64 (Intel) | kein `onnxruntime-node`-Prebuild seit 1.24.1 | **Eigentümerentscheidung**, s. u. |
| Modell-Downloads (Whisper + OCR) | ~490–574 MB + 6,44 MB nach `%LOCALAPPDATA%\wawrap\models`, ausschließlich nach Nutzeraktion — erfüllt die Netz-Hartregel; Quelle für OCR ist ein persönliches HF-Konto (0 Likes) | Empfehlung: OCR-Modelle auf eigenes GitHub Release spiegeln |
| Native Module in ASAR | `onnxruntime-node`, `@napi-rs/canvas`, `better-sqlite3` müssen entpackt werden | `asarUnpack`, bekanntes Muster |
| Modell-Dateien in ASAR | `.onnx`/`.ort`/`.bin`/`.ggml` fallen nicht unter Smart-Unpack | `extraResources` statt `asarUnpack` |
| Adminrechte | an keiner Stelle in diesem Abschnitt nötig | bestätigt für alle empfohlenen Pakete (reine N-API-Prebuilds oder WASM/JS) |

**Versionsabgleich:** Report 06 listet unter „Supporting toolchain versions" `vite 8.2.2` und `electron-builder 26.15.3` — beides widerspricht den bereits verifizierten Projekt-Pins (Vite **7.3.6**, NICHT 8, wegen electron-vite-Peer-Range; electron-builder **26.15.7** exakt). Die Projekt-Pins stehen, das ist ein Seitenbefund des Reports ohne eigene Prüfung.

---

## 16. Eigene UI: Zwei-View-Layout, Virtualisierung und IPC unter Last

### 1. BaseWindow + zwei `WebContentsView`: Splitter, Resize, Z-Order, DPI

**[VERIFIZIERT]** Die API-Dokumentation wurde direkt aus dem Repo-Tag geladen, der zur gepinnten Version passt:
`curl https://raw.githubusercontent.com/electron/electron/v44.0.0/docs/api/{base-window,web-contents-view,view}.md`.

**Grundmuster** (aus `base-window.md`, v44.0.0):

```js
const { BaseWindow, WebContentsView } = require('electron')
const win = new BaseWindow({ width: 800, height: 600 })

const waView = new WebContentsView()
waView.webContents.loadURL('https://web.whatsapp.com')
win.contentView.addChildView(waView)

const panelView = new WebContentsView({ webPreferences: { preload: PANEL_PRELOAD } })
panelView.webContents.loadFile(PANEL_HTML)
win.contentView.addChildView(panelView)

waView.setBounds({ x: 0, y: 0, width: 800 - panelWidth, height: 600 })
panelView.setBounds({ x: 800 - panelWidth, y: 0, width: panelWidth, height: 600 })
```

**Wer besitzt den Splitter?** Views sind reine Chromium-`View`-Objekte auf OS-Ebene, sie kennen kein CSS-Flex und keine Maus-Events der jeweils anderen Seite. Der Splitter selbst kann nicht "zwischen" den Views leben — er muss entweder (a) ein schmaler dritter `View`/`WebContentsView`-Streifen sein, der Pointer-Events besitzt und per IPC Bounds-Updates an den Main-Prozess meldet, oder (b) im `contentView` des `BaseWindow` als natives, nicht-web-basiertes Element simuliert werden, indem Main auf `mousedown`/`mousemove`/`mouseup` reagiert, die der Splitter-View über `webContents.on('before-input-event', ...)` oder IPC hochreicht. In der Praxis (VS Code, viele Multi-Pane-Electron-Apps) rendert man den Splitter als schmalen dritten `WebContentsView`, dessen Renderer beim `pointerdown` die Maus-Capture übernimmt und während `pointermove` **nicht** bei jedem Event einen IPC-Call macht, sondern die Deltas lokal sammelt und per `requestAnimationFrame` throttlet, bevor ein `ipcRenderer.send('splitter:drag', x)` an Main geht — Main ruft dann `setBounds` auf beide Nachbar-Views auf. **[RECON]** Das rAF-Throttling-Muster ist Community-Praxis (aus der Suche zu "high-performance input handling"), nicht in der Electron-Doku selbst belegt.

**Animiertes `setBounds` seit Electron 42.** **[VERIFIZIERT]** `view.md` (v44.0.0) dokumentiert `view.setBounds(bounds, { animate: true | { duration, easing } })`, Default-Dauer 250 ms, Easing `linear|ease-in|ease-out|ease-in-out`. Laut PR-Suche wurde das in Electron 42 eingeführt und nach 41 zurückportiert (`https://github.com/electron/electron/pull/48812`). Für den *laufenden* Drag ist das **kein** Ersatz für plain `setBounds` (Animation würde dem Finger hinterherhängen) — aber ideal für das Ein-/Ausklappen des rechten Panels per Klick auf einen Button: einmaliger `setBounds`-Call mit `animate: true` statt 16 manuellen Zwischenschritten.

**Kein `setAutoResize`.** **[VERIFIZIERT]** Anders als das alte `BrowserView` hat `WebContentsView`/`View` in v44.0.0 kein automatisches Resize-an-Parent. Feature-Request offen: `https://github.com/electron/electron/issues/43802` — der zugehörige PR `#51773` (`view.setLayout()`, Chromium-Layout-Manager als API) trägt noch das Label „wip", **nicht gemerged** (Stand meiner Prüfung, Aug 2026). Bedeutet für uns: Fensterresize **muss** manuell über das `'resize'`-Event des `BaseWindow` behandelt werden.

**Bekannter Bug, jetzt irrelevant:** `https://github.com/electron/electron/issues/44521` — unter Windows feuerte `BaseWindow` das `resize`-Event nicht bei 1-Pixel-Änderungen (Regression durch PR #43431, betraf 31.7.3–34.0.0-alpha.6), wodurch die `WebContentsView`-Bounds nicht mitwuchsen. **[RECON]** Issue ist laut GitHub geschlossen (verlinkter Fix-PR #44700), der genaue Fix-Versionssprung ließ sich aus der Webansicht nicht auslesen — sollte vor Produktivnahme mit der gepinnten Electron-44-Version selbst nachgestellt werden (billiger Check: Fenster um 1px per Tastatur-Resize-Handle ziehen, prüfen ob `resize` feuert).

**Flacker-Historie:** Zwei ältere Bugs, beide laut GitHub geschlossen, aber Details zur Fix-Version nicht auslesbar aus der Webansicht — **[RECON]**, vor Nutzung selbst nachstellen:
- `#12938` – Reposition+Resize gleichzeitig flackerte (BrowserView-Ära).
- `#43961` – Hin- und Herschalten zwischen zwei `WebContentsView` flackerte auf macOS (Electron 33.0.0-beta.3, September 2024).

**Z-Order.** **[VERIFIZIERT]** (`view.md`): Es gibt kein `setTopBrowserView`-Äquivalent mehr. Dokumentierter Mechanismus: „If the same View is added to a parent which already contains it, it will be reordered such that it becomes the topmost view." Für ein zeitweise übereinanderliegendes Overlay (z. B. Splitter-Hover-Highlight) also `parent.addChildView(view)` erneut aufrufen statt `removeChildView`+`addChildView`.

**DPI-Wechsel:** In der geprüften Doku kein expliziter Hook für Monitorwechsel-DPI gefunden. **[UNGEKLÄRT]** — Standardannahme ist, dass `setBounds`-Koordinaten in DIPs (nicht physischen Pixeln) sind und Electron intern skaliert, wie bei `BrowserWindow`, aber das war in der verfügbaren Doku für `View`/`WebContentsView` nicht explizit dokumentiert. Billiger Check: `screen.on('display-metrics-changed', ...)` abonnieren und beim Wechsel `getBounds()`/`setBounds()` neu anwenden — kostet nichts, schützt vor Überraschungen.

**Fazit für §1:** Splitter-Drag lokal im Splitter-Renderer sammeln, rAF-throttled an Main, `setBounds` ohne `animate` während des Drags; `animate:true` nur für Klick-Toggle des Panels; Fenster-`resize` manuell auf beide Views anwenden (kein natives Auto-Resize in v44); Z-Order via Re-`addChildView`; vor Release den 1px-Resize-Bug und beide Flacker-Issues gegen die exakt gepinnte Version 44.0.0 selbst gegenchecken (dauert < 30 Minuten, keine Ferndiagnose nötig).

---

### 2. Virtualisierung für 5 Mio. Zeilen: TanStack Virtual vs. react-virtuoso vs. react-window

**[VERIFIZIERT]** Alle drei live per `npm view <pkg> version/license/peerDependencies/time` geprüft, Stand 2026-08-30:

| Paket | Version | Lizenz | Peer (React) | Letzter Release | Bundle (gzip, gemessen via bundlephobia.com API) |
|---|---|---|---|---|---|
| `@tanstack/react-virtual` | 3.14.10 | MIT | `^16.8.0 \|\| ^17 \|\| ^18 \|\| ^19` | 2026-08-18 | 7.4 KB (+ `virtual-core` ~47 KB unpacked) |
| `react-virtuoso` | 4.18.12 | MIT | `>=16 \|\| >=17 \|\| >=18 \|\| >=19` | 2026-08-17 | **[UNGEKLÄRT]** bundlephobia lieferte bei mehreren Versuchen 429 (Rate-Limit) — nicht selbst nachgemessen |
| `react-window` | 2.3.0 | MIT | `^18.0.0 \|\| ^19.0.0` | 2026-07-20 | 4.5 KB |

Alle drei sind aktiv gepflegt (Releases innerhalb der letzten 6 Wochen vor dem heutigen Datum), alle MIT, alle mit React 19 kompatibel — keine Lizenz- oder Maintenance-Rotlichter.

**Der schwierige Teil — Voranstellen ohne Scroll-Sprung:**

- **react-virtuoso** hat dafür eine **eingebaute, zweckgebaute** Prop: `firstItemIndex`. **[VERIFIZIERT]** laut `https://virtuoso.dev/react-virtuoso/api-reference/virtuoso/`: Man verkleinert `firstItemIndex` beim Voranstellen älterer Nachrichten (z. B. beim "ältere Nachrichten laden"), die Bibliothek hält den sichtbaren Ausschnitt automatisch stabil. Einschränkung laut Doku: `firstItemIndex` muss **positiv** bleiben — Empfehlung ist, mit einem hinreichend großen Startwert zu beginnen (z. B. `1_000_000`) statt bei 0. **[RECON]** aus GitHub-Issues/Discussions (`#245`, `#1032`, `#1079`, `#248`): Negative `firstItemIndex`-Werte brechen die Scroll-Erhaltung, und bei asynchronem Nachladen kann kurzzeitiges Jank auftreten, wenn Daten und `firstItemIndex`-Update in getrennten Renderpässen ankommen (beides muss atomar im selben Update passieren).
- **TanStack Virtual** hat **kein** eingebautes Äquivalent. **[RECON]** aus Discussions (`TanStack/virtual#1018`, `#704`, `#733`) und mehreren Blog-/Community-Anleitungen: Man baut es selbst über Scroll-Offset-Mathematik — vor dem Prepend `virtualizer.scrollOffset` merken, nach dem Prepend die addierte Höhe der neuen Items aufaddieren und per `scrollToOffset` kompensieren. Funktioniert, ist aber Handarbeit und potenziell fragiler bei variablen Höhen (die addierte Höhe ist vor der ersten Messung nur eine Schätzung).
- **react-window 2.x** (komplett neu geschrieben ggü. 1.x, jetzt mit `rowHeight`-Funktion oder `useDynamicRowHeight`-Hook für variable Höhen) hat laut README **keine** dokumentierte eingebaute Lösung fürs Prepend-Problem. **[RECON]**, README-Auszug lieferte keine Details zu Version-2-Änderungen im Detail, nur den Verweis auf `react-window-v1.vercel.app` für die alte Doku.

**Dynamische Messung & scroll-to-index bei Keyset-Pagination:**
- Virtuoso misst automatisch (nimmt das erste gerenderte Item als „Sonde"), optional `heightEstimates`-Array zur Reduktion von Layout-Shifts. `initialTopMostItemIndex` fürs Mounten an einer Position, `scrollToIndex()` imperativ — beides direkt für „zu Datum springen" nutzbar, wenn man Datum→Index über einen sekundären Sparse-Index aus SQLite auflöst.
- TanStack Virtual misst dynamisch über `ResizeObserver` (Standardverhalten von `useVirtualizer` mit `measureElement`), bietet `scrollToIndex` ebenfalls, aber ohne den Positions-Anker-Mechanismus von `firstItemIndex` — bei Keyset-Pagination (kein festes `totalCount`) muss man die Gesamtzahl selbst schätzen oder mit einem großzügigen Overscan-Platzhalter arbeiten.
- react-window 2.x: `rowHeight` als Funktion + `useDynamicRowHeight`, laut Doku „nicht so effizient wie feste Größen" bei dynamischen Höhen — kein Wort zu Keyset-spezifischem Verhalten in der geprüften README.

**Empfehlung:** **react-virtuoso**. Begründung: `firstItemIndex` ist exakt das Feature, das PLAN.md hier braucht (bidirektionaler Endlos-Scroll bei einem Chatarchiv, wo "ältere Nachrichten laden" ständig vorne einfügt) und bei den anderen beiden Bibliotheken von Hand nachgebaut werden müsste — mit denselben Scroll-Offset-Fallstricken, die die Community-Threads bei TanStack Virtual dokumentieren. Der Bundle-Unterschied (Virtuoso vs. TanStack Virtual, geschätzt oberhalb von react-window) ist bei einer Desktop-Electron-App mit gepacktem Chromium irrelevant. Der einzige Kompromiss: `firstItemIndex` erzwingt einen positiven, hinreichend großen Startindex — das ist bei 5 Mio. Zeilen ohnehin naheliegend und kein echtes Zugeständnis.

**Offen zu klären, billig:** ein kleiner Prototyp mit ~50k synthetischen Zeilen und zufälligem Vor-/Zurückscrollen plus "zu Datum springen" (Index-Sprünge > 100k Zeilen), um Virtuosos Verhalten bei sehr großen `firstItemIndex`-Sprüngen (nicht nur inkrementellem Prepend) selbst zu verifizieren — das war in keiner der geprüften Quellen abgedeckt.

---

### 3. IPC unter Last: MessagePort direkt vom Renderer zum `archive`-`utilityProcess`

**[VERIFIZIERT]** Muster aus `message-channel-main.md` und `utility-process.md`, geprüft für die gepinnte Version über die Doku (Electron-Version wird über `MessageChannelMain`/`utilityProcess.fork` nicht versionsspezifisch anders, API ist seit Jahren stabil, hier keine Breaking Changes zwischen Ziel- und geprüfter Version bekannt):

```js
// Main-Prozess, einmalig beim Start des Archiv-Panels
const { port1, port2 } = new MessageChannelMain()

// Port 1 geht an den utilityProcess (archive-worker)
archiveWorker.postMessage({ type: 'attach-port' }, [port1])

// Port 2 geht an den Renderer (rechtes Panel)
panelView.webContents.postMessage('archive-port', null, [port2])
```

```js
// Renderer (preload oder direkt, falls contextIsolation es erlaubt)
ipcRenderer.on('archive-port', (e) => {
  const port = e.ports[0]
  port.onmessage = (ev) => { /* 50 Nachrichten direkt vom Worker, ohne Main */ }
  port.postMessage({ type: 'query', chatId, cursor })
})
```

```js
// utilityProcess (archive-worker.js)
process.parentPort.once('message', (e) => {
  const [port] = e.ports
  port.onmessage = (ev) => {
    const rows = db.prepare(/* ... */).all(ev.data.cursor)
    port.postMessage({ type: 'result', rows })
  }
})
```

Damit liegt der Main-Prozess nach dem einmaligen Port-Setup **komplett außerhalb** des heißen Pfads „Renderer will 50 Nachrichten" — exakt was §3.1 in PLAN.md fordert (Main rechnet nie, kein synchroner Zugriff im Main).

**Structured-Clone-Kosten — [VERIFIZIERT] selbst gemessen** (Node 22.22.2, Intel Xeon @2.80GHz, 4 vCPU — Sandbox-Hardware, keine Windows-Zielhardware, daher nur als Größenordnung zu lesen, Skript unter `/tmp/claude-0/-home-user-watis/ebc576c6-683d-57e5-a331-1d0caead00c5/scratchpad/recon/bench-clone.mjs`):

```
JSON size of 50-row page: 17070 bytes
structuredClone(50 rows als JS-Objekte): 20000 clones in 1710.3 ms -> 85.51 us/clone
transfer 400-byte ArrayBuffer (Transferable statt Clone): 20000 iters -> 7.31 us/iter
```

Für eine Seite von 50 Nachrichten (~17 KB JSON-äquivalent) kostet der `structuredClone`, den `postMessage` intern macht, **~85 Mikrosekunden** — das ist gegenüber jedem SQLite-Query oder auch nur einem IPC-Roundtrip über den Main-Prozess (typischerweise niedrige Millisekunden) vernachlässigbar. Ein reines Transferable (`ArrayBuffer`) ist ~12× billiger (7.3 µs), aber der absolute Unterschied (< 0.1 ms) lohnt sich bei 50 Zeilen pro Aufruf nicht.

**Lohnt ein binäres/spaltenweises Format?** Bei 50 Zeilen: **nein**, die Ersparnis ist im Rauschen. Relevant wird es erst bei deutlich größeren Ergebnismengen (z. B. Volltextsuche über mehrere tausend Treffer, Export-Vorschau) — dort skaliert die Objektallokation (viele kleine JS-Objekte, GC-Druck) schlechter als ein spaltenweises Format mit `Float64Array` für Timestamps und Joined-String+Offsets für Text. **[RECON]**, aus eigener Logik abgeleitet, nicht an einer 5000-Zeilen-Payload selbst gemessen — falls die Suche später Ergebnisseiten > ~2000 Zeilen an den Renderer schickt, lohnt ein Nachmessen mit demselben Skript-Muster.

---

### 4. zod 4.5.4 bei ~5.000 Nachrichten/Stunde und 500er-Import-Batches

**[VERIFIZIERT]** Version bestätigt via `npm view zod version` = `4.5.4`, veröffentlicht `2026-08-29T17:55:42.775Z` (gestern) laut `npm view zod time --json`.

**Selbst gemessen** (gleiche Sandbox-Hardware wie oben, Skript unter `/tmp/claude-0/-home-user-watis/ebc576c6-683d-57e5-a331-1d0caead00c5/scratchpad/recon/bench.mjs`, realistisches Message-Objekt-Schema mit 12 Feldern inkl. verschachteltem `reactions`-Array):

```
single-message parse: 200000 parses in 55.7 ms -> 0.279 us/parse, ~3.6 Mio ops/sec
batch-of-500 parse: 2000 batches in 182.9 ms -> 0.091 ms/batch (500 Zeilen), 0.183 us/row-in-batch
context: 5000 msgs/hour = 1.389 msgs/sec needed
```

Einordnung: 5.000 Nachrichten/Stunde sind **1,4 Nachrichten pro Sekunde** — bei ~0,3 µs pro Einzelvalidierung ist der Zeitanteil der zod-Validierung am Gesamtbudget praktisch null (< 0,001 ‰ eines 16-ms-Frames), selbst mit erheblicher Sicherheitsmarge für langsamere Zielhardware. Ein 500-Zeilen-Import-Batch validiert in **unter 0,1 ms** komplett — auch mehrere solcher Batches hintereinander sprengen kein 16-ms-Budget im Main-Prozess (der ohnehin nicht validieren sollte, siehe unten) oder im `utilityProcess`.

**Empfehlung:** Volltextvalidierung pro Zeile ist bei diesen Raten günstig genug, um sie **nicht** wegzuoptimieren — die von PLAN.md/CLAUDE.md geforderte Trennung (Main rechnet nie, Archiv-Worker macht die Arbeit) genügt allein schon, um jedes Performance-Risiko zu neutralisieren. zod eignet sich damit für **beide** Ebenen: Steuerebene (IPC-Message-Envelopes) *und* Datenebene (Batch-Import-Zeilen) — der Rat "nur Steuerebene validieren, Datenebene billige Assertions" wäre hier eine verfrühte Optimierung ohne gemessenen Engpass. Einzige Vorsicht: Die 3,6 Mio ops/sec gelten für dieses konkrete Schema (12 flache Felder, ein kleines Array) — bei sehr tief verschachtelten oder stark `refine()`-lastigen Schemas (z. B. Cross-Field-Validierung) kann der Faktor kleiner ausfallen; falls ein Schema mit `.refine()`/`.superRefine()` eingeführt wird, lohnt ein erneuter Lauf desselben Bench-Musters.

---

### 5. Tailwind 4 in electron-vite (Vite-React-Renderer)

**[RECON]**, aus mehreren 2025/2026-Anleitungen zusammengetragen, nicht selbst in einem echten electron-vite-Projekt durchgebaut (siehe offene Frage unten):

**Setup:**
1. `@tailwindcss/vite` als Plugin **nur im `renderer`-Block** von `electron.vite.config.ts` eintragen, nicht in `main`/`preload`:
   ```ts
   import tailwindcss from '@tailwindcss/vite'
   export default defineConfig({
     renderer: { plugins: [tailwindcss(), react()] }
   })
   ```
2. Keine `tailwind.config.js` mehr nötig (CSS-first). Einstiegspunkt: `@import "tailwindcss";` ganz oben in `src/renderer/src/assets/main.css`.
3. Custom-Theme-Werte über `@theme { --color-brand: ...; }` direkt in derselben CSS-Datei statt `theme.extend` in JS.

**Fallstricke** (aus den Anleitungen destilliert, **[RECON]**):
- Plugin im falschen Block (`main` statt `renderer`) eingetragen → kompiliert scheinbar fehlerfrei, aber keine Utilities im Output.
- `main.css` wird nicht in der Renderer-Entry (`main.tsx`/`App.tsx`) importiert → Tailwind läuft im Hintergrund, aber nichts landet im Bundle.
- Content-Scanning: Tailwind 4 scannt automatisch nach Klassennamen ohne `content`-Array wie in v3 — bei einer ungewöhnlichen Ordnerstruktur (z. B. geteilte Komponenten außerhalb von `src/renderer`) kann das automatische Scanning Dateien übersehen; dann hilft `@source` explizit im CSS.

**Offene Frage, billig zu klären:** Ein Minimal-Repro mit electron-vite 5.0.0 + Vite 7.3.6 + tailwindcss 4.3.3 direkt in diesem Repo aufsetzen (< 30 Minuten) und `npm run dev` prüfen — die genaue Kompatibilität von `@tailwindcss/vite` mit electron-vites Multi-Entry-Build (main/preload/renderer als getrennte Vite-Configs) wurde in keiner der gefundenen Quellen explizit für **electron-vite** (nur für reines Vite) bestätigt.

---

### 6. i18n für eine Ein-Personen-App

**[VERIFIZIERT]** Versionen/Lizenzen/Größen live geprüft:

| Paket | Version | Lizenz | gzip (bundlephobia) |
|---|---|---|---|
| `i18next` | 26.4.0 | MIT | 13,7 KB |
| `react-i18next` | 17.0.12 | MIT | **[UNGEKLÄRT]** — Abfrage lief zweimal in ein 429-Rate-Limit, nicht selbst gemessen |
| `@lingui/core` / `@lingui/react` / `@lingui/cli` | 6.6.0 | MIT | **[UNGEKLÄRT]** — dito |

**Abwägung:**
- **i18next + react-i18next** ist der Industriestandard, aber bringt einen Laufzeit-Interpolations-/Pluralisierungs-Layer mit, der für eine App mit **einer** Zielsprache (Deutsch) und einem festen, überschaubaren String-Set (WatIs? ist ein Ein-Personen-Projekt, keine mehrsprachige Rollout-Pipeline) mehr Infrastruktur ist als der Bedarf.
- **Lingui** braucht einen Build-Schritt (Macro-Extraktion, `@lingui/cli`) — sinnvoll bei mehreren Sprachen mit ICU-Pluralformen und einem Übersetzer-Workflow, hier aber zusätzliche Komplexität ohne Gegenwert, solange nur Deutsch existiert.
- **Getipptes Wörterbuch von Hand** (ein `strings.de.ts` mit `as const` und einem generischen `t(key, params?)`-Helfer, typsicher über TypeScript-Template-Literal-Types) deckt den tatsächlichen Bedarf aus CLAUDE.md ab: „UI ist von Anfang an i18n-fähig gebaut" heißt *strukturell vorbereitet* (keine hartkodierten deutschen Strings mitten im JSX, ein zentraler Lookup), nicht zwingend eine volle i18n-Runtime.

**Empfehlung:** Handgetipptes Wörterbuch + ein 15-Zeilen-`t()`-Helfer, **kein** i18next/Lingui vorerst. Begründung: Nullkosten an Bundle/Build-Komplexität, volle TypeScript-Typsicherheit auf Keys, und die Migration zu i18next ist bei Bedarf (zweite Sprache) mechanisch — die Schlüssel-Struktur bleibt gleich, nur der Resolver wird ausgetauscht. Das ist die "nicht überkonstruieren"-Antwort, die CLAUDE.md verlangt. Sollte tatsächlich eine zweite Sprache kommen, ist `i18next` (13,7 KB gzip, aktiv gepflegt, MIT) der nahtlosere Umstieg gegenüber Lingui, weil kein Compile-Schritt in die bestehende electron-vite-Pipeline eingehängt werden muss.

---

### 7. Medien-Viewer mit Zoom und Pan

**[VERIFIZIERT]** `react-zoom-pan-pinch` Version `4.0.4`, MIT-Lizenz, letzter Release `2026-08-03` (`npm view react-zoom-pan-pinch time --json`) — aktiv gepflegt, deutlich innerhalb der letzten 4 Wochen vor heute.

**Abwägung:**
- **react-zoom-pan-pinch**: fertige Lösung für Pan/Pinch/Zoom auf `<img>`/`<div>`, inkl. Touch-, Touchpad- und Maus-Gesten, Doppelklick-Zoom, programmatische Steuerung (Zoom-Buttons, Reset). Deckt den erwarteten Funktionsumfang eines Medien-Viewers (Bilder aus dem Archiv, gescannte Dokumente) direkt ab, ohne die App-eigene Logik mit Touch-/Pointer-Event-Beserderung zu belasten. **> 1 MB?** Nein — `npm view` zeigt keine native Abhängigkeit, und das Paket ist klein genug, dass die CLAUDE.md-Schwelle "> 1 MB nur nach Rückfrage" hier nicht greift (unpacked Size nicht separat gemessen, aber gzip-Bundles dieser Größenordnung liegen laut Bibliotheksbeschreibung typischerweise im niedrigen zweistelligen KB-Bereich — **[RECON]**, nicht selbst mit bundlephobia bestätigt wegen Rate-Limit).
- **Selbst mit Pointer-Events**: Pan+Zoom+Pinch korrekt zu implementieren (insbesondere: Zoom-Zentrum unter dem Cursor/den zwei Fingern halten, Momentum, Grenzen/Clamping) ist mehr Aufwand, als der Funktionsumfang hier rechtfertigt — das ist genau die Art Yak-Shaving, die die Bibliothek für wenige KB abnimmt.

**Empfehlung:** `react-zoom-pan-pinch` verwenden. Keine native Abhängigkeit, MIT, aktiv gepflegt, deckt den Use-Case (Bild-/PDF-Vorschau im Medien-Viewer) vollständig ab. Einzige Rückfrage an den Projekteigentümer: ob die Bibliothek formal unter die "> 1 MB"-Regel fällt, sollte vor dem ersten `npm install` mit `npm view react-zoom-pan-pinch dist.unpackedSize` oder einem echten Bundle-Build geklärt werden — das ließ sich wegen des Bundlephobia-Rate-Limits in dieser Session nicht abschließend verifizieren.

---

### Offene Punkte aus diesem Abschnitt (Zusammenfassung)

| # | Frage | Status | billiger Klärungsweg |
|---|---|---|---|
| 1 | DPI-Wechsel-Verhalten von `WebContentsView.setBounds` (DIP vs. physische Pixel) | UNGEKLÄRT | `screen.on('display-metrics-changed')` + Bounds neu setzen, an zwei Monitoren mit unterschiedlichem Scaling selbst testen |
| 1 | Fix-Version von Issue #44521 (1px-Resize) und #43961 (View-Switch-Flicker) relativ zur gepinnten Electron 44.0.0 | RECON (als geschlossen markiert, Fix-Version nicht ausgelesen) | Repro-Skript mit v44.0.0 laufen lassen, 1px-Resize und schnelles View-Umschalten beobachten |
| 2 | Virtuosos `firstItemIndex`-Verhalten bei großen Index-Sprüngen (Jump-to-Date), nicht nur inkrementellem Prepend | UNGEKLÄRT | Prototyp mit 50k synthetischen Zeilen und zufälligen Sprüngen |
| 3 | Binäres/spaltenweises IPC-Format bei Ergebnismengen > 50 Zeilen (z. B. Volltextsuche) | RECON (aus Logik abgeleitet) | Gleiches Bench-Skript mit 2000–5000 Zeilen laufen lassen, sobald das Such-Feature Payload-Größen definiert |
| 5 | `@tailwindcss/vite` + electron-vite Multi-Entry-Build (main/preload/renderer getrennte Configs) | RECON | Minimal-Repro im Repo mit den gepinnten Versionen, < 30 Min |
| 6 | Bundle-Größe `react-i18next`/`@lingui/*` (gzip) | UNGEKLÄRT | bundlephobia.com später erneut abfragen (Rate-Limit war temporär) |
| 7 | Unpacked/Bundle-Größe von `react-zoom-pan-pinch` gegen die "> 1 MB"-Regel aus CLAUDE.md | UNGEKLÄRT | `npm view react-zoom-pan-pinch dist.unpackedSize` bzw. echten Vite-Build messen |

---

## 17. Stand der Technik — was andere zerbrochen hat

### 13.0 Vorbemerkung: Korrektur an §8.2 — die Live-Seite ist geladen worden

§8.2 hält fest: „Weder die drei Recon-Agenten noch ich konnten `web.whatsapp.com` laden", belegt mit `http=400`. **Das war ein Header-Artefakt, kein Block.** Der Unterschied ist die Navigations-Header-Gruppe, nicht der User-Agent:

```bash
# [VERIFIZIERT] am 2026-08-30, beide mit identischem Chrome-UA
$ curl -sS -o /dev/null -w 'http=%{http_code} size=%{size_download}\n' -A '<Chrome-UA>' \
    https://web.whatsapp.com/
http=400 size=6278

$ curl -sS -o /dev/null -w 'http=%{http_code} size=%{size_download}\n' \
    -H 'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8' \
    -H 'accept-language: en-US,en;q=0.9' \
    -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' \
    -H 'sec-fetch-site: none'    -H 'sec-fetch-user: ?1' \
    -H 'upgrade-insecure-requests: 1' \
    -A '<Chrome-UA>' https://web.whatsapp.com/
http=200 size=610304
```

Damit ändert sich die Beweislage für dieses Kapitel grundlegend. Ich habe die neun ausgelieferten Bundles (`b1.js`–`b9.js`, zusammen 15,1 MB, davon `b7.js` 6,1 MB und `b6.js` 5,2 MB) heruntergeladen und durchsucht. Alles in §13.2 und §13.3 ist **[VERIFIZIERT]** aus dem live ausgelieferten Code, nicht aus Bibliotheks-Quellcode inferiert.

Was §8.2 richtig bleibt: Niemand hat eine **authentifizierte** Sitzung gesehen. Alles, was erst nach dem Login existiert — `modulesMap` nach dem Settle, tatsächliches Backfill-Verhalten, Medienpfade — ist weiterhin ungeprüft. Der Spike aus §8.4 bleibt Pflicht. Er wird nur billiger, weil die halbe Capability-Matrix jetzt vorab aus den Bundles lesbar ist.

Nebenbefund zur Churn-Rechnung aus §8.3: Der erste Brief maß `client_revision` 1046380673 um 12:48 UTC. Meine Messung Stunden später:

```bash
# [VERIFIZIERT]
$ grep -oE '"client_revision":[0-9]+' index.html | head -1
"client_revision":1046383797
```

3124 Revisionen weiter am selben Tag. Die „~10 Builds/Tag" aus §8.3 zählen veröffentlichte Versionsstempel; die Revisionsnummer selbst läuft erheblich schneller.

---

### 13.1 Die Vorgänger, als Muster gelesen

Die Namensliste ist wenig wert. Interessant ist, dass die Todesursachen in **drei** Klassen fallen und dass „WhatsApp hat uns technisch abgeschaltet" keine davon ist.

| Projekt | Zustand | Klasse |
|---|---|---|
| `Enrico204/Whatsapp-Desktop` | archiviert 2018-06-13, ~335★ | **Name + Erschöpfung** |
| `Aluxian/WhatsApp-Desktop` | Repository existiert nicht mehr | **Name** (vermutet) |
| `xeco23/WasIstLos` (ex `eneshecan/whatsapp-for-linux`, WebKitGTK, ~1,2k★) | archiviert 2026-03-25, ohne Begründung | **Erschöpfung** (unbelegt) |
| `flathub/com.github.eneshecan.WhatsAppForLinux` | archiviert 2024-07-30 | Folgeschaden |
| `ramboxapp/community-edition` (~6,4k★) | archiviert, letzter Push 2022-04-21 | **Erschöpfung** (Multi-Service) |
| `nativefier/nativefier` (~35k★) | archiviert, letzter Push 2023-09-29 | **Erschöpfung** (generisch) |
| `ferdium/ferdium-recipes` | lebt, WhatsApp-Recipe v3.5.8 | überlebt |
| `amanharwara/altus` | lebt, v5.8.1 auf Electron 35.1.5 | überlebt |
| `wwebjs/whatsapp-web.js` | lebt, 22,5k★, npm 1.34.7 | überlebt, aber siehe unten |
| `wppconnect-team/wa-js` | lebt, täglich committet | überlebt |

Stern- und Archivierungsdaten **[RECON]** aus Report 09 — die GitHub-API ist aus dieser Sitzung gesperrt („GitHub access to this repository is not enabled for this session"), `raw.githubusercontent.com` und die npm-Registry sind es nicht.

**Muster 1 — Der Name tötet, nicht der Code.** Das einzige Projekt, dessen Maintainer eine Ursache *genannt* hat, nennt sie an erster Stelle:

```
# [VERIFIZIERT] — curl raw.githubusercontent.com/Enrico204/Whatsapp-Desktop/master/README.md
Due to the copyright DMCA that WhatsApp/Facebook is sending to all projects
that are using "Whatsapp" in their names, and the lack of time to
counteract any changes that WhatsApp team is doing in order to make the
development of this project hard, I'm abandoning this project.
```

Zwei Ursachen in einem Satz: Marke *und* Erschöpfung. Für `watis` ist die erste bereits vermieden — Repository, Paket, `productName`, AUMID und Programmordner tragen „WhatsApp" nicht. Diese Linie muss auch für den **UA-Token**, die Bundle-ID, das Icon und die Repository-Beschreibung halten. Ob Enrico204s DMCA-Behauptung je geprüft wurde, ist unbekannt **[UNGEKLÄRT]** — es gibt nur seine README-Aussage, keine Korrespondenz. Die Namensdisziplin ist deshalb Vorsicht, nicht belegtes Recht.

**Muster 2 — Erschöpfung durch fremde Änderungsrate.** Das ist die eigentliche Todesursache, und sie ist an der Referenzimplementierung messbar:

```bash
# [VERIFIZIERT] — npm view whatsapp-web.js time --json
1.33.0  2025-08-28   ┐
1.33.1  2025-08-30   │
1.33.2  2025-09-02   ├─ sechs Releases in dreizehn Tagen
1.33.3  2025-09-05   │
1.34.0  2025-09-06   │
1.34.1  2025-09-10   ┘
1.34.2  2025-11-06
1.34.4  2026-01-05
1.34.5  2026-01-30
1.34.6  2026-01-30
1.34.7  2026-04-24   ← letztes Release, 128 Tage alt
```

Das Profil ist bimodal: lange Stille, dann Notfallcluster. Es korreliert nicht mit Sprints, sondern mit WhatsApps Auslieferungen. Und die Reaktionszeit hat sich verschlechtert — das aktuelle npm-Release ist vier Monate alt, während mehrere Bruchmeldungen aus Juli 2026 offen sind: `getChatById` wirft `r: r`, `getChats()` liefert ein leeres Array, `downloadMedia()` wirft `DataError` nachdem die Message-ID-Property zu `$1` umbenannt wurde **[RECON]**. Ein leeres Array ist der gefährlichste dieser Fehlermodi: Ein Archiv, das nichts mehr spiegelt, meldet keinen Fehler.

**Konsequenz für `watis`:** Report 09 empfiehlt, die Accessor-Schicht zu **vendorn** statt zu bedependen — HEAD ist Monate vor npm, und die Bruchstellen landen zwischen den Releases. Das deckt sich mit §8.4/§9 des ersten Briefs. Zusatz: `wa-js` annotiert jede Funktion mit dem WA-Versionsbereich, für den sie gilt — `@whatsapp WAWebDBMessageFindLocal >= 2.3000.1034162388` bzw. `>= 2.3000.1029x, < 2.3000.1034162388` **[RECON]**. Das ist die richtige Form für `docs/bridge-map.md`: nicht „verifiziert gegen Version X", sondern ein Gültigkeits-*Intervall* pro Accessor.

**Muster 3 — Sperren treffen Sender, nicht Leser.** Eine Suche über den `whatsapp-web.js`-Tracker nach Kontosperren ergab 15 Treffer; **alle** betreffen Senden, Gruppenverwaltung oder Massenoperationen (250 Nachrichten in Folge, 1000 Kontakte, `addParticipants`, Buttons/Listen) **[RECON]**. Null Meldungen aus reiner Beobachtung. Das ist die beste verfügbare Stütze für R8 — und bleibt Abwesenheit von Evidenz. Es rechtfertigt die Read-only-Regel; es rechtfertigt nicht die Aussage „sicher".

**Was nicht als Muster auftaucht:** Sitzungsverlust beim App-Update. Eine gezielte Suche im Altus-Tracker ergab sechs Treffer, keiner meldet Logout nach Update **[RECON]**. Die Persistenz-Partition `persist:wa` ist gängige Praxis und funktioniert bei den Überlebenden. Ebenso wenig taucht auf: „WhatsApp hat den Store nach WASM verschoben" oder „Anti-Instrumentierung". Die dokumentierten Wrapper-Probleme sind schmal und für einen Read-only-Archivar meist unkritisch: IndexedDB-Fehlermeldungen, Sprach-/Videoanrufe (in beiden gepflegten Wrappern offen: Ferdium #2520 seit 2026-08-24, Altus #383 seit 2026-02-05), Badge- und Notification-Eigenheiten **[RECON]**. Anrufe sollten im README ausdrücklich als „nicht unterstützt" stehen, sonst absorbiert das Projekt die Supportlast.

---

### 13.2 Blockiert WhatsApp Web Electron-Clients? Ja — serverseitig, an genau einer Stelle

**[VERIFIZIERT]** — dies ist der wichtigste Tagesbefund und betrifft den allerersten Start.

WhatsApp Web entscheidet **serverseitig am User-Agent**, ob es die 610-KB-Anwendung oder eine 40-KB-Sperrseite ausliefert. Der Default-UA von Electron schiebt `<appName>/<version>` vor den Chrome-Token — und genau daran scheitert er. Meine Reproduktion von Report 09s Messung, heute:

```
UA-Variante            Ergebnis  Größe
default_electron       BLOCKED   40076    …(KHTML, like Gecko) watis/0.1.0 Chrome/152.0.0.0 Electron/44.0.0 Safari/537.36
stripped_appname       OK       608969    …(KHTML, like Gecko) Chrome/152.0.0.0 Electron/44.0.0 Safari/537.36
pure_chrome            OK       609028    …(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36
chrome99               BLOCKED   40761    Chrome/99.0.4844.51 …
no_safari_tail         BLOCKED   39202    …Chrome/152.0.0.0 Electron/44.0.0   (ohne Safari-Suffix)
lowercase_el           BLOCKED   40076    …Chrome/152.0.0.0 electron/44.0.0 Safari/537.36
```

Die Sperrseite enthält `class="page-version"` / `unsupported-browser-styles` und die Überschrift „WhatsApp works with Google Chrome 100+".

Die gemessene Akzeptanzregel:

| Bedingung | Wirkung |
|---|---|
| Chrome-Major ≥ 100 | erforderlich |
| Abschließendes `Safari/537.36` | erforderlich |
| Genau **ein** erkannter Browser-Produkt-Token | erforderlich |
| `Electron/<ver>` (groß geschrieben) | wird toleriert |
| `electron/<ver>` (klein) | blockiert |
| Beliebiger unbekannter Token, **vor oder nach** Chrome | blockiert |
| `HeadlessChrome/`, leerer UA | blockiert |
| `sec-ch-ua` Client Hints | werden ignoriert |

Ein zweiter, unabhängiger Grund, den `Electron`-Token trotzdem zu entfernen: WA Web parst `navigator.userAgent` und leitet daraus den `DeviceProps.platformType` ab, den es **an das Handy des Nutzers meldet**. Der Matcher prüft auf kleingeschriebenes `electron` — `Electron` fällt durch nach `PlatformType.UNKNOWN` **[RECON]**. Mit sauberem Chrome-UA meldet der Client `PlatformType.CHROME` und ist byteidentisch zu Chrome. Das ist kein Spoof: Es ist Chromium 152, das sich als Chromium 152 ausgibt. Genau das trennt es von R19 (Sec-CH-UA) und von den in §8.4 verbotenen Spoofs.

Beide gepflegten Wrapper machen exakt das, unabhängig voneinander, und zwar **an zwei Stellen** — `navigator.userAgent` *und* dem ausgehenden Header, weil beide auseinanderlaufen können **[RECON]**:

```js
// Ferdium, recipes/whatsapp/index.js (v3.5.8)
overrideUserAgent() {
  return window.navigator.userAgent.replaceAll(/(Ferdium|Electron)\/\S+ \([^)]+\)/g, '').trim();
}
// + modifyRequestHeaders() mit demselben Replace für requestFilters urls ['*://*/*']

// Altus, src/main.ts:198-201 (v5.8.1)
app.userAgentFallback = app.userAgentFallback.replace(/(Altus|Electron)([^\s]+\s)/g, "");
```

**Das gehört in Phase 0, nicht in Phase 3.** Der UA muss auf Modulebene gesetzt sein, bevor irgendein Fenster oder eine Session existiert, zusätzlich per `session.fromPartition('persist:wa').setUserAgent()` und per `webRequest.onBeforeSendHeaders`. Dazu eine Startup-Assertion, die hart scheitert, statt eine blockierte Version auszuliefern — der UA wird bei jedem Electron-Major neu erzeugt, und `productName` ist eine Zeile Konfiguration von einem stillen Totalausfall entfernt.

Und ein CI-Smoke-Test, der genau den UA des gebauten Artefakts gegen die Live-Seite schickt:

```bash
#!/usr/bin/env bash
# scripts/ua-gate.sh — fängt den wahrscheinlichsten Tag-1-Fehler. Fünf Zeilen.
set -euo pipefail
UA="$1"; OUT=$(mktemp)
curl -sS -o "$OUT" \
  -H 'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8' \
  -H 'accept-language: en-US,en;q=0.9' \
  -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' \
  -H 'sec-fetch-site: none'    -H 'sec-fetch-user: ?1' \
  -H 'upgrade-insecure-requests: 1' -A "$UA" https://web.whatsapp.com/
grep -q 'page-version\|page-browsers\|unsupported-browser-styles' "$OUT" && {
  echo "FAIL: Sperrseite für UA: $UA" >&2; exit 1; }
[ "$(stat -c%s "$OUT")" -gt 400000 ] || { echo "FAIL: Antwort zu klein" >&2; exit 1; }
echo "OK ($(stat -c%s "$OUT") Bytes)"
```

Dieser Test ist zugleich das Frühwarnsystem für die Chrome-100-Schwelle. WhatsApp hat sie schon einmal angehoben (Ferdium #572, 2022) **[RECON]**; Electron 44 liegt mit Chromium 152 komfortabel darüber, aber die Schwelle ist Serverpolitik. **Niemals eine feste alte Chrome-Version in den UA schreiben** — `whatsapp-web.js` tut das per Default mit `Chrome/101` und ist damit eine Policy-Änderung vom Bruch entfernt.

**Degradiert WhatsApp Web darüber hinaus?** Nach Aktenlage nein. Die ausgelieferte `index.html` für einen passierenden UA enthält null Vorkommen der Zeichenkette `Electron`, und der UA-Strip ist bei Ferdium wie Altus der *einzige* WhatsApp-spezifische Workaround **[VERIFIZIERT]** für die `index.html`, **[RECON]** für die Wrapper. Es bleibt die Einschränkung aus §13.0: Ich habe keine authentifizierte Sitzung gesehen. Eine clientseitige Prüfung *nach* dem Login schließt diese Messung nicht aus **[UNGEKLÄRT]** — billigste Klärung: derselbe Spike aus §8.4, ein zusätzlicher Blick auf die Konsole.

---

### 13.3 Multi-Device und Phase 5 — die tatsächliche Obergrenze

**Das ist der schwerwiegendste Befund des gesamten Auftrags.** PLAN.md §Phase 5 formuliert das Ziel so:

> „Ziel: Das Archiv reicht so weit zurück, wie das Handy Daten liefert."

Die Annahme dahinter — das Handy sei der begrenzende Faktor — ist seit Multi-Device falsch. Die Grenze ist eine **Konstante im Client**, und sie ist an einen serverseitigen Schalter gekoppelt, den ein Wrapper nicht besitzt.

```js
// [VERIFIZIERT] — live aus b8.js, wörtlich, 2026-08-30
__d("WAWebHistorySyncUtils",["WATimeUtils","WAWebABProps","WAWebChatConstants",
  "WAWebEnvironment","WAWebPrimaryFeaturesModel","WAWebSyncGatingUtils"],
(function(t,n,r,o,a,i,l){
  function e(){
    if(!r("WAWebEnvironment").isWindows) return 90*o("WATimeUtils").DAY_SECONDS;
    if(o("WAWebPrimaryFeaturesModel").PrimaryFeatures.extendedHistorySyncOnDemand
       && o("WAWebSyncGatingUtils").isOnDemandExtendedHistorySyncForHybridEnabled()){
      var e=o("WAWebABProps").getABPropConfigValue(
              "history_sync_on_demand_time_boundary_days_desktops");
      return e*o("WATimeUtils").DAY_SECONDS
    }
    return o("WATimeUtils").YEAR_SECONDS
  }
  … l.getEarliestHistorySyncDate=e
```

`isWindows` ist kein Plattform-Test. Es ist ein Gatekeeper:

```js
// [VERIFIZIERT] — live aus b4.js
__d("WAWebEnvironment",["WAWebPwaDocumentMetadataUtils","gkx"],(function(t,n,r,o,a,i,l){
  var e=r("gkx")("4112"), s=!e, u=r("gkx")("10314");
  …
  function m(){ return e?"win_hybrid":o("WAWebPwaDocumentMetadataUtils")
                 .isCurrentWebSessionInsidePwa()?"pwa":"web" }
  var p={isWeb:s,isWindows:e,…}
```

Und der Web-Einstiegspunkt bekommt diesen Gatekeeper als `false` ausgeliefert:

```bash
# [VERIFIZIERT] — in der für einen sauberen Chrome-UA gelieferten index.html
$ grep -oE '"4112":[^,}]*' index.html
"4112":{"result":false
"4112":{"result":false
```

Damit steht die Antwort auf die gestellte Frage fest:

> **Die tatsächliche Obergrenze für einen Electron-Wrapper ist `now − 90 Tage`.** Sie ist client-konstant, nicht handyabhängig, und nicht durch legitime Mittel anhebbar.

Der 365-Tage-Pfad wird nur beim Pairing angefordert, wenn dasselbe Gate gesetzt ist:

```js
// [VERIFIZIERT] — b8.js, DeviceProps-Builder
var i=o("WAWebClientFeatureFlags").isFeatureEnabled("debug_1_year_history_sync");
if(i) a=babelHelpers.extends({},a,{fullSyncDaysLimit:365});
else { … getStorageEstimation() … storageQuotaMb … }
```
und `debug_1_year_history_sync` ist selbst als `WAWebEnvironment.isWindows` definiert **[RECON]**. Ein Browser bzw. Electron-Client sendet folglich `requireFullSync:false` und kein `fullSyncDaysLimit`.

Der Massen-Ausweg existiert nicht — er ist ausdrücklich unimplementiert:

```js
// [VERIFIZIERT] — b7.js, wörtlich
case o("WAWebProtobufsE2E.pb").Message$PeerDataOperationRequestType.FULL_HISTORY_SYNC_ON_DEMAND:
  throw r("err")("full history sync on demand is not supported in web");
```

Was **bleibt**, ist der inkrementelle Pfad pro Chat, mit den Parametern aus der Live-AB-Prop-Tabelle:

```
# [VERIFIZIERT] — b6.js, Format name:[id,"typ",defaultArmA,defaultArmB]
history_sync_on_demand:[3337,"bool",!1,!1]
history_sync_on_demand_companion:[17198,"bool",!1,!0]
history_sync_on_demand_cooldown_sec:[4365,"int",7200,7200]
history_sync_on_demand_failure_limit:[4364,"int",10,10]
history_sync_on_demand_message_count:[3811,"int",50,50]
history_sync_on_demand_time_boundary_days_desktops:[18391,"int",1095,1095]
history_sync_on_demand_timeout_ms:[3882,"int",1e4,1e4]
history_sync_on_demand_with_android_beta:[4135,"bool",!1,!1]
```

50 Nachrichten pro Anfrage, 10 s Timeout, eine Anfrage pro Chat gleichzeitig, nach 10 Fehlern zwei Stunden Sperre. Der 1095-Tage-Wert heißt ausdrücklich `_desktops` und gehört zum Hybrid-Pfad. Diese Zahlen sind zugleich die Drosselvorgabe: Wer sie überschreitet, kauft sich eine Zwei-Stunden-Sperre statt eines Archivs.

Und das Handy muss dabei erreichbar sein — das ist nutzersichtbar, nicht nur Protokoll:

```
# [VERIFIZIERT] — Strings aus den Live-Bundles
"Keep WhatsApp open on your phone while syncing older messages.
 To see your full chat history, check your phone."
"Syncing of older messages has paused. Open WhatsApp on your phone to continue syncing.
 You can still send and receive messages here."
```

PLAN.md hat diesen Teil richtig („nur bei Leerlauf und wenn das Handy online ist").

**Unabhängige Bestätigung** aus der mautrix-Bridge-Dokumentation: „The amount of history sent by the phone depends on what the linked device requests: web clients request 3 months, while desktop clients request 1 year." **[RECON]** Drei Monate vs. 90 Tage — nah, aber nicht identisch. Deshalb: **Die 90 nicht hart kodieren.** Zur Laufzeit `getEarliestHistorySyncDate()` lesen und dem Nutzer das tatsächlich erreichbare Datum zeigen.

#### Was hier ehrlich ungeklärt bleibt

| Frage | Warum offen | Billigste Klärung |
|---|---|---|
| Wirkt die 90-Tage-Grenze als Anfrage-Anker, als serverseitiger Schnitt, oder beides? | Aus minifiziertem Code statisch nicht unterscheidbar | Der Spike, mit einem Konto, das älter als 90 Tage ist |
| Ist On-Demand-Backfill für ein gegebenes Konto überhaupt verfügbar? | `history_sync_on_demand:[3337,"bool",!1,!1]` — Default in **beiden** Armen aus; zusätzlich abhängig von `PrimaryFeatures`, die **das Handy** meldet | Der Spike. Vorher keine Zusage |
| Liefert On-Demand für Companion-Geräte überhaupt? | Baileys #2452: Anfrage liefert eine `sessionId`, aber `messaging-history.set` feuert nie — „WhatsApp servers appear to silently drop the on-demand request for companion devices" **[RECON]** | Der Spike |
| Ist `gkx("4112")` für die native Windows-App wirklich `true`? | Nur der Web-Einstiegspunkt war messbar | Nicht klärbar und nicht nötig — es ist ohnehin kein gangbarer Hebel |

**Es gibt einen Hebel, und er wird nicht benutzt.** `gkx("4112")` zu fälschen bzw. `WAWebEnvironment.isWindows` zu überschreiben, wäre ein **Schreibzugriff in WhatsApps Internals** und verstößt gegen die Read-only-Regel. Es würde dem Handy des Nutzers beim Pairing eine falsche Plattform melden. Und es funktioniert vermutlich nicht einmal: Der Hybrid-Pfad ruft `WAWebBackendApi.frontendSendAndReceive('getDeviceInfo')` und liest einen `windowsBuild`-Parameter, den nur die native Shell liefert **[RECON]**. Gehört als **geprüft und verworfen** ins Risikoregister, damit es nicht in sechs Monaten erneut auftaucht.

#### Der Terminierungsfehler, den beide Reports übersehen haben

PLAN.md Phase 5 sagt: „wiederholen, bis nichts mehr kommt". Das ist derselbe `while (loadedMessages.length)`-Loop, den `whatsapp-web.js` fährt — und der einen Netzwerkfehler nicht von „keine Nachrichten mehr" unterscheidet **[RECON]**. Ein einzelner Fehlschlag beendet den Chat als „vollständig".

WA Web liefert das richtige Signal selbst. Aber — und das hat **kein Report bemerkt** — es existieren **zwei Enums mit überlappenden Namen und unterschiedlichen Zahlen im selben Bundle**:

```js
// [VERIFIZIERT] — b8.js, Offset 1355676: das Modell-Enum, das WAWebHistorySyncUtils konsumiert
__d("WAWebChatConstants",["$InternalEnum"],(function(t,n,r,o,a,i){
  var e=n("$InternalEnum")({
    COMPLETE_BUT_MORE_MESSAGES_REMAIN_ON_PRIMARY:0,
    COMPLETE_AND_NO_MORE_MESSAGE_REMAIN_ON_PRIMARY:1,
    INCOMPLETE:2,
    NOT_INCLUDED_IN_HIST_SYNC:3,
    COMPLETE_ON_DEMAND_SYNC_BUT_MORE_MSG_REMAIN_ON_PRIMARY:4,
    COMPLETE_ON_DEMAND_SYNC_WITH_MORE_MSG_ON_PRIMARY_BUT_NO_ACCESS:5
  }), …  i.ConversationEndOfHistoryTransferModelPropType=e

// [VERIFIZIERT] — b8.js, Offset 1340368: das Protobuf-Enum, gleiche Namen, ANDERE Werte
m=s({COMPLETE_BUT_MORE_MESSAGES_REMAIN_ON_PRIMARY:0,
     COMPLETE_AND_NO_MORE_MESSAGE_REMAIN_ON_PRIMARY:1,
     COMPLETE_ON_DEMAND_SYNC_BUT_MORE_MSG_REMAIN_ON_PRIMARY:2,
     COMPLETE_ON_DEMAND_SYNC_WITH_MORE_MSG_ON_PRIMARY_BUT_NO_ACCESS:3})
```

| Name | Modell (`WAWebChatConstants`) | Protobuf (Draht) |
|---|---|---|
| `COMPLETE_BUT_MORE_MESSAGES_REMAIN_ON_PRIMARY` | 0 | 0 |
| `COMPLETE_AND_NO_MORE_MESSAGE_REMAIN_ON_PRIMARY` | 1 | 1 |
| `INCOMPLETE` | 2 | — |
| `NOT_INCLUDED_IN_HIST_SYNC` | 3 | — |
| `COMPLETE_ON_DEMAND_SYNC_BUT_MORE_MSG_REMAIN_ON_PRIMARY` | **4** | **2** |
| `COMPLETE_ON_DEMAND_SYNC_WITH_MORE_MSG_ON_PRIMARY_BUT_NO_ACCESS` | **5** | **3** |

Der Fehlermodus ist bösartig: Eine `2` bedeutet im Modell „INCOMPLETE → aufhören", auf dem Draht aber „mehr vorhanden → weitermachen". Wer die Zahlen hart kodiert — und Report 09s eigener Vorschlag tut genau das — kürzt das Archiv still. **Immer über die benannte Konstante auflösen, nie über die Zahl**, und beim Start prüfen, dass alle sechs Namen im aufgelösten Modul vorhanden sind.

Die korrekte Abbruchbedingung steht in WA Webs eigenem Prädikat:

```js
// [VERIFIZIERT] — b8.js, primaryHasMoreMessagesReadyToLoad, wörtlich zusammengefasst
e===COMPLETE_BUT_MORE_MESSAGES_REMAIN_ON_PRIMARY
 || e===NOT_INCLUDED_IN_HIST_SYNC
 || e===COMPLETE_ON_DEMAND_SYNC_BUT_MORE_MSG_REMAIN_ON_PRIMARY
 || e===COMPLETE_ON_DEMAND_SYNC_WITH_MORE_MSG_ON_PRIMARY_BUT_NO_ACCESS   ? true
 : e===INCOMPLETE || e===COMPLETE_AND_NO_MORE_MESSAGE_REMAIN_ON_PRIMARY  ? false
 : throw Error("Match: No case succesfully matched. …")
```

Bemerkenswert: WhatsApp selbst zählt `..._BUT_NO_ACCESS` zu „mehr vorhanden". Für `watis` ist das der Zustand, der dem Nutzer angezeigt werden muss: *„Auf deinem Handy liegt mehr, aber WhatsApp liefert es hierher nicht aus."* Das ist die ehrliche Version von „vollständig nachgeladen".

---

### 13.4 Auflösung: IndexedDB (Korrektur an §8.1)

§8.1 sagt: „IndexedDB ist keine Alternative: Nachrichtentexte liegen AES-CBC-verschlüsselt unter einem *non-extractable* CryptoKey." Report 09 sagt das Gegenteil: `wa-js` liest `model-storage` mit einem Cursor, `rowId` sei der perfekte inkrementelle Checkpoint. **Beide haben in unterschiedlichen Punkten recht, und beide Formulierungen sind für sich irreführend.**

Was ich verifiziert habe:

```js
// [VERIFIZIERT] — b6.js: das Schema verschlüsselt Spalten
addEncryptedColumn                 // 13 Vorkommen
… o("WAWebStorageSchema").EncryptedValueType.ARRAY_BUFFER …
// [VERIFIZIERT] — Schlüssel sind nicht extrahierbar (2. Argument = extractable)
generateKey(R,!1,["encrypt","decrypt"])
// [VERIFIZIERT] — b7.js
o("WAWebDbEncryptionKey").DbEncKeyStore.waitForFinalDbMsgEncKey()
```

```ts
// [VERIFIZIERT] — wa-js, src/indexdb/functions/getMessagesFromRowId.ts, vollständig gelesen
const request = indexedDB.open('model-storage');
const transaction = db.transaction(['message'], 'readonly');
const objectStore = transaction.objectStore('message');
const index = objectStore.index('rowId');
const range = IDBKeyRange.lowerBound(minRowId, true);
index.openCursor(range);   // …und dann: results.push(cursor.value)
```

Der Leser **entschlüsselt nichts**. Er hat auch keinen `onversionchange`-Handler — den hat Report 09 in seinem Snippet selbst ergänzt, ohne das zu kennzeichnen. Damit:

- **§8.1 hat recht**, dass es keinen *Out-of-Process-Bypass* gibt. Ein `utilityProcess`, der die Dateien auf der Platte öffnet, bekommt Chiffrat und kommt an den Schlüssel nicht heran. Der Pfad „Archiv-Worker liest WA Webs Datenbank direkt" ist tot.
- **Report 09 hat recht**, dass der Cursor *in der Seite* eine brauchbare Primitive ist — aber als **Enumerations- und Checkpoint-Mechanismus**, nicht als Textquelle. `rowId` ist monoton und überlebt Neustarts; das ist genau der Resume-Anker, den Phase 5 braucht.
- **Keiner von beiden** hat recht, dass IndexedDB der *primäre* Archivpfad sein kann. `cursor.value.msgRowOpaqueData` ist ein `ArrayBuffer` mit Chiffrat; um Text zu bekommen, muss man ohnehin durch WA Webs eigene Storage-Schicht — also durch die Module, deren Fragilität §8.3/§9 beschreiben. Der Aufwand wird verlagert, nicht eingespart.

Praktische Folge: Der Nutzen liegt in `rowId` als Wasserzeichen („welche Zeilen sind neu?"), der Inhalt kommt weiter über die Modul-Accessoren. Dass Ferdium denselben `model-storage`-Pfad produktiv für seinen Ungelesen-Badge nutzt (`chat`-Store, Felder `unreadCount`, `archive`, `muteExpiration`) **[RECON]**, ist ein gutes Zeichen für die Stabilität des *Schemas* gegenüber der Volatilität der *Modulnamen* — und Ferdium musste dort `onversionchange` behandeln, weil WA Web die Datenbank löscht und neu anlegt.

---

### 13.5 Zwei Techniken der Überlebenden, die im Plan fehlen

**1. Gecachte `index.html` als Not-Pin.** `whatsapp-web.js` fängt die Navigation ab und spielt eine gespeicherte, bekannt funktionierende `index.html` zurück; die aktuelle wird nach jeder erfolgreichen Authentifizierung persistiert **[RECON]**. Das ist der stärkste Anti-Bruch-Hebel im gesamten Stand der Technik: Er erlaubt, einen Nutzer in Minuten wieder arbeitsfähig zu machen, ohne App-Update — mit `session.webRequest` bzw. `protocol` und ohne Adminrechte.

Das steht in Spannung zu §8.4 Punkt 4 („Nie eine feste WA-Version pinnen") — aber nur scheinbar: §8.4 verbietet, *dauerhaft* auf einer Version zu stehen. Hier geht es um einen Rückfallschalter für den Havariefall. Es ist trotzdem **eine Eigentümerentscheidung, keine technische**: Die App würde eine ältere Kopie fremder Seiten ausliefern.

**2. `history.pushState` drosseln.** WA Web flutet als SPA den Navigationsstack in einer eingebetteten Webview; Ferdium erlaubt produktiv einen `pushState` pro 5000 ms und ruft `releaseServiceWorkers()` beim Entladen **[RECON]**. Beides sind Zeilen, keine Projekte, und beide adressieren Symptome, die sonst als „App wird über Tage träge" auftauchen — also genau im Zielkorridor des „7 Tage ohne Neustart"-Kriteriums.

**3. Passkey-Verknüpfung als Beobachtungsposten.** Das Bundle kennt `PairingType` mit `QR_CODE`, `ALT_DEVICE_LINKING` und `SHORTCAKE_PASSKEY`, dazu `WAWebShortcakePasskeyScreen.react` **[RECON]**. QR existiert weiter, also besteht heute kein Problem. Electron bringt aber keine eingebaute WebAuthn-Implementierung mit. Würde die Passkey-Verknüpfung verpflichtend, wäre `watis` schlicht nicht mehr anmeldbar. Das ist kein Risiko, das man mindert — es ist ein **Abbruchkriterium**, das man vorher aufschreibt. Erkennung des Screens plus klarer Hinweis auf den QR-Pfad ist die einzige sinnvolle Vorbereitung; `@electron-webauthn/native` steht bei v0.0.6 und ist kein Plan.

---

## 18. Adversariale Kritik am Plan

Sortiert nach Schwere × Eintrittswahrscheinlichkeit. „Wkt." ist meine Einschätzung, dass der Fehler eintritt, *wenn der Plan unverändert abgearbeitet wird*.

| # | Befund | Schwere | Wkt. | Art |
|---|---|---|---|---|
| A1 | Phase 5 zielt auf eine Grenze, die es nicht gibt (90-Tage-Deckel) | hoch | 1,0 | falsche Prämisse |
| A2 | Phase 5, erster Punkt („Chat öffnen") bricht die Read-only-Regel | hoch | 1,0 | innerer Widerspruch |
| A3 | Backfill macht die ausgelieferte „RECENCY"-Suche still falsch | hoch | 1,0 | innerer Widerspruch |
| A4 | DoD Phase 5 („fünf Chats **vollständig**") ist nicht erfüllbar | mittel | 1,0 | unerfüllbare DoD |
| A5 | Kein Integritäts-, Reparatur- oder Korruptionspfad | hoch | ~0,6 | Lücke |
| A6 | Geräte-Neuverknüpfung kann das Archiv verdoppeln | hoch | ungeklärt | Lücke |
| A7 | Namenshistorie fehlt: alte Nachrichten tragen heutige Namen | mittel | 1,0 | Lücke |
| A8 | Enum-Zahlen sind nicht eindeutig (zwei Enums, gleiche Namen) | mittel | ~0,5 | Falle |
| A9 | Verschwindende Nachrichten werden stillschweigend dauerhaft | mittel | 1,0 | Lücke + Ethik |
| A10 | Zeitzonen nur zur Hälfte gelöst | mittel | ~0,8 | Lücke |
| A11 | Blob-Quote 20 GB auf dem Systemlaufwerk vs. Mengengerüst 200 GB | mittel | ~0,7 | innerer Widerspruch |
| A12 | „Läuft 7 Tage ohne Neustart" ist kein prüfbares Gate | mittel | 1,0 | unerfüllbare DoD |
| A13 | Electron-Tretmühle (~6 Majors/Jahr) ist nicht eingeplant | mittel | 1,0 | Lücke |
| A14 | Phasenreihenfolge: das Riskanteste steht in der Mitte | mittel | 1,0 | Reihenfolge |
| A15 | macOS-CI beweist Kompilierbarkeit, nicht Lauffähigkeit | niedrig | 1,0 | Etikett |

Nicht in der Liste, weil der erste Brief sie bereits gelöst hat: FTS5-Trigger und stille Desynchronisation (R1), `ORDER BY rank` (R2), `setPath` vor `ready` (R3), `oneClick` (R5), `npmRebuild` (R6), `clipboard` im Renderer (R12), Direct Reply (R10). Report 10 nennt mehrere davon als offen — dieser Stand ist überholt.

Ebenfalls nicht in der Liste, weil Report 10 dort **irrt**: Code-Signing sei „absent from the plan" — PLAN.md behandelt es in den Zeilen 289, 309, 344, 522–524, 567 und 569 **[VERIFIZIERT]**. Ein Export existiere nicht — Phase 6 liefert JSON/HTML/TXT, Zeilen 463–467 **[VERIFIZIERT]**. Modell-Downloads verletzten die Netz-Allowlist — CLAUDE.md nimmt sie ausdrücklich aus („Modell-Downloads sind die einzige Ausnahme und passieren nur nach ausdrücklicher Nutzeraktion"). Diese drei Punkte sind erledigt.

---

### A1 — Phase 5 zielt auf eine Grenze, die es nicht gibt

Belegt in §13.3. Drei Stellen sind konkret zu ändern:

| Ort | Heute | Tatsächlich |
|---|---|---|
| PLAN.md Phase 5, Ziel | „so weit zurück, wie das Handy Daten liefert" | Der Client deckelt bei `now − 90 d`, unabhängig vom Handy |
| Eigentümerentscheidung | „Backfill-Tiefe 12 Monate, pro Chat erweiterbar" | 12 Monate sind unerreichbar; 90 Tage sind die Decke, nicht der Default |
| README | „Lädt History vom Handy nach, so weit WhatsApp Web sie liefert" | näher an der Wahrheit als PLAN.md, aber „vom Handy" ist die falsche Ursache |

Die ehrliche Neufassung von Phase 5 hat drei Teile: (a) beim Verknüpfen liefert WhatsApp seinen normalen *recent history sync*; (b) darüber hinaus lässt sich pro Chat inkrementell nachziehen, 50 Nachrichten je Anfrage, nur bei erreichbarem Handy, mit hartem Boden bei 90 Tagen; (c) einen Massenpfad gibt es nicht, er wirft.

Das verschiebt den Wert des Produkts — und zwar in eine Richtung, die für ein Archiv ohnehin die richtige ist: **Der Wert ist vorwärtsgerichtet.** Ein `watis`, das an Tag 1 installiert wird, besitzt ab Tag 1 alles, dauerhaft, durchsuchbar, unabhängig von WhatsApps eigener Aufbewahrung. Die ~90 Tage davor sind eine einmalige Zugabe. Das ist eine verkaufbare Aussage; „dein ganzes Archiv" ist es nicht, weil es falsch ist.

Wenn tiefe Historie eine echte Anforderung ist, führen nur andere Wege dorthin — Import des Handy-eigenen Chat-Exports (`.txt`/`.zip`), Import einer Android-`msgstore.db`, oder ein Protokoll-Client, der beim Pairing `fullSyncDaysLimit` deklariert. Der dritte ist per CLAUDE.md verboten. Die ersten beiden sind reine Importer und stehen zu keiner harten Regel im Widerspruch — aber sie sind ein anderes Produkt und gehören dann jetzt geplant, nicht in Phase 5 entdeckt.

### A2 — Phase 5 bricht die Read-only-Regel im ersten Aufzählungspunkt

PLAN.md Phase 5:

> „Scheduler: **Chat öffnen**, „ältere Nachrichten laden" auslösen, auf Eintreffen warten, wiederholen"

§9.4 des ersten Briefs hat bereits festgestellt: *„Chats öffnen ist NICHT read-only. Ein Chat aktiv zu machen markiert ihn als gelesen und sendet Lesebestätigungen."* CLAUDE.md verbietet ausdrücklich, Nachrichten als gelesen zu markieren. Die Lehre wurde gezogen, aber nie in den Phasentext zurückgeschrieben — der Plan beschreibt heute wörtlich einen Regelverstoß als ersten Arbeitsschritt.

Das ist die gefährlichste Sorte Widerspruch, weil er sich beim Implementieren *auflöst, indem die Regel verliert*: Wer Phase 5 abarbeitet, öffnet Chats, es funktioniert, und niemand merkt, dass 500 Gesprächspartner blaue Haken bekommen haben. Korrektur: Phase 5 paginiert ausschließlich ohne Aktivierung, und `Cmd.openChatAt` / `openChatBottom` werden per Lint-Regel gesperrt — nicht per Konvention.

### A3 — Backfill macht die ausgelieferte Suche still falsch (neuer Befund)

Das ist der schärfste innere Widerspruch, und er entsteht erst aus der Kombination zweier bereits *getroffener* Entscheidungen.

§4.5 liefert als Default-Suche aus:

```sql
-- 1) RECENCY (Default) — 0,286 ms
 … WHERE search_fts MATCH :q
 ORDER BY search_fts.rowid DESC
 LIMIT 50;
```

Das ist korrekt und misst 0,286 ms statt 1155,9 ms — aber `search_fts.rowid` ist die **Einfügereihenfolge**, nicht die Zeit. Solange nur laufend mitgeschrieben wird, sind beide identisch. Phase 5 zerstört diese Identität per Konstruktion: Backfill fügt **alte** Nachrichten **spät** ein. Sie bekommen die höchsten `doc_id`s und erscheinen damit in einer Suche, die „Neueste zuerst" heißt, **ganz oben** — Nachrichten von vor drei Monaten über den von heute Morgen.

Der Fehler ist still. Er wirft nicht, er verlangsamt nichts, und er tritt erst auf, wenn Phase 5 läuft — also nach Phase 4, in der die Suche abgenommen wurde. Ein Test in Phase 4 kann ihn nicht finden.

Es gibt drei Auswege, und sie müssen entschieden sein, **bevor die erste Zeile geschrieben wird**:

1. **`doc_id` aus dem Zeitstempel ableiten** statt aus einer Sequenz — z. B. `doc_id = ts_ms * 1024 + counter`. Monoton in der Zeit per Konstruktion, Backfill ordnet sich von selbst ein. Kollisionsraum pro Millisekunde ist zu dimensionieren.
2. **Zwei Bereiche**: Live-Aufnahme zählt von einem reservierten Boden aufwärts, Backfill von diesem Boden abwärts. Billig, aber der Boden ist eine Wette auf die Nachrichtenzahl.
3. **Nach dem Backfill neu aufbauen.** Bei 5 Mio. Zeilen ist das kein Wartungsfenster, das man Nutzern zumutet.

Report 10 hat die generische Version dieses Problems gesehen („message rowids must be assigned monotonically in timestamp order … extremely painful to retrofit"), aber nicht bemerkt, dass der erste Brief bereits eine Query ausgeliefert hat, die genau darauf beruht. Die Kombination ist neu und ist ein Phase-1-Blocker.

Anmerkung zur Fairness: Die **Keyset-Pagination** in §4.6 nutzt `(ts, mid)` und ist von diesem Problem **nicht** betroffen. Nur die Suche.

### A4 — Die DoD von Phase 5 ist nicht erfüllbar

> „**DoD:** Fünf lange Chats vollständig nachgeladen; Neustart mitten im Lauf verliert nichts."

„Vollständig" ist bei einem 90-Tage-Boden nicht definiert, und WA Web kennt einen ausdrücklichen Endzustand namens `COMPLETE_ON_DEMAND_SYNC_WITH_MORE_MSG_ON_PRIMARY_BUT_NO_ACCESS` — *fertig, aber es gibt mehr, und du bekommst es nicht*. Eine DoD, die einen unerreichbaren Zustand fordert, wird entweder nie abgehakt oder unter Termindruck umgedeutet. Beides beschädigt das DoD-Gerüst insgesamt.

Erfüllbare Fassung: *Fünf lange Chats erreichen einen der terminalen Zustände (`COMPLETE_AND_NO_MORE_…`, `INCOMPLETE`, `…BUT_NO_ACCESS`), der erreichte Zustand und das älteste erreichte Datum werden pro Chat gespeichert und in der UI angezeigt; ein Neustart mitten im Lauf verliert höchstens einen Batch.* Der zweite Halbsatz der bestehenden DoD ist gut und bleibt.

### A5 — Kein Integritäts-, Reparatur- oder Korruptionspfad

Grep über PLAN.md, 641 Zeilen:

```
integrity_check  0      Korruption   0      corrupt   0
```

Was der Plan hat: „Festplatte voll" als Fehlerpfad (Zeile 519, Phase 7), Blob-Quote mit Warnung (422, 562). Was fehlt: alles, was danach kommt. Der erste Brief misst selbst, dass das Fenster real ist — `VACUUM INTO` pinnt das WAL, gemessen **1,4 GB Zuwachs in 15 s** (§4.7); Report 10 misst 237 MB WAL allein während eines 5-Mio.-Zeilen-Imports **[RECON]**. Dazu kommen auf einem verwalteten Firmenrechner zwei Angreifer, die im Plan nicht vorkommen: **Defender**, der die `.node`-Binärdatei oder die Datenbank in Quarantäne nimmt, und **Roaming-Profile**, die mitten in einen WAL-Schreibvorgang synchronisieren.

Fehlt konkret: `PRAGMA integrity_check` beim Start mit Quarantäne-und-Neuaufbau-Pfad, `journal_size_limit` plus expliziter Checkpoint während des Ingests, Freiplatzprüfung **vor** großen Medienschreibvorgängen (nicht als Fehlerpfad danach), und ein dokumentierter Weg, aus einer beschädigten Datei zu retten, was zu retten ist. Für ein Werkzeug, dessen einziger Zweck die langfristige Verwahrung nicht wiederherstellbarer Daten ist, ist das die teuerste Lücke im Plan.

Anmerkung: Der Plan verlangt in Phase 7 eine Fehlerpfad-Prüfung für „Festplatte voll" — aber Phase 3 schreibt bereits Gigabytes. Der Test steht vier Phasen hinter dem Risiko.

### A6 — Geräte-Neuverknüpfung

Nicht im Plan (`Relink`, `Neuverknüpf`: 0 Treffer). Das DDL setzt:

```sql
CREATE UNIQUE INDEX ux_messages_chat_waid ON messages(chat_id, wa_id);
```

Die Idempotenz hängt also vollständig an der Stabilität von `wa_id` (`key.id`). **Ob `key.id` eine Neuverknüpfung des Geräts überlebt, hat niemand geprüft** **[UNGEKLÄRT]**. Falls nicht, dupliziert eine einzige Neuverknüpfung — nach Handywechsel, Reparatur, WhatsApp-Neuinstallation — den überlappenden Teil des Archivs, ohne Fehlermeldung. Bei 5 Mio. Zeilen ist das nicht nachträglich sauber zu trennen.

Billigste Klärung: gehört als fünfte Frage in den Spike aus §8.4. Ein Konto entkoppeln, neu verknüpfen, dieselben zehn Nachrichten erneut lesen, `key.id` vergleichen. Kosten: zehn Minuten. Wert: die Antwort entscheidet, ob der Dedupe-Schlüssel `(chat_id, wa_id)` bleiben kann oder um einen inhaltsbasierten Fallback (`chat_id, ts, sender_id, hash(body)`) ergänzt werden muss.

Zur Fairness gegenüber Report 10: Dessen Vorwurf „no stated idempotency key" ist gegenüber dem ersten Brief **falsch** — `ux_messages_chat_waid` ist genau dieser Schlüssel, und der Wettlauf zwischen Live-Aufnahme und Backfill ist damit gelöst. Was bleibt, ist die Semantik des Upserts: Da R1 `INSERT OR REPLACE` verbietet, muss der Konfliktpfad `ON CONFLICT … DO UPDATE` sein — und er darf **`revoked = 1` nicht auf 0 zurücksetzen**, wenn ein Backfill eine ältere Fassung derselben Nachricht nachliefert. Ein rückwärts überschriebenes Widerrufs-Flag ist genau der Fall, in dem `watis` etwas wieder sichtbar macht, das der Absender gelöscht hat.

### A7 — Namenshistorie

`chats.name` und `contacts.name` sind einwertig und werden überschrieben. Damit trägt jede Nachricht bei der Anzeige den **heutigen** Namen. Eine drei Jahre alte Nachricht aus einer Gruppe, die inzwischen dreimal umbenannt wurde, ist im Archiv nicht mehr auffindbar unter dem Namen, den sie damals trug — und genau danach sucht ein Mensch. Dasselbe gilt für Kontakte, die ihren Pushname ändern.

Behebung ist billig, wenn sie früh kommt: `chat_names(chat_id, name, valid_from_ts)` bzw. `contact_names(contact_id, name, kind, valid_from_ts)`, und die Anzeige löst über den Zeitstempel der Nachricht auf. Nachträglich ist sie nicht rekonstruierbar — die Historie, die man nicht mitgeschrieben hat, ist weg.

Verwandter, ungenannter Fall: **Gruppenmitgliedschaft über die Zeit.** Wer war beim Schreiben dieser Nachricht in der Gruppe? Für ein Archiv, das Kontext liefern soll, ist das relevant; es steht nirgends.

### A8 — Enum-Zahlen sind nicht eindeutig

Siehe §13.3. Kurzfassung als Regel: Im Bridge-Code niemals numerische Konstanten aus WA Web hart kodieren. Immer über den Namen im aufgelösten Modul auflösen, beim Start die Vollständigkeit der Namensmenge prüfen, und bei fehlendem Namen das Feature degradieren statt zu raten. Das ist dieselbe Regel wie §9.3 (ein `sid()`-Accessor statt 200 Aufrufstellen), nur für Enums statt für Felder — und der `_serialized` → `$1`-Vorfall zeigt, dass WhatsApp beides umbenennt.

### A9 — Verschwindende Nachrichten (und die View-once-Klarstellung)

`verschwindend`, `disappear`, `view-once`: je 0 Treffer in PLAN.md.

Zwei Dinge, die auseinandergehalten gehören:

**View-once** ist auf Web/Desktop nicht mehr zu öffnen. Das ist keine Ethikfrage, sondern eine Machbarkeitsfrage. Das Live-Bundle stützt das: Es kennt `PlaceholderType.VIEW_ONCE_UNAVAILABLE_FANOUT` und ein Flag `isViewOnceUnavailable` **[VERIFIZIERT]**, also einen Platzhalter-Renderpfad statt eines Öffnenpfads. Die Primärquelle für die Abschaltung selbst ist WABetaInfo, nicht WhatsApps eigene Dokumentation **[RECON]**, und ich habe keinen nutzersichtbaren String dazu gefunden — Restunsicherheit bleibt **[UNGEKLÄRT]**, billigste Klärung im Spike. Praktisch heißt das: Wer View-once archivieren will, muss eine Client-Beschränkung *aktiv aushebeln*. Damit wäre `watis` kein passiver Archivar mehr, sondern ein Umgehungswerkzeug — eine Kategorieänderung, kein Feature. **Gute Nachricht: PLAN.md verlangt es gar nicht.** Report 10 kritisiert hier einen Planpunkt, den es nicht gibt. Zu tun ist nur eines: es ausdrücklich als „bewusst nicht" ins README schreiben, damit es nicht später jemand für eine Lücke hält.

**Verschwindende Nachrichten** sind der reale Fall. Sie funktionieren auf WhatsApp Web mit voller Parität **[RECON]** — also spiegelt `watis` sie ein und **macht sie dauerhaft**, vollautomatisch, ohne dass irgendwo eine Entscheidung getroffen wurde. Das ist qualitativ etwas anderes als „auch gelöschte Nachrichten bleiben": Bei einer gelöschten Nachricht hat der Absender es sich hinterher anders überlegt; bei einer verschwindenden Nachricht hat er die Vergänglichkeit **vorab zur Bedingung des Sendens gemacht**. Der Plan hat für diesen Fall keinen Schalter und das README kein Wort.

Das ist keine Frage der Rechtmäßigkeit, sondern der Bewusstheit: Es sollte eine Einstellung sein, die der Eigentümer trifft, und nicht ein Nebeneffekt, den er entdeckt.

### A10 — Zeitzonen: zur Hälfte gelöst

Der erste Brief hat die schwierige Hälfte gelöst: `-- ts ist durchgängig epoch MILLISEKUNDEN, UTC, NOT NULL.` Das ist die richtige Speicherform, und sie räumt Report 10s generischen Vorwurf zu großen Teilen ab.

Offen bleibt die Darstellungshälfte, und die ist im Plan nirgends adressiert (`Zeitzone`, `timezone`, `DST`: 0 Treffer):

- Der Datumsfilter der Suche („Filter … Datum", Zeile 38) braucht **lokale** Tagesgrenzen. „Am 3. März" ist ein UTC-Intervall, das von der Zeitzone des Betrachters abhängt — und an DST-Wechseln 23 oder 25 Stunden lang ist.
- Datumstrenner in der Chatansicht („Gestern", „Montag") sind lokal, die Daten UTC.
- Der Export (Phase 6, JSON/HTML/TXT) muss festlegen, ob er UTC, Ortszeit oder beides schreibt. JSON verlustfrei heißt hier: ISO-8601 mit Offset, nicht nur Epoch.
- Reisen und Zeitzonenwechsel des Nutzers zwischen Aufnahme und Anzeige.

Kein Datenverlust, aber Suchergebnisse, die je nach Reiseland um einen Tag verrutschen. Gehört als Testfälle in die Unit-Suite (§Tests nennt bereits „Normalisierung" — hier ist der konkrete Inhalt).

### A11 — Blob-Quote gegen Mengengerüst

PLAN.md §3.1 fordert „≥ 100.000 Mediendateien / ≥ 200 GB". Die Eigentümerentscheidung setzt „Blob-Store auf dem Systemlaufwerk, Startquote 20 GB". Das ist Faktor 10 auseinander, auf einem verwalteten Firmenrechner, dessen Systemlaufwerk `watis` nicht gehört.

Auflösbar, wenn man beides als das liest, was es ist: 20 GB ist der Startwert für die tatsächliche Nutzung, 200 GB die Lastvorgabe für den Test. Dann muss der Plan aber sagen, was bei Quotenerreichung passiert — und zwar bevor es passiert. Vier Optionen, alle vertretbar, keine im Plan: harte Aufnahmesperre mit Banner; ältestes Medium verwerfen (Blob weg, Metadaten bleiben); Nutzer zum Verschieben auffordern (Zeile 422 sieht Verschieben vor); oder Videos/Sprachnachrichten ohnehin nur auf Klick — was der Eigentümer bereits entschieden hat und die Quote realistisch weit trägt.

Wichtig ist die Reihenfolge: Die Quotenlogik muss **vor** Phase 3 stehen, weil Phase 3 anfängt zu schreiben.

### A12 — „Läuft 7 Tage ohne Neustart"

PLAN.md Zeile 36, unter den Erfolgskriterien. Als Release-Candidate-Soak ist das sinnvoll. Als Gate ist es unbrauchbar: Es kostet pro Prüfung eine Woche Wanduhr, läuft nicht in CI, liefert n = 1, und im Fehlerfall keinen Hinweis worauf. Ein Solo-Entwickler wird es unter Termindruck einmal aussetzen — und danach hat das gesamte DoD-Gerüst seine Verbindlichkeit verloren.

Falsifizierbarer Ersatz, der dasselbe misst: 60-minütiger synthetischer Archivlauf, Abbruch bei positiver Regressionssteigung von RSS, Handle-Zahl und Zahl der offenen Prepared Statements über einem festgelegten Schwellwert. Das scheitert schnell und zeigt auf das Leck. Der 7-Tage-Lauf bleibt Checkliste vor dem Release, ausdrücklich **kein** Merge-Gate.

Der Lasttest nach §3.1 ist demgegenüber gut konstruiert (reproduzierbar per Seed, misst p50/p95, Event-Loop-Lag, RSS) und sollte das Vorbild sein.

### A13 — Die Electron-Tretmühle

Electron liefert alle 8 Wochen ein Major und pflegt nur die letzten drei — rund 6 Monate Lebensdauer je Version. Electron 42 erreicht EOL am 2026-10-20, Electron 44 (gepinnt) am 2027-03-02, Electron 45 erscheint am 2026-10-20 **[RECON]**, konsistent mit §3 des ersten Briefs. Das sind ~6 erzwungene Upgrades pro Jahr, und jedes bringt ein neues Chromium, das die Bridge unabhängig brechen kann — und den UA neu erzeugt (§13.2).

Im Risikoregister steht das nicht. Es gehört dort hin, mit einer Regel statt einer Absichtserklärung: **Erreicht das gepinnte Electron sein EOL, gibt es keine Releases mehr, bis der Bump steht.** Für eine App, die fremde Webinhalte rendert, ist ein ungepatchtes Chromium der schlechteste denkbare Ort zum Zurückbleiben — und auf einem verwalteten Firmenrechner ist es zusätzlich das, was eine IT-Abteilung zuerst findet.

### A14 — Phasenreihenfolge

Drei Umstellungen, absteigend nach Nutzen:

1. **Backfill-Spike nach Phase 0**, eine Woche, vier Fragen: Wie weit reicht es wirklich (§13.3 sagt 90 Tage — bestätigen)? Sind `key.id` über eine Neuverknüpfung stabil (A6)? In welcher Reihenfolge kommen Nachrichten an (A3)? Welcher Durchsatz pro Stunde? Alle vier binden das Schema aus Phase 1. Alle vier sind billig zu beantworten und ruinös spät zu entdecken. Der Bridge-Spike aus §8.4 ist ohnehin geplant — das hängt sich daran.
2. **Integritäts- und Exportpfad vor Phase 3**, nicht in Phase 6/9. Beides ist billig, solange die Datenbank klein ist, und beides ist genau dann wertlos, wenn man es braucht und es nicht getestet ist.
3. **OCR/ASR-Spike nach Phase 0**, aber nur mit einer einzigen Frage: *Wie viel MB wächst der Installer?* Die Modelle müssen unter `%LOCALAPPDATA%` liegen oder nach ausdrücklicher Nutzeraktion geladen werden; die zweite Variante ist erlaubt und vermutlich die richtige, weil der Updater sonst bei jedem Release zweistellige MB neu ausliefert. §7 des ersten Briefs sagt bereits „aus v1 streichen, eigener Recon-Auftrag" — das bleibt richtig, aber die Installergröße ist die eine Zahl, die die Entscheidung fällt, und sie kostet einen Tag.

Was **nicht** umgestellt werden sollte, obwohl Report 10 es nahelegt: Phase 3 (Bridge) in Phase 0 zu ziehen. §8.4 hat das Richtige empfohlen — Spike vorziehen, Phasen 0–2 bridge-*unabhängig* bauen. Das ist die bessere Antwort auf dasselbe Risiko, weil sie das Produkt auch dann trägt, wenn die Bridge an einem Dienstag bricht.

### A15 — macOS in CI

CLAUDE.md macht die macOS-Parität zur harten Regel, und das ist als Architekturdisziplin richtig — sie verhindert `C:\`-Annahmen und `Ctrl`-Shortcuts im Feature-Code. Was sie nicht kann: ein lauffähiges Artefakt erzeugen. Seit macOS 10.15 blockiert Gatekeeper alles Nicht-Notarisierte außerhalb des App Store, auch korrekt mit Developer ID signierte Builds; Notarisierung verlangt ein bezahltes Apple-Developer-Konto und Hardened Runtime **[RECON]**. PLAN.md weiß das (Zeilen 344, 524) und stuft den macOS-Build als „unsigniert als Pflicht-Check" ein.

Der Einwand ist deshalb schmal und betrifft nur die Etikettierung: Ein grüner Haken an einem *Packaging*-Job suggeriert Lauffähigkeit, die niemand geprüft hat. Ehrlicher — und genauso wirksam gegen Plattformannahmen — ist ein macOS-Job, der Typecheck, Unit- und Integrationstests plus den `better-sqlite3`-Ladetest fährt und ausdrücklich **kein** Release-Artefakt beansprucht. Die harte Regel aus CLAUDE.md bleibt davon unberührt.

---

### 14.1 Die rechtlich-ethische Dimension

Nüchtern, weil die Entscheidung dem Eigentümer gehört und er dafür Fakten braucht, keine Haltung.

**Der Ausgangspunkt ist besser als in den Reports angenommen.** Das README sagt bereits vieles, was andere Projekte verschweigen: kein offizielles Produkt, Bridge kann brechen, Archiv liegt unverschlüsselt, „Das Archiv enthält Nachrichten anderer Leute, auch gelöschte … eine bewusste Entscheidung — und je nach Umfeld und Rechtslage eine, die man treffen muss, nicht eine, die einem passiert." Das ist der richtige Ton. Es fehlen vier Dinge.

**1. Das Kontosperrrisiko fehlt vollständig.** Es ist das einzige Risiko, dessen Eintritt schlimmer ist als der Totalverlust der App: Der Nutzer verliert sein WhatsApp-Konto, und `watis` war die Ursache. Die Faktenlage aus §13.1 ist zweiseitig und sollte auch so dargestellt werden — WhatsApps Bedingungen untersagen inoffizielle Clients unabhängig von Lesen oder Schreiben; gleichzeitig betreffen alle 15 auffindbaren Sperrmeldungen im größten Tracker das Senden, nicht das Beobachten **[RECON]**. Das ist Grund für die Read-only-Regel, kein Freibrief.

**2. Der verwaltete Firmenrechner ändert die Sachlage — und steht nirgends.** Das ist für diesen Nutzer die folgenreichste Tatsache, und sie ist im README nicht erwähnt (`Firmenrechner`, `verwaltet`: 0 Treffer). Es geht nicht um AppLocker — das ist R14 und technisch. Es geht darum, **wem das Archiv am Ende offensteht**:

- Der Arbeitgeber besitzt das Gerät. Ein unverschlüsseltes SQLite-Archiv unter `%LOCALAPPDATA%\watis\` ist für Backup, Endpoint-Software, Forensik und eDiscovery erreichbar, ohne dass der Nutzer beteiligt wird oder es erfährt.
- CLAUDE.md nennt Roaming-Profile als reales Risiko. Ein Roaming-Profil kann das Archiv **vom Gerät weg** replizieren. Der erste Brief hat das für die *Session* gelöst (R3, `setPath` vor `ready`); für das *Archiv* gilt dieselbe Anforderung, und aus demselben Grund — nur mit deutlich größerer Datenmenge und deutlich sensiblerem Inhalt.
- Damit kehrt sich die Zusage „alles läuft lokal" in ihrer Wirkung um. Sie ist technisch wahr: keine Telemetrie, keine Cloud. Sie bedeutet aber nicht „nur du kommst dran", denn „lokal" ist hier eine Maschine, die jemand anderem gehört.
- Es sind zusätzlich private Nachrichten Dritter, die auf betriebliche Infrastruktur geraten — was in vielen Betrieben unabhängig von jeder Datenschutzfrage gegen die Nutzungsrichtlinie verstößt.

Das ist eine Information, keine Empfehlung. Wenn der Eigentümer sie kennt und das Archiv trotzdem dort will, ist das seine Entscheidung. Kennt er sie nicht, trifft er sie nicht — sie passiert ihm.

**3. Was OCR und Transkription ändern.** Das ist der Punkt, an dem der Charakter des Werkzeugs sich verschiebt, und er lässt sich präzise fassen, ohne moralisch zu werden:

> Eine empfangene Sprachnachricht **aufzubewahren** heißt, zu behalten, was jemand geschickt hat. Sie in Text zu **wandeln**, erzeugt einen neuen Datensatz, den der Absender nie hergestellt hat — und macht Jahre seines Sprechens in Sekunden **abfragbar**. Dasselbe gilt für OCR über fremde Bilder.

Der Unterschied ist eine Fähigkeit, kein Grad. Ein Foto im Archiv ist ein Foto; ein durch OCR erschlossenes Foto ist eine Volltextzeile, die jede spätere Suche über Jahre hinweg trifft — samt allem, was zufällig darauf lesbar war: Adressen auf einem Paketetikett, ein Rezept, ein Behördenbrief, den jemand kurz abfotografiert hat. Auf einem Firmenrechner (Punkt 2) wird daraus ein durchsuchbarer Textkorpus über Dritte in betrieblicher Reichweite.

Konkrete Folgerung, klein und billig: OCR und Transkription **pro Chat** ein- bzw. abschaltbar machen, und mindestens einen „dieser Chat wird nicht indexiert"-Schalter vorsehen. Der Eigentümer hat entschieden, dass Bilder automatisch archiviert werden und Transkription on demand läuft — beides bleibt davon unberührt; es geht nur darum, dass die *Erschließung* eine Entscheidung bleibt und nicht der Default für alle 500 Chats ist.

**4. Veröffentlichung ist etwas anderes als Nutzung.** Für die eigene Nutzung greift die Haushaltsausnahme (Art. 2 Abs. 2 lit. c DSGVO, Erwägungsgrund 18) — sie nimmt die Verarbeitung durch eine natürliche Person zu persönlichen Zwecken aus. Erwägungsgrund 18 hat aber einen zweiten Satz, der regelmäßig unterschlagen wird: Die Verordnung *„gilt … für Verantwortliche oder Auftragsverarbeiter, die die Instrumente für die Verarbeitung personenbezogener Daten für solche persönlichen oder familiären Tätigkeiten bereitstellen."* **[RECON]** — dies ist eine Lesart der Norm, keine Rechtsberatung. Ein öffentliches MIT-Repository mit GitHub-Releases stellt Instrumente bereit. Zusätzlich ist die Ausnahme eng: Sie trägt nicht mehr, sobald das Archiv Berufliches enthält — was bei einem WhatsApp-Archiv auf einem Firmenrechner praktisch unvermeidlich ist.

Das spricht nicht gegen die Veröffentlichung. Es spricht dafür, dass das README den Unterschied benennt, statt „ist ja privat" zu suggerieren.

**5. Was das README zusätzlich sagen sollte — die Frage, die das Projekt beantworten muss.** Für ein Archivwerkzeug ist die wichtigste Frage nicht „was kann es", sondern:

> *Wie lese ich das in zehn Jahren, wenn es `watis` nicht mehr gibt?*

Phase 6 liefert JSON/HTML/TXT, das ist die halbe Antwort. Die andere Hälfte ist eine Zusage im README: **Das Archiv überlebt die App.** Konkret — das Schema ist dokumentiert, die `.db` ist eine gewöhnliche SQLite-Datei, die Medien liegen als gewöhnliche Dateien in einem beschriebenen Verzeichnisbaum, und der Export läuft ohne `watis` und ohne Netz. Das ist zugleich das beste Argument gegen die Sorge aus A5: Ein getesteter, früher Exportpfad ist der einzige Korruptionsschutz, der auch dann wirkt, wenn alles andere versagt.

**Der Ton, in dem das steht, ist bereits richtig.** Der Abschnitt „Ehrliche Hinweise" braucht keine Umschreibung, nur vier Ergänzungen: Kontosperre, verwalteter Rechner, verschwindende Nachrichten und abgeleitete Daten (OCR/Transkription), plus einen Satz zur Haltbarkeit des Archivs. Und ein Satz zu dem, was `watis` bewusst nicht tut, damit später niemand es für eine Lücke hält: **View-once-Medien werden nicht archiviert — WhatsApp lässt sie auf Web/Desktop nicht öffnen, und das wird nicht umgangen.**
