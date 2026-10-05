# Die Erweiterung in die Stores bringen

Schritt für Schritt für addons.mozilla.org (Firefox), den Chrome Web Store und Microsoft Edge
Add-ons. Mit allen Links und allen Texten zum Kopieren. Stand: **5. Oktober 2026**, geprüft an den
offiziellen Seiten der drei Stores (Quellen am Ende). Die Formulare ändern sich gelegentlich; heißt
ein Feld anders, gilt der Text hier sinngemäß.

## Überblick

| Store            | Konto           | Kosten               | Prüfung                                |
| ---------------- | --------------- | -------------------- | -------------------------------------- |
| Firefox (AMO)    | Mozilla-Konto   | keine                | automatisch, meist unter 24 Stunden    |
| Chrome Web Store | Google-Konto    | einmalig 5 US-Dollar | einige Tage, selten bis zu drei Wochen |
| Edge Add-ons     | Microsoft-Konto | keine                | bis zu sieben Werktage                 |

**Empfohlene Reihenfolge:** erst Firefox (schnell, kostenlos), dann Chrome. Edge zuletzt oder gar
nicht: Edge installiert Erweiterungen auch direkt aus dem Chrome Web Store (siehe
[Edge](#3-microsoft-edge-add-ons)).

### Vorher einmal erledigen

1. **Datenschutzerklärung live schalten.** Alle drei Stores wollen eine URL. Die Seite steht in
   `site/datenschutz.html`; es fehlen nur **Name und E-Mail-Adresse** des Verantwortlichen. Sobald
   sie eingetragen und zusammengeführt ist, lautet die URL:
   `https://phish3144.github.io/watis/datenschutz.html`
2. **Eine eigene E-Mail-Adresse für die Stores** nehmen, zum Beispiel `watis@…`. Beim Chrome Web
   Store lässt sich die Adresse des Entwicklerkontos später **nicht mehr ändern**, und die
   Kontakt-Adresse ist öffentlich sichtbar.
3. **Die Dateien bereitlegen:**
   - Pakete aus dem neuesten Release:
     [WatIs-Browser-Firefox.zip](https://github.com/phish3144/watis/releases/latest/download/WatIs-Browser-Firefox.zip)
     und
     [WatIs-Browser-Chrome-Edge.zip](https://github.com/phish3144/watis/releases/latest/download/WatIs-Browser-Chrome-Edge.zip).
     **Nicht entpacken**, die Stores wollen die ZIP.
   - Bilder: `npm run store:assets` schreibt sie nach `out/store/`. Alle zeigen nur erfundene
     Beispieldaten.

     | Datei                         | Wofür                                        |
     | ----------------------------- | -------------------------------------------- |
     | `1-suche.png` … `5-hilfe.png` | Screenshots, 1280×800, in dieser Reihenfolge |
     | `kachel-klein-440x280.png`    | Chrome (Pflicht), Edge (optional)            |
     | `kachel-gross-1400x560.png`   | Chrome und Edge, optional                    |
     | `logo-300x300.png`            | Edge, Logo                                   |
     | `icon-128x128.png`            | Chrome, falls ein Store-Symbol verlangt wird |

   - Für Firefox zusätzlich der **Quelltext derselben Version**: auf der
     [Release-Seite](https://github.com/phish3144/watis/releases/latest) unter „Assets“ die Datei
     **Source code (zip)**.

---

## 1. Firefox (addons.mozilla.org)

1. **Mozilla-Konto anlegen:** <https://accounts.firefox.com/signup>. Keine Wegwerf-Adresse, die
   werden abgelehnt.
2. **Zwei-Schritt-Bestätigung einschalten.** Ohne sie lässt der Entwickler-Bereich niemanden hinein.
   In den [Kontoeinstellungen](https://accounts.firefox.com/settings) unter „Sicherheit“ eine
   Authenticator-App einrichten und die Wiederherstellungscodes aufheben.
3. **Einreichen starten:** <https://addons.mozilla.org/developers/addon/submit/>. Beim ersten Mal
   die Vereinbarung für Entwickler bestätigen.
4. **Vertriebsweg:** „Auf dieser Website“ (_On this site_) wählen. Dann steht WatIs? öffentlich auf
   addons.mozilla.org und aktualisiert sich bei allen von selbst.
5. **Datei hochladen:** `WatIs-Browser-Firefox.zip`. Als Plattform nur **Firefox für Desktop**
   anhaken, nicht Android: Die Seitenleiste gibt es dort nicht.
6. **Prüfergebnis lesen.** Erwartbar sind einige **Warnungen**, keine Fehler:
   - `KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION`: Die Angabe zur Datensammlung versteht Firefox erst ab
     140, WatIs? läuft ab 128. Harmlos; ältere Versionen ignorieren die Angabe.
   - Hinweise etwa auf `innerHTML` oder `eval` in Dateien unter `ocr/`, `whisper/` oder in
     `assets/pdf-*.js`: Das ist Code von Tesseract, whisper.cpp und pdf.js, unverändert übernommen.
7. **Quelltext:** Die Frage, ob Code erzeugt oder gebündelt wurde, mit **Ja** beantworten und die
   **Source code (zip)** derselben Version hochladen. Die Prüfer bauen damit nach; der Build ist
   reproduzierbar (Anleitung für sie: [`BUILDING.md`](../BUILDING.md)).
8. **Beschreibung ausfüllen:**
   - Name: `WatIs?`
   - Adresse (Slug): `watis`
   - Zusammenfassung: [Text A](#text-a--kurzbeschreibung)
   - Beschreibung: [Text B](#text-b--beschreibung) (Englisch zusätzlich: [Text C](#text-c--english-description))
   - Kategorien (höchstens zwei): **Social & Communication** und **Search Tools** (in der deutschen
     Oberfläche entsprechend übersetzt)
   - Support-E-Mail: die Store-Adresse aus „Vorher“
   - Support-Website: `https://github.com/phish3144/watis/issues`
   - Homepage: `https://phish3144.github.io/watis/`
   - Lizenz: **MIT**
   - „Experimentell“ und „Erfordert Bezahlung“: nicht anhaken
   - Datenschutzerklärung: verlangt Firefox nur, wenn Daten das Gerät verlassen. Sie steht trotzdem
     am Ende der Beschreibung (Text B).
9. **Anmerkungen für Prüfer:** [Text G](#text-g--notes-for-reviewers).
10. **Einreichen.** Firefox signiert und veröffentlicht automatisch, meist innerhalb von 24 Stunden.
    Eine Prüfung durch Menschen kann auch später noch kommen.
11. **Screenshots nachtragen:** In der Verwaltung des Add-ons unter „Eintrag bearbeiten“ die fünf
    Screenshots hochladen (1280×800, Reihenfolge wie die Dateinamen).

Danach steht WatIs? unter `https://addons.mozilla.org/de/firefox/addon/watis/`.

> **Zur Datensammlung:** Das Manifest sagt Firefox „sammelt keine Daten“
> (`data_collection_permissions: none`). Das stimmt nach Mozillas Definition: Gemeint ist, was
> den Browser verlässt. Der Chrome Web Store zählt dagegen auch, was nur lokal verarbeitet wird.
> Deshalb wird dort unten mehr angekreuzt. Beides ist richtig.

---

## 2. Chrome Web Store

1. **Google-Konto** (am besten das mit der eigenen Store-Adresse) mit
   **Bestätigung in zwei Schritten**:
   <https://myaccount.google.com/signinoptions/two-step-verification>. Ohne sie lässt sich nichts
   veröffentlichen.
2. **Als Entwickler registrieren:** <https://chrome.google.com/webstore/devconsole/>. Vereinbarung
   bestätigen, **5 US-Dollar** einmalig bezahlen (Karte über Google Payments).
3. **Konto einrichten** (Seite „Konto“ im Dashboard):
   - Name des Herausgebers: der Name, der im Store unter WatIs? stehen soll
   - Kontakt-E-Mail eintragen und über den zugeschickten Link bestätigen
4. **Händler-Erklärung (EU):** **Kein Händler** (_Non-Trader_) wählen, wenn WatIs? privat und
   ohne Einnahmen bleibt.
   - Dann werden weder Anschrift noch Telefonnummer veröffentlicht.
   - Im Eintrag steht dafür der Hinweis, dass Verbraucherrechte aus Verträgen mit dir nicht
     gelten.
   - Ob du Händler bist, musst du selbst beurteilen; Google entscheidet das nicht für dich.
5. **Neues Element:** „Neues Element hinzufügen“ → `WatIs-Browser-Chrome-Edge.zip` hochladen.
   Name, Kurzbeschreibung und Version kommen aus dem Paket und sind danach fest. Ändern geht nur
   mit einer neuen Version.
6. **Reiter „Store-Eintrag“:**
   - Beschreibung: [Text B](#text-b--beschreibung)
   - Kategorie: **Kommunikation** (_Communication_)
   - Sprache: **Deutsch**
   - Store-Symbol, falls verlangt: `icon-128x128.png`
   - Screenshots: `1-suche.png` bis `5-hilfe.png` (höchstens fünf)
   - Kleine Werbekachel (Pflicht): `kachel-klein-440x280.png`
   - Marquee (optional): `kachel-gross-1400x560.png`
   - Startseite: `https://phish3144.github.io/watis/`
   - Support-URL: `https://github.com/phish3144/watis/issues`
   - Inhalte für Erwachsene: nein
7. **Reiter „Datenschutz“:**
   - Einziger Zweck: [Text D](#text-d--single-purpose)
   - Begründung je Berechtigung: [Text E](#text-e--permission-justifications)
   - Remote-Code: **„Nein, ich verwende keinen Remote-Code“**
   - Datennutzung: die Kästchen aus [Text F](#text-f--datennutzung) anhaken, dazu alle drei
     Bestätigungen
   - Datenschutzerklärung: `https://phish3144.github.io/watis/datenschutz.html`

   Der Chrome Web Store verlangt außerdem eine Erklärung zur „eingeschränkten Nutzung“ (_Limited
   Use_) auf der Startseite oder einen Klick davon entfernt. Sie steht im Fuß der Landing Page.

8. **Reiter „Vertrieb“:**
   - Kostenlos
   - Sichtbarkeit: **Öffentlich**, oder erst **Nicht gelistet**, wenn du ihn vorher selbst testen
     willst (nur über den Link installierbar, gleiche Prüfung)
   - Regionen: alle
9. **Reiter „Testanleitung“** (optional): [Text G](#text-g--notes-for-reviewers).
10. **Zur Überprüfung einreichen.** Wer erst nach der Freigabe selbst veröffentlichen will, entfernt
    im Dialog den Haken bei „automatisch veröffentlichen“; dann bleiben 30 Tage dafür. Neue
    Entwickler werden gründlicher geprüft; einige Tage sind normal.
11. **Nach der Freigabe:** Im Reiter „Paket“ auf **Öffentlichen Schlüssel ansehen** klicken und mir
    den Text schicken. Ich trage ihn ins Manifest ein. Dann hat die entpackte Fassung dieselbe
    Kennung wie die aus dem Store, und das Archiv bleibt beim Wechsel erhalten.

---

## 3. Microsoft Edge Add-ons

**Vorab: Lohnt sich der eigene Eintrag?** Edge-Nutzer können WatIs? direkt aus dem Chrome Web Store
installieren. Edge fragt einmal, ob es **„Erweiterungen aus anderen Stores zulassen“** soll, dann
geht es mit einem Klick. Ein eigener Edge-Eintrag lohnt sich vor allem für Firmenrechner, auf denen
die IT nur den Edge-Store freigibt.

**Bekanntes Risiko:** Edge verlangt, dass eine Erweiterung **keine anderen Browser erwähnt**
(Richtlinie 1.1.2). Die eingebaute Hilfe von WatIs? erklärt aber auch Chrome und Firefox. Das kann
zur Ablehnung führen. Vor dem Einreichen kann ich die Hilfe so umbauen, dass sie nur den Browser
zeigt, in dem sie läuft.

1. **Microsoft-Konto:** ein privates (Outlook, Hotmail, Live) oder ein GitHub-Konto. Mit Arbeits-
   oder Schulkonten geht es nicht. Neu anlegen: <https://signup.live.com/>
2. **Registrieren:** <https://partner.microsoft.com/dashboard/microsoftedge/public/login> →
   „Registrieren“.
   - Kontotyp: **Einzelperson**. Das lässt sich später nicht ändern; „Unternehmen“ verlangt eine
     Firmenprüfung über Tage bis Wochen.
   - Land: **Deutschland**. Auch das lässt sich später nicht ändern.
   - Anzeigename des Herausgebers (höchstens 50 Zeichen)
3. **Neue Erweiterung erstellen:** `WatIs-Browser-Chrome-Edge.zip` hochladen (dieselbe Datei wie
   für Chrome).
4. **Verfügbarkeit:** Sichtbarkeit **Öffentlich**, Märkte: alle.
5. **Eigenschaften:**
   - Kategorie: **Kommunikation**, falls angeboten, sonst **Produktivität**
   - Website: `https://phish3144.github.io/watis/`
   - Support: die Store-Adresse
   - Inhalte für Erwachsene: nein
6. **Datenschutz:**
   - Einziger Zweck: [Text D](#text-d--single-purpose)
   - Begründungen: [Text E](#text-e--permission-justifications)
   - Remote-Code: nein
   - Datennutzung: wie bei Chrome, [Text F](#text-f--datennutzung)
   - Datenschutzerklärung: `https://phish3144.github.io/watis/datenschutz.html`. Sie nennt bewusst
     keinen Browser: Edge verlangt, dass sie sich nicht auf andere Browser bezieht.
7. **Store-Einträge → Deutsch:**
   - Beschreibung: [Text B](#text-b--beschreibung). Edge verlangt 250 bis 10.000 Zeichen; Text B
     nennt keinen anderen Browser.
   - Logo: `logo-300x300.png`
   - Kleine Werbekachel: `kachel-klein-440x280.png`
   - Große Werbekachel: `kachel-gross-1400x560.png`
   - Screenshots: `1-suche.png` bis `5-hilfe.png`
   - Suchbegriffe (höchstens sieben): `Chat-Archiv`, `Volltextsuche`, `Nachrichten suchen`,
     `Texterkennung`, `Sprachnachrichten`, `Backup`, `Archiv`
8. **Anmerkungen für die Zertifizierung:** [Text G](#text-g--notes-for-reviewers). Edge verlangt
   ausdrücklich ein Testkonto **oder** eine Begründung, warum es keines gibt; Text G enthält sie.
9. **Veröffentlichen.** Die Prüfung dauert bis zu sieben Werktage.

---

## Nach der Freischaltung

- **Schick mir die Links** zu den Einträgen. Ich stelle Landing Page, Hilfe und README auf „ein
  Klick im Store“ um.
- **Bisherige Nutzer müssen einmal umziehen.** Chrome und Edge geben der Store-Fassung eine andere
  Kennung als der entpackten, also startet sie mit leerem Archiv. Der Weg:
  1. in der alten Fassung **Einstellungen → Archiv und Sicherung → Als ZIP herunterladen**
  2. die Store-Fassung installieren
  3. dort **Sicherung zurückspielen → ZIP-Dateien wählen …**
  4. die alte Fassung entfernen

  In Firefox bleibt die Kennung gleich; vorher sichern schadet trotzdem nicht.

- **Updates:** Jede neue Version muss in jeden Store hochgeladen werden: dieselben ZIPs, im
  jeweiligen Dashboard „Neue Version“ bzw. „Paket aktualisieren“. Die Nutzer bekommen sie dann
  automatisch. Das lässt sich später in den Release-Workflow einbauen; die Stores haben dafür
  Schnittstellen mit API-Schlüsseln.

## Risiken, die du kennen solltest

- **Der Name.**
  - Die Markenrichtlinien von WhatsApp verbieten fremden Produkten Namen, die eine Abwandlung oder
    lautliche Anlehnung an „WhatsApp“ sind.
  - „WatIs?“ kann so gelesen werden. Ein Store kann den Eintrag deshalb ablehnen, oder Meta kann
    später eine Beschwerde einreichen.
  - Die Texte hier nennen WhatsApp nur, um zu sagen, wofür WatIs? ist, und stellen klar, dass es
    keine Verbindung gibt. Die Bilder zeigen weder das WhatsApp-Logo noch den Namen.
  - Ob du das Risiko eingehst oder für die Stores einen anderen Namen willst, entscheidest du.
- **Ein Testkonto gibt es nicht.** Prüfer brauchen ein eigenes WhatsApp-Konto. Text G erklärt das.
  Ein Prüfer kann trotzdem nachfragen.
- **Bei Chrome sind neue Entwickler langsamer.** Die erste Prüfung kann länger dauern als spätere.

---

## Texte zum Kopieren

Die Texte für die Nutzer sind deutsch. Die Texte für die Prüfer sind englisch, weil Prüfer sie lesen.

### Text A – Kurzbeschreibung

Für Firefox (höchstens 250 Zeichen; dieser hat 218):

```text
Lokales, durchsuchbares Archiv für WhatsApp Web: Volltextsuche über alle Chats, Text in Bildern und PDFs, Sprachnachrichten als Text, Medien dauerhaft sichern. Kein Konto, kein Server – alles bleibt auf deinem Rechner.
```

Chrome und Edge nehmen die Kurzbeschreibung aus dem Paket (120 von 132 Zeichen):

```text
Lokales, durchsuchbares Archiv für WhatsApp Web – Volltextsuche, Medien, Texterkennung. Alles bleibt auf diesem Rechner.
```

### Text B – Beschreibung

```text
WatIs? macht WhatsApp Web durchsuchbar. Was du in WhatsApp Web siehst, kommt in ein Archiv auf deinem Rechner – und bleibt dort.

SUCHEN
• Volltextsuche über alle Chats, mit Umlauten in beiden Schreibweisen (Grüße findet auch Gruesse)
• Eingrenzen nach Absender, Chat und Zeitraum: von:, in:, vor:, nach:, hat:
• Text in Bildern und eingescannten PDFs wird erkannt und ist mit durchsuchbar
• Sprachnachrichten mit einem Klick als Text, berechnet auf deinem Rechner. Das Sprachmodell (57 MB) wird beim ersten Mal auf deinen Klick geladen.
• Jeder Treffer zeigt den Verlauf drumherum

ARCHIVIEREN
• Bilder, Dokumente und Sprachnachrichten dauerhaft sichern, bevor WhatsApp sie von seinen Servern nimmt
• Nachrichten, die für alle gelöscht werden, bleiben im Archiv, wenn WatIs? sie vorher schon gesehen hat
• Sicherung in einen Ordner deiner Wahl, auch OneDrive oder Nextcloud, oder als ZIP – und auf demselben Weg zurück
• Zähler und Benachrichtigungen für neue Nachrichten, gebündelt und mit Ruhezeit

PRIVAT
• Kein Konto, kein Server, keine Telemetrie. Deine Nachrichten verlassen deinen Rechner nicht.
• Texterkennung und Transkription laufen lokal.
• WatIs? liest nur mit. Es sendet nichts, löscht nichts und markiert nichts als gelesen.
• Quelloffen unter der MIT-Lizenz: https://github.com/phish3144/watis

SO GEHT'S
1. WhatsApp Web öffnen und wie gewohnt anmelden.
2. Das Archiv füllt sich von selbst, solange der Tab offen ist.
3. Über das WatIs?-Symbol in der Symbolleiste suchen.

Die Oberfläche ist deutsch. Eine Hilfe ist eingebaut und funktioniert ohne Internet.

Datenschutz: https://phish3144.github.io/watis/datenschutz.html

WatIs? ist kein offizielles WhatsApp-Produkt und steht in keiner Verbindung zu WhatsApp oder Meta. WhatsApp ist eine Marke von Meta Platforms, Inc.
```

### Text C – English description

Optional, als zweite Sprache bei Firefox.

```text
WatIs? makes WhatsApp Web searchable. What you see in WhatsApp Web goes into an archive on your own computer – and stays there.

SEARCH
• Full-text search across all chats
• Narrow down by sender, chat and date (search keywords in German or English)
• Text in pictures and scanned PDFs is recognised and searchable too
• Voice messages as text with one click, computed on your computer. The speech model (57 MB) is downloaded once, on your click.
• Every hit shows the conversation around it

ARCHIVE
• Keep pictures, documents and voice messages before WhatsApp removes them from its servers
• Messages deleted for everyone stay in the archive if WatIs? saw them before
• Back up into a folder of your choice, OneDrive or Nextcloud included, or as ZIP – and restore the same way
• Badge and notifications for new messages, grouped and with quiet hours

PRIVATE
• No account, no server, no telemetry. Your messages never leave your computer.
• Text recognition and transcription run locally.
• WatIs? only reads. It never sends, deletes or marks anything as read.
• Open source under the MIT licence: https://github.com/phish3144/watis

The interface is in German.

Privacy policy: https://phish3144.github.io/watis/datenschutz.html

WatIs? is not an official WhatsApp product and is not affiliated with WhatsApp or Meta. WhatsApp is a trademark of Meta Platforms, Inc.
```

### Text D – Single purpose

```text
WatIs? builds a local, searchable archive of the chats the user sees in WhatsApp Web. Every feature serves that one purpose: keeping messages and attachments on the user's own device and finding them again (full-text search, text recognition in pictures and PDFs, transcription of voice messages, backup and restore).
```

### Text E – Permission justifications

| Berechtigung                      | Begründung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                         | `Stores the user's settings and the extension's own state, such as whether the archive is running and when the last backup was made.`                                                                                                                                                                                                                                                                                                                                                                                                          |
| `unlimitedStorage`                | `The archive is a local SQLite database plus the attachments the user keeps (pictures, documents, voice messages), stored in the extension's origin-private file system. It can grow to several gigabytes; the user sets an upper limit in the settings.`                                                                                                                                                                                                                                                                                      |
| `notifications`                   | `Shows a system notification for new WhatsApp messages, grouped and with quiet hours. The user can switch it off in the settings.`                                                                                                                                                                                                                                                                                                                                                                                                             |
| `downloads`                       | `Saves a backup of the archive as ZIP files, and single attachments, to the Downloads folder – each time because the user clicked.`                                                                                                                                                                                                                                                                                                                                                                                                            |
| `sidePanel` (nur Chrome und Edge) | `Shows the archive (search, chats, media, settings) in the side panel next to WhatsApp Web.`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Host-Berechtigungen               | `https://web.whatsapp.com/* – the single purpose is archiving what WhatsApp Web shows. The content scripts read messages and attachments there and hand them to the local archive; the extension runs on no other site. Optional, requested only when the user clicks to download the speech model for transcription: github.com, objects.githubusercontent.com and release-assets.githubusercontent.com, from which the model file (weights, no code) is fetched from this project's GitHub releases and checked against a SHA-256 checksum.` |

### Text F – Datennutzung

Für Chrome und Edge. Diese Kästchen anhaken; die Bezeichnungen können in der deutschen Oberfläche
leicht anders lauten:

| Datentyp                                                                       | Anhaken? | Warum                                                              |
| ------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------ |
| Personenbezogene Daten (_Personally identifiable information_)                 | **ja**   | Namen und Telefonnummern von Kontakten, wie WhatsApp Web sie zeigt |
| Persönliche Kommunikation (_Personal communications_)                          | **ja**   | die Nachrichten und Anhänge selbst                                 |
| Website-Inhalte (_Website content_)                                            | **ja**   | Text, Bilder und Dateien von web.whatsapp.com                      |
| Gesundheit, Finanzen, Authentifizierung, Standort, Webverlauf, Nutzeraktivität | nein     | –                                                                  |

Dazu alle drei Bestätigungen anhaken:

- Daten werden nicht verkauft oder weitergegeben.
- Sie werden nicht für Zwecke außerhalb des einzigen Zwecks verwendet.
- Sie werden nicht zur Bonitätsprüfung verwendet.

Angekreuzt wird auch, was nur lokal bleibt: Der Chrome Web Store zählt ausdrücklich auch Daten, die
nur auf dem Gerät verarbeitet werden.

### Text G – Notes for reviewers

Für alle drei Stores; bei Firefox „Notes for Reviewers“, bei Chrome „Testanleitung“, bei Edge
„Notes for certification“.

```text
WatIs? archives what the user sees in WhatsApp Web, locally, and makes it searchable.

HOW TO TEST
1. Install the extension.
2. Open https://web.whatsapp.com and log in with any WhatsApp account (scan the QR code with a phone).
3. Click the toolbar icon: the side panel opens. Search for a word from one of the chats.

TEST ACCOUNT
We cannot provide one: a WhatsApp account is bound to a phone number and to personal messages. Without logging in, the panel still opens and shows the empty archive, the settings and the built-in help. The repository contains end-to-end tests that run this exact package against a stand-in WhatsApp Web page (npm run test:extension).

PRIVACY
Nothing is transmitted: no server, no analytics, no account. All data stays in the extension's local storage. The only other network access is optional: on the user's click, the extension requests the optional host permission for GitHub and downloads a speech model (weights, no code) from this project's releases.

READ-ONLY
The extension never sends, deletes or marks messages as read.

SOURCE AND BUILD
https://github.com/phish3144/watis – build instructions in BUILDING.md: npm ci && npm run build:extension (Node 24). The build is reproducible. Our own code is bundled with Vite and not minified. The minified files in ocr/ and whisper/ and the WebAssembly are copied unmodified from the npm packages tesseract.js 7.0.0, tesseract.js-core 7.0.0, pdfjs-dist 6.3.289, @transcribe/shout 1.0.7 and @sqlite.org/sqlite-wasm 3.53.4-build2, as pinned in package-lock.json.
```

---

## Quellen

Alle am 5. Oktober 2026 gelesen.

- Chrome Web Store:
  - [Registrieren](https://developer.chrome.com/docs/webstore/register)
  - [Veröffentlichen](https://developer.chrome.com/docs/webstore/publish)
  - [Bilder](https://developer.chrome.com/docs/webstore/images)
  - [Reiter Datenschutz](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
  - [Nutzerdaten-FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
  - [Händler-Erklärung](https://developer.chrome.com/docs/webstore/program-policies/trader-disclosure)
  - [Zwei-Schritt-Pflicht](https://developer.chrome.com/docs/webstore/program-policies/two-step-verification)
  - [Prüfung](https://developer.chrome.com/docs/webstore/review-process)
  - [Schlüssel im Manifest](https://developer.chrome.com/docs/extensions/reference/manifest/key)
- Edge:
  - [Konto](https://learn.microsoft.com/de-de/microsoft-edge/extensions/publish/create-dev-account)
  - [Veröffentlichen](https://learn.microsoft.com/de-de/microsoft-edge/extensions/publish/publish-extension)
  - [Richtlinien](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies)
  - [Aus anderen Stores installieren](https://support.microsoft.com/de-de/microsoft-edge/add-turn-off-or-remove-extensions-in-microsoft-edge-9c0ec68c-2fbc-2f2c-9ff0-bdc76f46b026)
- Firefox:
  - [Einreichen](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)
  - [Quelltext](https://extensionworkshop.com/documentation/publish/source-code-submission/)
  - [Fremdbibliotheken](https://extensionworkshop.com/documentation/publish/third-party-library-usage/)
  - [Datensammlung im Manifest](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
  - [Richtlinien](https://extensionworkshop.com/documentation/publish/add-on-policies/)
- WhatsApp: [Markenrichtlinien](https://www.meta.com/brand/resources/whatsapp/whatsapp-brand/)
