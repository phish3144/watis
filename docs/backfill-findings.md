# Backfill – empirische Befunde

> PLAN.md Phase 5 verlangt dieses Dokument. Es steht hier früher als geplant, weil der Befund die
> Phase in ihrer bisherigen Form aufhebt.

**Stand:** 2026-08-30 · **WA-Web-Client-Revision:** `1046383797`

---

## Kurzfassung

**WhatsApp Web lädt maximal 90 Tage Historie nach.** Die Grenze ist client-konstant, nicht
handyabhängig, und mit legitimen Mitteln nicht anhebbar. Der Massenpfad („full history sync on demand")
existiert im Web-Client nicht – er wirft eine Exception.

Damit ist die Annahme aus PLAN.md §1 („Backfill füllt Archiv chatweise so weit, wie das Handy liefert")
falsch, und die Entscheidung aus ADR 0001 Punkt 10 („Default 12 Monate") unerreichbar.

---

## Beweiskette

Alle drei Schritte am 2026-08-30 selbst abgerufen und geprüft, nicht aus zweiter Hand übernommen.

### 1. Der Gatekeeper ist für Web-Clients aus

`https://web.whatsapp.com/`, abgerufen mit einem regulären Chrome-User-Agent samt Client-Hint-Headern
(ohne die Header antwortet der Server mit HTTP 400 – das ist der Grund, warum mehrere Rechercheläufe die
Seite zunächst für unerreichbar hielten):

```bash
$ curl -sS --compressed \
    -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 … Chrome/152.0.0.0 …' \
    -H 'sec-ch-ua: "Chromium";v="152", "Not?A_Brand";v="24"' \
    -H 'sec-ch-ua-platform: "Windows"' -H 'Sec-Fetch-Dest: document' … \
    https://web.whatsapp.com/ -o index.html
status=200 bytes=85583

$ grep -oE '"4112":\{[^}]*\}' index.html
"4112":{"result":false,"hash":null}
"4112":{"result":false,"hash":null}
```

### 2. Dieses Flag ist `isWindows`

Aus dem ausgelieferten Bundle (`static.whatsapp.net/rsrc.php/…`), wörtlich:

```js
__d("WAWebEnvironment", ["WAWebPwaDocumentMetadataUtils", "gkx"], function (t, n, r, o, a, i, l) {
  var e = r("gkx")("4112"),        // ← das Flag von oben: false
      s = !e,
      u = r("gkx")("10314")
  function m() {
    return e ? "win_hybrid"
      : o("WAWebPwaDocumentMetadataUtils").isCurrentWebSessionInsidePwa() ? "pwa"
      : "web"
  }
  var p = { isWeb: s, isWindows: e, … }
```

`isWindows` ist also kein Plattformtest, sondern ein serverseitig gesetzter Schalter. Er unterscheidet
die native Windows-Hybrid-App von allem, was über den Browser-Einstiegspunkt kommt – und ein
Electron-Wrapper kommt über den Browser-Einstiegspunkt.

### 3. Daran hängt die Historien-Grenze

```js
__d("WAWebHistorySyncUtils",
  ["WATimeUtils","WAWebABProps","WAWebChatConstants","WAWebEnvironment",
   "WAWebPrimaryFeaturesModel","WAWebSyncGatingUtils"],
  function (t, n, r, o, a, i, l) {
    function e() {
      if (!r("WAWebEnvironment").isWindows)
        return 90 * o("WATimeUtils").DAY_SECONDS          // ← wir landen hier
      if (o("WAWebPrimaryFeaturesModel").PrimaryFeatures.extendedHistorySyncOnDemand
          && o("WAWebSyncGatingUtils").isOnDemandExtendedHistorySyncForHybridEnabled()) {
        var e = o("WAWebABProps").getABPropConfigValue(
                  "history_sync_on_demand_time_boundary_days_desktops")
        return e * o("WATimeUtils").DAY_SECONDS
      }
      return o("WATimeUtils").YEAR_SECONDS               // native Windows-App: ein Jahr
    }
    … l.getEarliestHistorySyncDate = e
```

### 4. Der Massenpfad wirft

```js
case o("WAWebProtobufsE2E.pb").Message$PeerDataOperationRequestType.FULL_HISTORY_SYNC_ON_DEMAND:
  throw r("err")("full history sync on demand is not supported in web")
```

und an anderer Stelle:

```js
o('WALogger').WARN('full history sync on demand not supported in web')
```

---

## Unabhängige Bestätigung

Die Dokumentation der mautrix-WhatsApp-Bridge beschreibt dasselbe aus anderer Richtung: „The amount of
history sent by the phone depends on what the linked device requests: web clients request 3 months, while
desktop clients request 1 year."

Drei Monate und 90 Tage sind nah beieinander, aber nicht identisch. Deshalb gilt: **die 90 nicht hart
kodieren.** Zur Laufzeit `getEarliestHistorySyncDate()` auslesen und dem Nutzer das tatsächlich
erreichbare Datum anzeigen.

---

## Was das für den Plan bedeutet

| Bisherige Annahme                                        | Realität                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| „so weit, wie das Handy liefert" (§1)                    | so weit, wie der **Web-Client anfragt** – 90 Tage               |
| „Default 12 Monate" (ADR 0001, Punkt 10)                 | unerreichbar; 90 Tage sind die Decke, nicht der Default         |
| „Fünf lange Chats vollständig nachgeladen" (DoD Phase 5) | nicht erfüllbar                                                 |
| „Eine drei Jahre alte Nachricht finden" (DoD Phase 4)    | nur für Nachrichten, die seit der Installation aufgelaufen sind |

Was **bleibt**, und was der offizielle Client nicht kann: Ab dem Installationstag wächst das Archiv
lückenlos und dauerhaft mit – ohne 90-Tage-Fenster, ohne „Nutze dein Telefon für ältere Nachrichten",
mit Volltextsuche über alles. Der Wert verschiebt sich von „Vergangenheit einsammeln" zu „ab jetzt geht
nichts mehr verloren".

## Geprüft und verworfen

`gkx("4112")` zu fälschen bzw. `WAWebEnvironment.isWindows` zu überschreiben, würde die Grenze auf ein
Jahr heben. Das ist **ein Schreibzugriff in WhatsApps Internals** und verstößt gegen die Read-only-Regel
aus CLAUDE.md. Es würde dem Handy beim Verknüpfen zudem eine falsche Plattform melden. Der Vollständigkeit
halber steht es hier, damit es in sechs Monaten nicht erneut als Idee auftaucht.

## Offen

| Frage                                                                       | Warum offen                                 | Wie zu klären                                    |
| --------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------ |
| Wirkt die 90-Tage-Grenze als Anfrage-Anker oder als serverseitiger Schnitt? | Aus minifiziertem Code nicht unterscheidbar | Spike mit einem Konto, das älter als 90 Tage ist |
| Wie viel liefert der reguläre Sync beim Verknüpfen tatsächlich?             | Nie mit echtem Konto gemessen               | Derselbe Spike                                   |
| Lässt sich pro Chat inkrementell tiefer nachziehen, und wie weit?           | Ungeprüft                                   | Derselbe Spike                                   |
