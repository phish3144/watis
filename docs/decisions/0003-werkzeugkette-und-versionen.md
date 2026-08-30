# ADR 0003 – Werkzeugkette und Versions-Pinning

- **Status:** akzeptiert
- **Datum:** 2026-08-30
- **Betrifft:** PLAN.md §6 (Tech-Stack), §5.6 (Trade-offs), §9 (Risiken), Phase 0

Alle Versionen wurden am 2026-08-30 gegen die npm-Registry und, wo angegeben, durch Ausführen verifiziert.
Es wird **exakt** gepinnt (keine Caret-Ranges) für alles, was den Build oder das Release bestimmt.

## Kernentscheidungen

### Electron 44.0.0

Chromium 152.0.7977.54, Node 24.18.1. Supported bis 2027-03-02.

Electron 41 ist seit 2026-08-25 EOL, Electron 42 wird es am 2026-10-20 – also sieben Wochen nach
Projektstart. Ein „konservativer" Pin auf 42 hieße, v1 auf einer Basis ohne Chromium-Sicherheitspatches
auszuliefern. Der einzige Grund, der früher für eine ältere Version sprach – Prebuild-Verfügbarkeit von
better-sqlite3 – ist entfallen (siehe unten).

**macOS-Untergrenze steigt dadurch auf 13 (Ventura).** Electron 44 hat macOS 12 entfernt.

### better-sqlite3 13.0.3 – kein `electron-rebuild` mehr

Verifiziert durch Installation und Ausführung:

- Das npm-Tarball enthält **fertige N-API-Binaries für alle acht Plattformen**
  (`win32-x64`, `win32-arm64`, `darwin-arm64`, `darwin-x64`, `linux-*`), je ~1,9 MB.
  Kein `node-gyp`, kein `prebuild-install`, kein Download beim Installieren.
- `node-addon-api ^8`, N-API v10 → **ABI-unabhängig**. Ein Electron-Update kann das Modul nicht brechen.
- SQLite 3.53.4 mit `ENABLE_FTS5`, `ENABLE_FTS4`, `ENABLE_RTREE`, `ENABLE_STAT4`, `ENABLE_MATH_FUNCTIONS`.
- **Trigram-Tokenizer verfügbar** (Substring-Suche verifiziert).
- `unicode61 remove_diacritics 2` verfügbar (Verhalten siehe ADR 0002).
- External-content-FTS mit `bm25()` verifiziert.

**Das ändert PLAN.md §5.6 und §9:** Der Trade-off „native Modul → Rebuild pro Electron-Version" und das
Risiko „better-sqlite3 vs. Electron-Version" existieren nicht mehr. `@electron/rebuild` fliegt aus dem
Build. In CI kommt stattdessen ein Smoke-Test, der eine Regression sofort sichtbar macht:

```
ELECTRON_RUN_AS_NODE=1 electron -e "require('better-sqlite3')"
```

Achtung: `SQLITE_THREADSAFE=2` und `SQLITE_OMIT_PROGRESS_CALLBACK` sind einkompiliert. Lange Abfragen
laufen synchron und lassen sich nicht abbrechen. Deshalb gilt verschärft: **Der Main-Prozess hält niemals
ein `Database`-Handle.** Die Datenbank wird ausschließlich in `utilityProcess`-Workern geöffnet.

### TypeScript 6.0.3 – nicht 7.x

TypeScript 7.0.2 ist die aktuelle stabile Version, aber `typescript-eslint` unterstützt sie nicht:

```
$ npm view typescript-eslint@8.68.0 peerDependencies.typescript
>=4.8.4 <6.1.0
```

8.68.0 ist die neueste Version; eine 9.x existiert nicht. Mit TS 7 gäbe es also **kein typisiertes
Linting** – kein `strictTypeChecked`, keine `no-floating-promises`, keine `no-unsafe-*`-Regeln. Für ein
Projekt, dessen Datenpfade voller `any`-Gefahr aus fremden Page-Objekten sind, ist das der falsche Tausch.

Verifiziert: TypeScript 6.0.3 + ESLint 10.9.1 + typescript-eslint 8.68.0 mit `strictTypeChecked` und
`projectService` laufen sauber (`tsc --noEmit` und `eslint` beide grün).

Neu bewertet wird, sobald typescript-eslint TS 7 unterstützt.

### Vite 7.3.6 – nicht 8.x

```
$ npm view electron-vite peerDependencies
{ "vite": "^5.0.0 || ^6.0.0 || ^7.0.0", ... }
```

electron-vite 5.0.0 (die aktuelle stabile Version) lehnt Vite 8 bei der Peer-Auflösung ab. electron-vite 6
existiert nur als Beta. Also Vite 7.3.6.

### electron-builder 26.15.7 – explizit pinnen

Der `latest`-Dist-Tag steht auf 26.15.3, obwohl 26.15.7 existiert. Ein `npm i -D electron-builder` liefert
also stillschweigend eine ältere Version. 27.x ist Alpha.

## Gepinnte Versionen

| Paket | Version | Lizenz | Anmerkung |
|---|---|---|---|
| electron | 44.0.0 | MIT | Chromium 152, Node 24.18.1, EOL 2027-03-02 |
| electron-vite | 5.0.0 | MIT | begrenzt Vite auf ≤ 7 |
| vite | 7.3.6 | MIT | **nicht** 8.x |
| typescript | 6.0.3 | Apache-2.0 | **nicht** 7.x – Linter-Support fehlt |
| eslint | 10.9.1 | MIT | Flat Config |
| typescript-eslint | 8.68.0 | MIT | `strictTypeChecked` |
| prettier | 3.9.6 | MIT | |
| better-sqlite3 | 13.0.3 | MIT | N-API, Prebuilds im Tarball, FTS5 + Trigram |
| @types/better-sqlite3 | 9.6.0 | MIT | Pflicht, das Paket bringt keine Typen mit |
| zod | 4.5.4 | MIT | IPC-Schemas |
| react / react-dom | 19.2.8 | MIT | eigene UI |
| tailwindcss | 4.3.3 | MIT | v4: über `@tailwindcss/vite`, nicht PostCSS |
| electron-builder | 26.15.7 | MIT | exakt pinnen, Dist-Tag ist veraltet |
| electron-updater | 6.8.9 | MIT | an electron-builder gekoppelt (builder-util-runtime 9.7.0) |
| electron-log | 5.4.4 | MIT | |
| electron-store | 11.0.2 | MIT | nur `config.json`, nichts Großes |
| vitest | 4.1.11 | MIT | |
| @playwright/test | 1.62.1 | Apache-2.0 | Electron-E2E |

Alle Lizenzen sind MIT-, Apache-2.0- oder BSD-verträglich. Für Phase 7 (OCR, PDF, Whisper) werden die
Lizenzen der **Modelldateien** separat geprüft – sie weichen regelmäßig von der Code-Lizenz ab.

## Regeln, die daraus folgen

- **Exakte Versionen**, keine Carets, für electron, electron-builder, electron-updater, better-sqlite3.
  Diese vier bestimmen zusammen, ob ein Release überhaupt lädt.
- `npmRebuild: false` in der electron-builder-Konfiguration. Sonst läuft `@electron/rebuild` über
  better-sqlite3 und bricht bei Cross-Arch-Builds ab, obwohl gar nichts zu bauen ist.
- Die nicht benötigten Prebuilds werden aus dem Paket gefiltert (sonst ~27 MB Ballast pro Installer, der
  außerdem jedes differentielle Update aufbläht).
- Electron-Major-Politik: auf 44 bleiben, Sprung auf 45 nach dessen Stabilisierung, danach ungefähr
  zweimal pro Jahr – nicht jeder Major sofort. Der Sprung ist jedes Mal ein eigener PR mit Smoke-Test,
  weil ein Chromium-Major auch das Verhalten von WhatsApp Web ändern kann.
