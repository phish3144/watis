# ADR 0009 – AppImage als Linux-Format, und der Tray unter GNOME

Status: angenommen, 2026-09-13

## Kontext

Linux (Ubuntu) wird Release-Ziel. Die App lief dort schon: `paths.ts` kennt die XDG-Pfade,
`better-sqlite3` bringt ein fertiges `linux-x64`-Binary mit, und die vollständige E2E-Suite läuft
seit Beginn auf `ubuntu-latest`. Was fehlte, war ein Paketformat und eine echte
Plattformimplementierung — unter Linux lief bis dahin `unsupported.ts`, in dem jede Funktion ein
bewusster No-op war.

## A – AppImage, kein .deb, .rpm oder Snap

CLAUDE.md verbietet systemweite Installationen. Das ist keine Stilfrage: Zielrechner ist ein
verwalteter Rechner, auf dem niemand `sudo` hat.

- **`.deb`/`.rpm`** schreiben nach `/usr` und brauchen root. Damit scheiden sie aus, egal wie
  bequem `apt install` wäre.
- **Snap** bringt einen Daemon mit und sperrt die App in ein Confinement, das sie vom
  Download-Ordner trennen würde, in den sie schreiben soll.
- **AppImage** ist eine Datei, die der Nutzer besitzt. Kein root, kein Paketmanager, kein Dienst.
  `electron-updater` unterstützt es direkt: es ersetzt die Datei an Ort und Stelle.

Der Preis ist, dass ein AppImage dem Desktop unbekannt ist — kein Menüeintrag, kein Icon, nichts
bei der Suche. Das wäre keine „anständige Installation". Deshalb trägt sich die App beim ersten
Start selbst ein (`src/main/linux-integration.ts`), ausschließlich unter `$HOME`:

| Datei                                                 | Wofür               |
| ----------------------------------------------------- | ------------------- |
| `~/.local/share/applications/watis.desktop`           | Menüeintrag         |
| `~/.local/share/icons/hicolor/512x512/apps/watis.png` | dessen Icon         |
| `~/.config/autostart/watis.desktop`                   | Start bei Anmeldung |

Deinstallieren heißt: AppImage löschen, diese drei Dateien löschen. Sonst bleibt nichts zurück.

Der Eintrag wird verglichen statt blind geschrieben: wird das AppImage verschoben oder umbenannt,
zeigt `Exec=` sonst ins Leere, und ein Menüeintrag, der nichts startet, ist schlechter als keiner.
Verifiziert durch Verschieben und erneuten Start.

**Autostart nicht über `app.setLoginItemSettings`.** Electron schreibt dort einen Eintrag mit
`Exec=process.execPath` — was innerhalb eines AppImage das entpackte Binary in einem temporären
Mount ist, den es bei der nächsten Anmeldung nicht mehr gibt. Der Eintrag wird deshalb selbst
geschrieben und zeigt auf `$APPIMAGE`.

## B – Unter GNOME gilt der Tray als nicht vorhanden

GNOME zeigt seit 3.26 keine Tray-Icons mehr. Electron legt trotzdem erfolgreich ein
`StatusNotifierItem` an: der Konstruktor wirft nicht, das Icon ist nicht leer, es hört nur niemand
zu. Die vorhandene Prüfung `icon.isEmpty()` im Tray-Controller kann das nicht sehen.

Das ist gefährlich, weil `closeToTray` das Fenster versteckt. In einen unsichtbaren Tray zu
minimieren nimmt die Anwendung weg, ohne Weg zurück.

`Platform.trayIsReliable()` beantwortet die Frage jetzt ausdrücklich. Windows und macOS: immer
wahr. Linux: falsch bei GNOME, Unity und Pantheon, es sei denn `WATIS_FORCE_TRAY=1` sagt, dass
eine AppIndicator-Erweiterung läuft. Wo der Tray nicht verlässlich ist, beendet ein Schließen des
Fensters die Anwendung — eine Tür, die auffindbar ist.

Erkannt wird über `XDG_CURRENT_DESKTOP`, nicht über einen DBus-Aufruf: die Antwort wird beim
Festlegen des Fensterverhaltens gebraucht, der Main-Prozess darf nicht blockieren, und ein Irrtum
kostet hier eine Checkbox statt der Sitzung. Im Zweifel lautet die Antwort „kein Tray".

## C – Updates nur aus dem AppImage heraus

`app.isPackaged` ist auch für den entpackten Linux-Build wahr. Ohne Prüfung liefe der Updater dort
an, lüde ein neues AppImage und scheiterte beim Ersetzen — eine Stunde später, mit einer Meldung
über einen Pfad, den der Nutzer nie gewählt hat. Fehlt `$APPIMAGE`, schaltet sich der Updater
deshalb mit Begründung ab.

## Verifikation

Das AppImage wurde gebaut und in einem leeren `HOME` gestartet. Nachgewiesen: Datenwurzel unter
`~/.local/share/watis/`, Menüeintrag und Icon angelegt, `platform: linux` aktiv, Archiv- und
Index-Worker gestartet, Updater aktiv (`Checking for update`), und der Eintrag folgt dem
verschobenen AppImage.

**Nicht nachgewiesen:** die Fensterklasse. `WM_CLASS` ließ sich unter Xvfb ohne Fenstermanager
nicht auslesen. Belegt ist nur, dass electron-builders eigene Warnung dazu nach dem Setzen von
`desktopName` und `syncDesktopName` verschwindet.
