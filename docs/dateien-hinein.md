# Dateien in die App hineinbekommen

Verlangt von PLAN.md Phase 2: „Drag-in/Paste-Verhalten prüfen und dokumentieren (WA Web kann das
bereits)".

## Kurz: es funktioniert, und zwar weil nichts es abfängt

Dateien in einen Chat ziehen und Bilder aus der Zwischenablage einfügen sind Fähigkeiten von
**WhatsApp Web selbst**. Beides läuft im Renderer über die üblichen Web-APIs — `dragover`/`drop` mit
`DataTransfer.files` und `paste` mit `ClipboardEvent.clipboardData` — und Electron liefert die
identisch zu einem Browser aus.

**WatIs? fasst diesen Weg nicht an.** Es gibt keinen `drop`- oder `paste`-Handler im Preload und
keinen im Main-Prozess, der ihn beeinflussen könnte. Das ist die ganze Erklärung, und sie ist auch der
Grund, warum das hier keine Funktion ist, die gebaut werden musste.

Wichtig ist deshalb vor allem, was **nicht** getan wurde:

|                                                       |                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Kein `will-navigate`-Abfangen von `file://` beim Drop | Ein Drop erzeugt gar keine Navigation. Ein Handler, der auf Verdacht eingreift, hätte den Drop kaputtgemacht |
| Kein `preventDefault` auf `dragover` im Dokument      | Genau das ist die klassische Art, Drag-and-Drop in einer Electron-App versehentlich abzuschalten             |
| Kein eigener Clipboard-Handler                        | Das Kontextmenü ruft `contents.paste()` und damit denselben Weg, den Strg+V nimmt                            |

Die einzige Stelle, an der WatIs? in eine Navigation eingreift, ist `will-navigate` in
`main-window.ts` — und die lässt `https://web.whatsapp.com` und lokale Adressen durch und schickt
alles andere in den Standardbrowser. Ein Drop läuft dort nicht vorbei.

## Was geprüft wurde

Von Hand gegen eine angemeldete Sitzung, weil beides ohne Chat nicht sinnvoll prüfbar ist. Der
Stand gehört zusammen mit Datum und WA-Web-Version in [`bridge-smoke.md`](bridge-smoke.md).

- [ ] Datei aus dem Explorer in einen offenen Chat ziehen → WhatsApps Vorschaudialog erscheint
- [ ] Mehrere Dateien auf einmal → Sammelvorschau
- [ ] Screenshot mit Strg+V einfügen → erscheint als Bild im Eingabefeld
- [ ] Text mit Strg+V einfügen → erscheint als Text, nicht als Datei
- [ ] Datei auf das eigene Panel (rechts) ziehen → **passiert nichts**, und das Fenster navigiert
      insbesondere nicht zur Datei

Der letzte Punkt ist der einzige, an dem etwas schiefgehen könnte: Ein Renderer, der eine
hineingezogene Datei annimmt und dorthin navigiert, ersetzt die Oberfläche durch den Dateiinhalt.
Das eigene Panel setzt deshalb weder `dragover`- noch `drop`-Handler, und Electrons Standardverhalten
für einen Drop ohne Handler ist, ihn zu ignorieren.

## Herausziehen ist etwas anderes

Der umgekehrte Weg — eine Datei aus dem Archiv in den Dateimanager ziehen — ist **nicht** kostenlos:
Er braucht `webContents.startDrag` mit einem echten Pfad. Das ist gebaut und sitzt in der
Archiv-Galerie neben „Öffnen" und „Ordner". Eine Datei, deren Blob nicht vorliegt, startet gar keinen
Zug, statt eine kaputte Datei im Zielordner abzulegen.
