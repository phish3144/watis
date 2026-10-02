# ADR 0011 – Bilder, Videos und Sprachnachrichten dauerhaft sichern

- **Status:** akzeptiert. Eine Änderung der Voreinstellung (Sprachnachrichten) ist vorgeschlagen und
  nicht umgesetzt.
- **Datum:** 2026-10-02
- **Betrifft:** [ADR 0001](0001-offene-entscheidungen-aus-plan-10.md) §3 (Medien-Abrufregeln), PLAN.md
  Phase 6 und Phase 10
- **Frage der Nutzerin:** „Wie können wir Bilder, Videos und Sprachnachrichten dauerhaft archivieren?
  Komprimieren? Cloud speichern?"

## Kontext

„Dauerhaft" scheitert an drei Stellen, und keine davon ist Speicherplatz:

1. **WhatsApp hält Medien nur begrenzt bereit.** Eine Datei, die niemand bald nach dem Eintreffen
   holt, ist später womöglich nicht mehr zu bekommen. Was nicht im Archiv ist, ist dann weg.
2. **Der Speicher der Browser-Erweiterung hängt am Browserprofil** ([ADR 0010](0010-browser-erweiterung.md)).
   Abmelden, Cache-Leeren und Updates überlebt er. Deinstallieren und das Zurücksetzen eines
   Firmenprofils überlebt er nicht.
3. **Eine einzige Kopie ist keine Sicherung**, auch am Desktop nicht.

## Entscheidung

### 1. Früh holen: Abrufregeln als Einstellung

Die Regeln aus ADR 0001 §3 sind jetzt Schalter (`archiveImages`, `archiveDocuments`, `archiveVoice`,
`archiveVideoMaxMb`), mit unveränderten Voreinstellungen: Bilder und Dokumente automatisch,
Sprachnachrichten und Videos auf Klick. Neue Anhänge werden sofort nach dem Import geholt, nicht
erst beim nächsten Zeitintervall, denn kurz nach dem Eintreffen klappt es am sichersten.

**Vorschlag, nicht umgesetzt:** Sprachnachrichten standardmäßig automatisch holen. Mit rund 100 KB
pro Minute (Opus) sind sie die kleinste Medienart, und „auf Klick" heißt bei ihnen oft „zu spät".
ADR 0001 hat das anders entschieden. Deshalb bleibt es aus, bis die Nutzerin zustimmt; der Schalter
ist da.

### 2. Nicht nachkomprimieren

Was WhatsApp schickt, ist schon komprimiert: Fotos als JPEG mit einigen hundert Kilobyte, Videos als
H.264, Sprachnachrichten als Opus mit etwa 16 kbit/s. Ein zweiter Durchgang (AVIF, AV1)

- spart bei Fotos und Sprache wenig, bei Videos mehr, aber nur für viel Rechenzeit, und die gibt es
  im Browser nicht billig,
- **verliert Qualität**. Ein Archiv, das Belege und Fotos von Rechnungen hält, soll das Original
  halten,
- bricht die Inhaltsadressierung: Die Datei heißt nach ihrem SHA-256, und daran hängen Dedupe
  (ein weitergeleitetes Foto ist eine Datei) und die Gleichheit von Desktop- und Browser-Sicherung.

Deduplizierung ist die Kompression, die nichts kostet, und die gibt es schon. Auch die ZIP-Sicherung
speichert nur („stored") statt zu deflaten: Zwei Prozent Gewinn sind keinen zweiten Rechendurchgang
wert.

### 3. Keine Cloud von uns – aber jeder Ordner, den die Nutzerin will

WatIs? spricht mit keinem Cloud-Dienst (CLAUDE.md, „Datenschutz und Netz"), und daran ändert diese
Frage nichts. Die Sicherung geht in **einen Ordner, den die Nutzerin wählt**. Ist das ein Ordner,
den OneDrive, Nextcloud oder ein Firmenlaufwerk abgleicht, liegt die Sicherung dort. Diese Wahl und
ihre Folgen gehören der Nutzerin: Chatinhalte landen dann bei diesem Anbieter. Die Oberfläche nennt
die Möglichkeit, empfiehlt sie aber nicht ungefragt, und WatIs? weiß nicht, ob ein Ordner
synchronisiert wird.

### 4. Wie gesichert wird

Beide Wege schreiben **das Layout der Desktop-Sicherung**: `archive.sqlite`,
`blobs/<aa>/<bb>/<sha256>.<ext>`, `BACKUP.json`. Eine Sicherung aus dem Browser versteht damit auch
die Desktop-App.

| Weg    | Browser                          | Wie                                                                                                                                                                        |
| ------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordner | Chrome, Edge                     | einmal gewählt (File System Access, Handle in IndexedDB), auf Klick gespiegelt. Dateien mit gleichem Namen und gleicher Größe sind dieselbe Datei und werden übersprungen. |
| ZIP    | alle; in Firefox der einzige Weg | Datenbank plus die Medien seit der letzten ZIP-Sicherung, in Teilen bis 1 GB. Jeder Teil entsteht in OPFS und wird nach dem Download gelöscht.                             |

Den ZIP-Schreiber haben wir selbst geschrieben, rund 150 Zeilen, nur „stored": ein Durchgang, die
Prüfsumme wird nachgetragen, kein ZIP64. Die Teilgrenze hält alle Offsets im klassischen Format,
das jedes Entpackprogramm und der Windows-Explorer lesen. Geprüft ist er gegen zlib, Pythons
`zipfile` und `unzip`.

**„Neu seit der letzten ZIP-Sicherung"** misst das Schreibdatum der Datei in OPFS, nicht eine
Spalte in der Datenbank. Eine Datei wird erst geholt, wenn ihr Datensatz schon existiert. Ein
Datensatzzeitstempel würde sie also verpassen, das Dateidatum nicht. Zusätzlich gibt es
„Alle Medien neu".

**Wann:** auf Klick. Ein Browser vergisst die Schreibberechtigung für den Ordner beim Neustart, und
sie neu zu erteilen braucht eine Nutzergeste. Eine automatische Sicherung ginge deshalb nur, solange
die Berechtigung noch steht. Das ist ein möglicher nächster Schritt, kein Versprechen. Am Desktop
gibt es die zeitgesteuerte Sicherung in einen Ordner schon (Phase 6).

## Größenordnung

Fotos: einige hundert Kilobyte. Sprachnachrichten: rund 100 KB pro Minute. Videos: einige Megabyte
pro Minute. Ein Jahr in vielen Gruppen ist ohne Videos meist im einstelligen Gigabyte-Bereich, mit
Videos schnell mehr. Deshalb sind Videos nur bis zu einer wählbaren Größe automatisch, und die
Speichergrenze bleibt einstellbar.

## Folgen

- Die Einstellungen der Erweiterung zeigen Sicherungsordner, „Jetzt sichern", „Als ZIP
  herunterladen", den Stand der letzten Sicherung und den Fortschritt.
- Eine Wiederherstellung **in** die Erweiterung gibt es noch nicht. Die Sicherung ist lesbar
  (SQLite und Dateien) und hat das Desktop-Format. Das Zurückspielen ist ein eigener Schritt.
