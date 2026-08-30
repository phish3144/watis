# Spike: Trägt eine Browser-Erweiterung die Bridge?

_Gemessen am 2026-08-30 gegen `https://web.whatsapp.com/` (nicht angemeldet), Chromium 141.0.7390.37,
Manifest V3. Quelltext des Versuchs: [`spikes/extension-csp/`](../spikes/extension-csp/)._

Vor jeder Architekturentscheidung stand eine Frage, die sich aus der Dokumentation nicht beantworten
ließ: **Wird ein Content Script mit `world: "MAIN"` auf einer Seite mit strenger Nonce-CSP überhaupt
ausgeführt?** Die Chrome-Doku sagt an einer Stelle „the CSP of the page applies", ohne zu trennen, ob
damit die Ausführung des injizierten Skripts gemeint ist oder nur dessen Folgehandlungen. Davon hängt
ab, ob Phase 3 in dieser Bauform existiert.

Also gemessen statt geraten.

## Aufbau

Eine minimale Erweiterung mit drei Content Scripts auf `web.whatsapp.com`: zwei in der MAIN world
(`document_start` und `document_idle`), eines in der ISOLATED world. Jedes schreibt sein Ergebnis in ein
`data-`Attribut von `<html>`, das anschließend ausgelesen wird. Als Kontrolle dieselbe Erweiterung gegen
eine lokal ausgelieferte Seite mit vergleichbarer Nonce-CSP.

Chromium lief über den Session-Proxy mit `--ssl-version-max=tls1.2` (der Relay verträgt Chromiums
TLS-1.3-Handshake nicht) — Zertifikatsprüfung blieb aktiv.

## Die CSP, gegen die gemessen wurde

Wie der Browser sie tatsächlich erhält:

```
script-src blob: 'self' 'nonce-zBQibVOI' 'report-sample' https://static.whatsapp.net
           'wasm-unsafe-eval' https://*.youtube.com https://maps.googleapis.com
           https://maps.gstatic.com https://lens.google.com/upload
```

Zwei Beobachtungen am Rande:

- **Es gibt keinen `X-Frame-Options`-Header.** Das Einbetten verhindert stattdessen
  `frame-ancestors https://*.whatsapp.com https://whatsapp.com` in der CSP. Am Ergebnis ändert das
  nichts — eine fremde Seite kann WhatsApp Web nicht in einen Frame nehmen —, aber der Mechanismus ist
  ein anderer, als bisher in diesem Projekt notiert war.
- Die CSP erlaubt `'wasm-unsafe-eval'`, aber **kein** `'unsafe-eval'`. Ein `curl` ohne Browser-Kontext
  bekommt eine abweichende Variante mit `'unsafe-eval'` ausgeliefert; maßgeblich ist, was der Browser
  sieht.

## Ergebnisse

| Gemessen                                              | `web.whatsapp.com`   | Kontrollseite | Bedeutung                                             |
| ----------------------------------------------------- | -------------------- | ------------- | ----------------------------------------------------- |
| MAIN-world-Skript bei `document_start` ausgeführt     | **ja**               | ja            | **Die Bridge ist in einer Erweiterung baubar.**       |
| MAIN-world-Skript bei `document_idle` ausgeführt      | **ja**               | ja            | Auch nach dem Hochfahren der Seite                    |
| `eval()` in der MAIN world                            | `EvalError`          | 42            | Folgehandlungen unterliegen sehr wohl der Seiten-CSP  |
| `new Function()` in der MAIN world                    | `EvalError`          | 42            | dito                                                  |
| Eingefügtes `<script>`-Tag                            | **blockiert**        | lief          | Der klassische Injektionsweg ist tot                  |
| `WebAssembly` kompilieren (MAIN und ISOLATED)         | **geht**             | –             | `'wasm-unsafe-eval'` ist gesetzt                      |
| `eval()` in der ISOLATED world                        | `EvalError`          | –             | Das ist die **Erweiterungs-CSP**, nicht die der Seite |
| `postMessage` MAIN → ISOLATED                         | **geht**             | –             | Der einzige Weg von der Bridge zu den `chrome.*`-APIs |
| `chrome.runtime` in der MAIN world                    | **nicht vorhanden**  | –             | erwartet; deshalb braucht es den Kanal oben           |
| `fetch()` same-origin aus dem Content Script          | **200**, 32 KB       | –             | –                                                     |
| `fetch()` cross-origin aus dem Content Script         | `TypeError`          | –             | siehe unten                                           |
| `window.__d` / `window.requireLazy` in der MAIN world | **beide `function`** | –             | Metas Modul-Loader ist erreichbar                     |

### Der wichtigste Befund

**`world: "MAIN"` wird ausgeführt.** Die Nonce-CSP verhindert das nicht — der Browser injiziert das
Skript selbst, es entsteht kein `<script>`-Tag, das eine Nonce bräuchte. Damit ist die Frage geklärt,
die als `[UNGEKLÄRT]` in `docs/managed-deployment.md` stand: Phase 3 existiert in der Erweiterung.

Und `window.__d` sowie `window.requireLazy` sind aus der MAIN world sichtbar. Das ist Metas eigener
Modul-Loader — genau der Einstiegspunkt, den die Bridge im Electron-Client benutzt.

### Was das kostet

Die Seiten-CSP greift für alles, was das injizierte Skript **danach** tut: kein `eval`, kein
`new Function`, kein nachgeladenes `<script>`. Der Bridge-Code muss also vollständig als statische
Content-Script-Datei ausgeliefert werden. Für uns ist das keine echte Einschränkung — wir bauen
ohnehin gebündelt und ohne `eval`. Aber jede Bibliothek, die zur Laufzeit Code erzeugt, fällt aus.

`eval` scheitert übrigens auch in der ISOLATED world, dort wegen der Manifest-V3-CSP für
Erweiterungen. Es gibt in dieser Bauform schlicht kein `eval`, nirgends.

### Cross-Origin-`fetch` aus dem Content Script scheitert

Trotz passender `host_permissions` schlug ein `fetch` auf einen fremden Host fehl, **ohne** dass eine
CSP-Meldung in der Konsole erschien. Die naheliegende Erklärung ist nicht die Seiten-CSP, sondern die
Manifest-V3-Änderung, die Cross-Origin-Anfragen aus Content Scripts in den Service Worker verlagert
hat. **[NICHT VOLLSTÄNDIG ISOLIERT]** — der Versuch trennt die beiden Ursachen nicht sauber. Praktisch
ist die Konsequenz in beiden Fällen dieselbe: Netzzugriffe der Medien-Pipeline gehören in den Service
Worker oder ins Offscreen Document, nicht ins Content Script.

## Zweiter Versuch: Speicher — trägt das Archiv?

_Gleicher Aufbau, zwei Erweiterungen: eine mit `unlimitedStorage`, eine ohne. Gemessen in einer
Extension-Page mit einem dedizierten Worker._

| Gemessen                                      | mit `unlimitedStorage` | ohne        |
| --------------------------------------------- | ---------------------- | ----------- |
| OPFS `createSyncAccessHandle()` im Worker     | **OK**                 | **OK**      |
| 256 MB am Stück geschrieben und zurückgelesen | **OK**                 | **OK**      |
| `navigator.storage.persist()`                 | **`false`**            | **`false`** |
| `navigator.storage.persisted()` danach        | `false`                | `false`     |
| gemeldetes `quota`                            | 18,7 GB                | 162,3 GB    |
| `crossOriginIsolated`                         | **`false`**            | `false`     |

**Das Gute:** Der synchrone Zugriffshandle, den SQLite-WASM zwingend braucht, funktioniert im Worker
einer Extension-Page. 256 MB gingen ohne Murren durch, `getSize()` bestätigte sie. Das Archiv ist in
dieser Bauform technisch machbar — das war vorher nur aus der Dokumentation abgeleitet.

**Das scheinbar Unangenehme:** `navigator.storage.persist()` lieferte **`false`**, auch mit
`unlimitedStorage`.

Das sieht schlimmer aus, als es ist — es ist eine Fehlspur, und die Auflösung steht im Chromium-Quelltext.
`QuotaDatabase::GetBucketsForEviction()` wählt `FROM buckets WHERE persistent = 0` und überspringt dann
ausdrücklich alles, was `special_storage_policy->IsStorageUnlimited()` erfüllt — und
`ExtensionSpecialStoragePolicy::IsStorageUnlimited()` ist für jede Erweiterung mit der Berechtigung wahr.
Der Kommentar in `special_storage_policy.h` sagt es wörtlich: _„Unlimited storage is not subject to quota
or storage pressure eviction."_ Die Eviction-Befreiung läuft also gar nicht über das Persistenz-Bit, das
`persist()` setzt. Das gemessene `false` und die Doku-Aussage widersprechen einander nicht.

Dazu die Löschwege: `DoesStorageKeyMatchMask()` verlangt für UNPROTECTED_WEB und PROTECTED_WEB ein
Web-Schema, und `chrome-extension` steht nicht in dieser Liste. **„Browserdaten löschen" und die
Enterprise-Policy `ClearBrowsingDataOnExitList` fassen das Archiv nicht an.** `DataDeleter::StartDeleting`
wird ausschließlich aus `PostUninstallExtension()` gerufen — Deaktivieren, Neuladen und Update lassen OPFS
unberührt, **Deinstallieren löscht alles**.

Trotzdem bleibt der Export auf eine echte Datei Grundausstattung und nicht Phase 6: Eine Deinstallation
ist ein Klick, und auf einem verwalteten Rechner kann sie auch von außen kommen.

Die `quota`-Zahlen sind nicht überzubewerten: Die Erweiterung **ohne** `unlimitedStorage` bekam die
größere Zahl gemeldet. Für Extension-Origins ist der Wert offenbar kein verlässlicher Indikator; er
wurde hier nur zur Vollständigkeit protokolliert.

**`crossOriginIsolated` war `false`** — aber das war der Standardfall, nicht die Obergrenze. Nachgemessen
mit den beiden Manifest-Schlüsseln `cross_origin_embedder_policy: {"value": "require-corp"}` und
`cross_origin_opener_policy: {"value": "same-origin"}`:

| Kontext                | `crossOriginIsolated` | `SharedArrayBuffer`  | geteilter `WebAssembly.Memory` |
| ---------------------- | --------------------- | -------------------- | ------------------------------ |
| **Offscreen Document** | **`true`**            | allokiert            | **geht**                       |
| Service Worker         | `false`               | vorhanden, ungenutzt | –                              |

**Damit bekommt Phase 7 echte WASM-Threads**, und der befürchtete wunde Punkt der Bauform ist keiner.
Der Service Worker bleibt außen vor — was Chrome selbst ankündigt: _„cross-origin isolation is not fully
implemented for service and shared workers currently."_ Für uns ohne Belang, weil sowohl das Archiv als
auch der Index ohnehin im Offscreen Document laufen müssen.

Die frühere Fassung dieses Dokuments schloss aus dem Standardwert auf Einkernbetrieb. Das war falsch.

## Was der Versuch **nicht** zeigt

- **IndexedDB.** `indexedDB.databases()` lieferte in beiden Welten eine leere Liste — die Messung lief
  ohne Anmeldung, WhatsApp Web hatte seine Datenbanken noch nicht angelegt. Der dokumentierte
  Chrome-Befund („In content scripts, calling web storage APIs accesses data from the host page")
  bleibt damit unwidersprochen, aber hier unbestätigt. Nachzuholen mit einem angemeldeten Profil.
- **Ob die Module auch auflösbar sind.** Dass `requireLazy` existiert, heißt noch nicht, dass sich der
  Chat-Store daraus ziehen lässt. Das braucht eine angemeldete Sitzung.
- **Metas „Code Verify".** Ob eine MAIN-world-Injektion die Integritätsprüfung auslöst, wurde nicht
  gemessen.

## Reproduzieren

```bash
node spikes/extension-csp/control-server.mjs &          # Kontrollseite auf :8731
xvfb-run -a node spikes/extension-csp/run.mjs  spikes/extension-csp   # CSP-Verhalten
xvfb-run -a node spikes/extension-csp/run2.mjs spikes/extension-csp   # Kanal, fetch, Modul-Loader
xvfb-run -a node spikes/extension-csp/run3.mjs spikes/extension-csp   # OPFS, Quota, Persistenz
xvfb-run -a node spikes/extension-csp/run4.mjs spikes/extension-csp   # Cross-Origin-Isolation
```

`run2.mjs` erwartet die Dateien aus `manifest.probe2.json` als `manifest.json`.
