# ADR 0001 – Offene Entscheidungen aus PLAN.md §10

- **Status:** akzeptiert
- **Datum:** 2026-08-30
- **Kontext:** PLAN.md §10 listet zwölf Punkte, die vor Phase 0 zu klären sind. §12 verlangt, sie zu
  klären statt zu raten. Dieses ADR hält die Antworten fest; PLAN.md §10 verweist hierher.

---

## 1. Ziel-OS und Adminrechte

**Entscheidung (bereits im Plan getroffen):** Windows 10/11 x64 ist das Release-Ziel. macOS (arm64 + x64)
wird ab Phase 0 mitgebaut und ist Pflicht-Check in CI, auch wenn es später veröffentlicht wird. Linux ist
nicht geplant, wird aber durch keine Entscheidung ausgeschlossen. Installation, Betrieb, Auto-Update und
Deinstallation laufen ohne Administratorrechte.

## 2. Archiv-Verschlüsselung

**Entscheidung:** Klartext als Default, aber die Datenbankanbindung liegt hinter einem Interface, sodass
ein späterer Umstieg auf `better-sqlite3-multiple-ciphers` (SQLCipher) **ohne Schema-Migration** möglich
bleibt.

**Konsequenzen:**

- Phase 0/3 nimmt `better-sqlite3` als Abhängigkeit, nicht die Ciphers-Variante.
- Es gibt keinen `PRAGMA key`-Aufruf im Feature-Code; das Öffnen der Datenbank läuft über eine einzige
  Fabrikfunktion, die die Verschlüsselung später ergänzen kann.
- Der Schutz ruht bis dahin auf der OS-Verschlüsselung (BitLocker/FileVault). Das steht so im README.

## 3. Medien-Archiv: was wird automatisch geholt?

**Entscheidung:**

| Medientyp                                           | Verhalten                                                    |
| --------------------------------------------------- | ------------------------------------------------------------ |
| Bilder                                              | immer automatisch                                            |
| Dokumente (PDF, DOCX, TXT/MD/CSV, sonstige Anhänge) | immer automatisch                                            |
| Videos                                              | **nur auf Klick**                                            |
| Sprachnachrichten                                   | **nicht automatisch** – auf Klick holbar und transkribierbar |
| Sticker, GIFs                                       | nicht automatisch (klein, aber wertlos für den Index)        |

**Konsequenzen:**

- Es gibt kein Hintergrund-Backlog für Sprachnachrichten. Der Whisper-Sidecar ist damit ein
  On-Demand-Werkzeug, kein Dauerläufer (siehe Punkt 4).
- Sprachnachrichten werden trotzdem als Metadaten (Dauer, Absender, Zeit) im Archiv geführt, damit ein
  späteres Nachholen möglich bleibt, solange WhatsApp die Medien noch vorhält.
- Ein Größenlimit pro Dokument wird in Phase 3 festgelegt (Vorschlag: > 50 MB nur auf Klick).

## 4. Transkription

**Entscheidung:** whisper.cpp bleibt im Projekt, läuft aber **on demand** statt als Backlog-Verarbeitung.
Der Nutzer klickt „Transkribieren" an einer Sprachnachricht; die Datei wird geholt, transkribiert, und das
Transkript landet mit Zeitmarken durchsuchbar im Archiv.

**Offen:** Modellgröße und ob GPU genutzt wird. Weil keine Massenlast anfällt, verschiebt sich die Abwägung
in Richtung Genauigkeit statt Geschwindigkeit. Wird nach dem Technik-Recon entschieden und hier ergänzt.

**Konsequenzen:**

- Der Modell-Download passiert erst beim ersten Transkriptionswunsch, nicht beim ersten Start.
- Die Leerlauf-Steuerung aus §3.1 gilt weiterhin für OCR und Dokumenttext, für die Transkription aber
  nicht – wer klickt, will das Ergebnis jetzt.

## 5. Repo-Name und Lizenz

**Entscheidung:**

| Ebene                                                | Wert                         |
| ---------------------------------------------------- | ---------------------------- |
| Repository                                           | `phish3144/watis`            |
| npm/Paketname, Ordner, AppUserModelId                | `watis`                      |
| `productName` (Installer, Startmenü, Programmordner) | `WatIs`                      |
| Anzeigename in UI, Fenstertitel, Über-Dialog         | `WatIs?`                     |
| Lizenz                                               | MIT, öffentliches Repository |

**Begründung für die Namenstrennung:** `?` ist unter Windows in Datei- und Ordnernamen verboten
(`<>:"/\|?*`). Ein `productName` mit Fragezeichen würde Installationspfad, Verknüpfung und
Deinstallationseintrag brechen. Das Fragezeichen lebt deshalb ausschließlich in Strings, die nie in einen
Pfad geraten.

**Konsequenzen:**

- Alle Abhängigkeiten werden auf MIT-Verträglichkeit geprüft, bevor sie aufgenommen werden. Das betrifft
  besonders OCR-Modelle und whisper.cpp-Modelldateien, deren Lizenz von der des Codes abweichen kann.
- Das README trägt einen ehrlichen Disclaimer: kein offizielles WhatsApp-Produkt, keine Verbindung zu Meta,
  Nutzung auf eigenes Risiko.
- Keine Secrets, keine privaten Daten, keine Fixtures mit echten Nachrichten im Repository.

## 6. Standard-Downloadordner

**Entscheidung:** `~/Downloads/WhatsApp/<Chatname>/<YYYY-MM-DD>_<Originalname>`, konfigurierbar.

**Begründung:** Bleibt im gewohnten Download-Ordner, stört keine bestehenden Backup- oder Sync-Regeln und
fällt auf einem verwalteten Gerät nicht als neuer Ordner im Benutzerprofil auf.

## 7. OCR-Bibliothek

**Offen – bewusst.** Die Wahl zwischen den PP-OCRv5-Ports fällt nach einem Spike gegen das Fixture-Set
(§8). Bis dahin gilt: OCR wird ausschließlich hinter dem Engine-Interface angesprochen, sodass die
Entscheidung reversibel bleibt. `tesseract.js` ist der dokumentierte Fallback.

## 8. Dateitypen im Inhaltsindex

**Entscheidung:** PDF, DOCX, TXT, MD, CSV – **plus gescannte PDFs durch die OCR** (Seiten ohne Textebene
werden gerendert und erkannt).

**Nicht enthalten:** XLSX und PPTX. Beides bleibt technisch möglich – das Extractor-Interface ist
typoffen –, wird aber nicht gebaut, solange es niemand vermisst.

## 9. Blob-Store und Modelle

**Entscheidung:** Systemlaufwerk, `%LOCALAPPDATA%\watis\blobs` bzw. `~/Library/Application Support/watis/blobs`.
Startquote **20 GB**, Warnung ab 80 % der Quote, harter Stopp mit Hinweis bei 100 %. Der Speicherort ist in
der Config änderbar und wird mit Fortschrittsanzeige und Hash-Verifikation verschoben.

**Begründung:** Zielrechner ist ein verwaltetes Gerät, dessen Systemlaufwerk klein sein kann. 20 GB ist ein
Wert, bei dem eine Warnung noch rechtzeitig kommt.

## 10. Backfill-Tiefe

**Entscheidung:** Default **12 Monate für alle Chats**, pro Chat manuell auf „komplett" oder einen anderen
Zeitraum erweiterbar. Direktchats und markierte Gruppen laufen zuerst.

**Vorbehalt:** Die tatsächliche Obergrenze setzt WhatsApp Web, nicht die Konfiguration. Wie weit das
Nachladen im Multi-Device-Modus überhaupt reicht, wird empirisch ermittelt und in
`docs/backfill-findings.md` dokumentiert. Fällt die Empirie schlecht aus, ist die Zahl hier Makulatur –
das ist eingeplant, nicht überraschend.

## 11. Windows-Signierung

**Entscheidung:** Unsigniert. Die SmartScreen-Warnung wird akzeptiert und der Klickweg
(„Weitere Informationen → Trotzdem ausführen", kein Adminrecht nötig) im README dokumentiert.

**Vorbehalt:** Siehe Punkt 12. Blockiert AppLocker auf dem Zielrechner die Ausführung aus
`%LOCALAPPDATA%`, hilft kein Klickweg. Dann wird die Entscheidung neu aufgemacht – aber in Phase 0, nicht
in Phase 9.

## 12. Zielrechner

**Entscheidung:** **Verwalteter Firmenrechner.** Damit wird aus einer Vorsichtsmaßnahme eine harte
Anforderung:

- Der Installer-Test in Phase 0 läuft auf dem echten Zielgerät, mit einem Standardbenutzer-Konto,
  bevor irgendetwas anderes gebaut wird. Er prüft: Installation ohne UAC, Start, Auto-Update,
  Deinstallation – und ob AppLocker/SRP die Ausführung aus `%LOCALAPPDATA%\Programs\WatIs` zulässt.
- `userData` und `sessionData` werden vor `app.whenReady()` nach `%LOCALAPPDATA%` gezwungen. Ein Roaming-
  Profil, das Gigabytes synchronisiert, ist auf einem Domänen-Konto kein theoretisches Risiko.
- Kein lauschender Port im gesamten Projekt – ein Firewall-Prompt bräuchte Adminrechte.

**Ehrlicher Hinweis, kein Blocker:** Ein Werkzeug, das sämtliche WhatsApp-Nachrichten in eine lokale
Datenbank spiegelt, auf einem verwalteten Firmengerät – das kann mit der IT-Richtlinie des Arbeitgebers
kollidieren, unabhängig davon, ob es technisch funktioniert. Das ist eine Entscheidung des Nutzers, keine
des Projekts; es steht hier, damit sie bewusst getroffen wird.
