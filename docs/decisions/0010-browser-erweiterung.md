# ADR 0010 – WatIs? als Browser-Erweiterung für Chrome, Edge und Firefox

- **Status:** akzeptiert
- **Datum:** 2026-10-02
- **Betrifft:** PLAN.md Phase 10 (neu); §5 Architektur, §3.1 Skalierungsvorgaben
- **Grundlage:** [`docs/extension-spike.md`](../extension-spike.md), alle drei Versuche

## Kontext

Die Desktop-App muss installiert werden. Auf verwalteten Firmenrechnern ist genau das die Hürde, und
wer nur im Browser arbeitet, hat von WatIs? bisher nichts. Gefragt war: WatIs? so in den Browser
bringen, dass jeder es nutzen kann – ausdrücklich in **Chrome, Edge und Firefox**.

Zwei naheliegende Wege scheiden aus:

- **Eine gehostete Web-App.** WhatsApp Web verbietet das Einbetten (`frame-ancestors`), und die
  Same-Origin-Policy lässt keine fremde Seite an WhatsApps Daten. Eine Seite, die das trotzdem
  könnte, bräuchte einen Server, der sich als WhatsApp-Client anmeldet. Das wäre ein
  Protokoll-Client und eine Cloud, also gleich zwei harte Regeln aus CLAUDE.md.
- **Ein Bookmarklet oder Userscript.** Es läuft nur, solange der Tab offen ist, hat keinen eigenen
  Speicher außerhalb von WhatsApps Herkunft und verliert ihn mit einem „Websitedaten löschen".

Bleibt die **Browser-Erweiterung**: Sie darf in `web.whatsapp.com` mitlesen, hat einen eigenen,
von WhatsApp getrennten Speicher und läuft in allen drei Browsern mit Manifest V3.

## Entscheidung

Eine Erweiterung aus einer Codebasis, zwei Pakete: `out/extension/chromium` (Chrome und Edge) und
`out/extension/firefox`. Das Manifest entsteht pro Browser aus einer Beschreibung
(`src/extension/manifest.ts`). Unterschiedlich sind nur drei Dinge:

|                | Chrome, Edge            | Firefox                           |
| -------------- | ----------------------- | --------------------------------- |
| Hintergrund    | Service Worker          | Event Page (`background.scripts`) |
| Panel          | `side_panel`            | `sidebar_action`                  |
| Add-on-Kennung | aus dem Store-Schlüssel | `watis@phish3144.github.io`       |

### Wo was läuft

```
web.whatsapp.com (Tab)
 ├─ MAIN world, document_start:  page/shims.js   – Benachrichtigungs-Shim, UI-Schalter
 │                               page/bridge.js  – dieselbe read-only Bridge wie am Desktop
 ├─ ISOLATED world:              content/relay.js – Vermittler, hängt den Frame ein
 └─ <iframe hidden> host.html    – das Archiv: Worker mit SQLite-WASM auf OPFS,
                                   Medien-Fetcher, Inhaltsindex (OCR, PDF)
Hintergrund:  Badge, Benachrichtigungen, Download-Ordner (nur Chromium)
Panel:        Suche, Chats, Medien, Einstellungen – liest Medien direkt aus OPFS
```

- **Die Bridge ist dieselbe** wie am Desktop (`src/bridge/`) und bleibt read-only. Die eine
  Sende-Ausnahme aus [ADR 0004](0004-bridge-roaming-direktantwort.md) C gibt es in der Erweiterung
  **nicht**: Kein Modul der Erweiterung tippt, klickt oder sendet. Eine ESLint-Regel lässt
  `runtime.sendMessage`/`tabs.sendMessage` nur in `src/extension/ext.ts` zu.
- **Das Archiv lebt im WhatsApp-Tab**, in einem unsichtbaren Frame mit einer Erweiterungsseite. Er
  lebt so lange wie der Tab, und länger muss der Archivierer nicht leben: Die Nachrichten kommen aus
  diesem Tab. Das ist der einzige Ort, der in allen drei Browsern gleich funktioniert. Offscreen
  Documents gibt es nur in Chromium, und Firefox beendet seine Event Page nach Leerlauf.
- **Ohne WhatsApp-Tab** öffnet das Panel das Archiv selbst, damit Suchen nicht davon abhängt, dass
  WhatsApp läuft. Sobald ein Tab erscheint, gibt das Panel das Archiv wieder ab.

### SQLite im Browser

`@sqlite.org/sqlite-wasm` 3.53.4 (Apache-2.0; SQLite selbst ist gemeinfrei) mit dem VFS
`opfs-sahpool` in einem Dedicated Worker. Schema, Migrationen, Repository, Suche und FTS-Trigger sind
**derselbe Code** wie am Desktop: `src/workers/archive/sql.ts` beschreibt die Schnittstelle, die
better-sqlite3 schon erfüllt. `sqlite-wasm.ts` passt die WASM-Variante daran an, mit
Statement-Cache, benannten Parametern, Savepoint-Transaktionen und Ablehnung von `boolean`/`undefined`
wie bei better-sqlite3. Die Integrationstests laufen in einem zweiten Vitest-Projekt gegen beide
Engines.

### Wer das Archiv besitzt

Zwei Kontexte könnten das Archiv öffnen, der Frame und das Panel. **Entschieden wird über die
OPFS-Sperre, nicht über Web Locks.** `opfs-sahpool` hält exklusive Sync-Access-Handles, ein zweiter
Öffner scheitert und versucht es alle drei Sekunden erneut. Web Locks scheiden aus: In Firefox hat
der Frame eine eigene Sperrverwaltung (gemessen, dritter Spike-Versuch), und es gäbe zwei Besitzer.

### Firefox' eingeschränkter Frame

Eine Erweiterungsseite, die in eine Webseite eingebettet ist, bekommt in Firefox nur die API-Menge
eines Content Scripts: kein `tabs`, kein `storage.session`, kein `downloads`, und sie hört
`runtime.sendMessage` nicht. Deshalb:

- Relay und Frame sprechen über einen **MessagePort**. Weil WhatsApps Seite einen `postMessage`
  nachahmen könnte, legt der Relay vorher ein Zufallstoken unter `watis:frame:<id>` in
  `storage.local` ab. Die Seite kann es nicht lesen. Der Frame nimmt nur einen Port mit diesem Token
  an und löscht es danach.
- Das Panel erreicht das Archiv mit `tabs.sendMessage` an den Relay des WhatsApp-Tabs, nicht direkt.
- Dateien verlassen den Frame nie über Downloads. Er legt sie in OPFS ab, und das Panel macht daraus
  den Download.

### WhatsApps COEP

`web.whatsapp.com` liefert `Cross-Origin-Embedder-Policy: require-corp`. Ohne passende Antwort der
Erweiterung startet im Frame kein Worker. Die Manifest-Schlüssel `cross_origin_embedder_policy`
(`require-corp`) und `cross_origin_opener_policy` (`same-origin`) lösen das in Chromium. Freigegeben
(`web_accessible_resources`) ist nur `host.html`. Worker, SQLite und WASM bleiben für Webseiten
unsichtbar.

### Berechtigungen

`storage`, `unlimitedStorage` (OPFS ist sonst nicht vor Räumung geschützt), `notifications`,
`downloads`, in Chromium `sidePanel`. Hostrechte nur für `https://web.whatsapp.com/*`. Optional und
erst auf Klick erfragt werden die Download-Hosts von GitHub, für die Sprachmodelle
([ADR 0012](0012-ocr-und-transkription-im-browser.md)).

## Was die Erweiterung bewusst nicht hat

Tray, Autostart, globaler Shortcut, eigener Updater, mehrere Konten, App-Sperre, Direktantwort, das
Nachladen älterer Nachrichten und der Export als JSON/HTML/TXT. Teils gibt es das im Browser nicht
(Tray, Autostart). Teils macht der Browser es selbst (Updates über den Store). Teils wäre es eine
eigene Entscheidung (Nachladen, Direktantwort). Die Einstellungen zeigen nur, was im Browser
tatsächlich wirkt, statt Schalter auszugrauen.

## Folgen

- **Der Speicher hängt am Browserprofil.** OPFS überlebt Abmelden, Cache-Leeren und Updates der
  Erweiterung, aber nicht ihre Deinstallation und nicht das Zurücksetzen eines Firmenprofils. Daher
  ist die Sicherung eine Hauptfunktion, keine Fußnote ([ADR 0011](0011-medien-dauerhaft-sichern.md)).
- **§3.1 gilt auch hier:** Import gebündelt, Listen paginiert, die Suche im Worker. Der Lasttest
  läuft bisher nur gegen die Desktop-Engine. Für die WASM-Engine steht er aus.
- **Edge** ist nicht eigens gemessen. Es ist Chromium mit derselben Erweiterungsplattform.
- **Gegen eine angemeldete Sitzung** ist die Erweiterung so wenig geprüft wie die Bridge selbst
  (siehe [`docs/bridge-map.md`](../bridge-map.md)). Die E2E-Tests laufen gegen eine nachgebaute
  WhatsApp-Seite mit den echten Sicherheits-Headern, in Chromium (Playwright) und Firefox (WebDriver
  BiDi).
