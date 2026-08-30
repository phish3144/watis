# ADR 0004 – Bridge-Haltung, Roaming-Ausnahme und Direktantwort

- **Status:** akzeptiert
- **Datum:** 2026-08-30
- **Betrifft:** PLAN.md §2, §3, §4 Punkt 3, §5.5, §7 Phase 1 und 3, §11 — sowie die harten Regeln in CLAUDE.md
- **Grundlage:** [`docs/recon.md`](../recon.md)

Drei Befunde aus dem Technik-Recon brauchten eine Entscheidung des Projekteigentümers, weil sie
Zielkonflikte im Plan selbst aufdeckten. Alle drei sind entschieden.

---

## A – Die Bridge wird gebaut, mit eingeplanter Dauerwartung

**Entscheidung:** Phase 3 bleibt im Plan. Reparaturen nach WhatsApp-Web-Updates gehören zum Betrieb, nicht
zu den Ausnahmen.

**Was das kostet, gemessen:**

| Messwert | Wert |
|---|---|
| WA-Web-Builds pro Tag (Mittel, letzte 14 Tage) | 9,9 |
| Spitze | 14 |
| Annahme im ursprünglichen Plan (§9) | „mehrmals pro Jahr" |

Im Juli 2026 wurde eine Modell-Property umbenannt (`_serialized` → `$1`) und zwang beide
Referenzbibliotheken zu Notfall-Patches. Nicht jeder Build bricht die Bridge — aber die Bauhäufigkeit ist
die Obergrenze der Bruchrate, und sie liegt zwei Größenordnungen über der Planannahme.

**Was daraus folgt — verbindlich:**

1. **Phasen 0–2 bleiben ohne Bridge vollwertig.** Fenster, Session, Tray, Benachrichtigungen, Dateien,
   Downloads und Einstellungen dürfen keine Bridge-Abhängigkeit haben. Fällt die Bridge aus, verliert die
   App Archiv und Suche — nicht ihre Benutzbarkeit.
2. **Kein Termin für Phase 3.** Die Phase wird als laufendes Vorhaben geführt. Vor jeder Zusage steht ein
   Spike gegen die dann aktuelle WA-Web-Version.
3. **Healthcheck vor jedem Feature.** Kein Bridge-Feature ohne Feature-Flag und ohne Healthcheck, der es
   bei Ausfall abschaltet. Ein Bridge-Fehler darf nie als Exception in die WhatsApp-Seite gelangen.
4. **`docs/bridge-map.md` ist Pflicht, nicht Kür.** Jede aufgelöste Abhängigkeit mit Modulname, Feldnamen
   und der WA-Web-Version, gegen die sie verifiziert wurde. Ohne Eintrag kein Merge.
5. **Ein Ort für die Modulauflösung.** Alle Zugriffe laufen über eine einzige versionierte Map, damit eine
   Umbenennung wie `_serialized` → `$1` an genau einer Stelle repariert wird.
6. Das Sperrrisiko wird durch striktes Read-only (siehe C) und menschliches Tempo beim Backfill klein
   gehalten. Es ist nicht null, und das steht so im README.

**Ehrlicher Vorbehalt:** Kein Recon-Agent konnte `web.whatsapp.com` laden (HTTP 400). Alle Aussagen über
die internen Objekte sind Schlussfolgerungen aus fremdem Quellcode, keine Beobachtung. Die erste echte
Messung passiert, wenn Phase 3 beginnt.

---

## B – Roaming-Constraint präzisiert

**Problem:** Windows-Toasts setzen eine Start-Menü-Verknüpfung voraus, und Electron legt sie unaufgefordert
unter `FOLDERID_Programs` an — das ist `%APPDATA%\Microsoft\Windows\Start Menu\Programs`, also das
Roaming-Profil. Belegt aus `windows_toast_activator.cc` (`EnsureShortcut()`). In seiner ursprünglichen
Wortlaut-Fassung verbot der Plan damit versehentlich sämtliche Windows-Benachrichtigungen.

**Entscheidung:** Die Regel lautet ab jetzt:

> Keine **Nutzdaten** außerhalb von `%LOCALAPPDATA%\watis\`, dem Download-Ordner und vom Nutzer gewählten
> Pfaden.
>
> Ausdrücklich erlaubt sind die beiden Einträge, die das Windows-Toast-Subsystem verlangt:
> die Start-Menü-Verknüpfung unter `FOLDERID_Programs` und die CLSID-Registrierung unter `HKEY_CURRENT_USER`.

**Weiterhin verboten, unverändert:** `HKEY_LOCAL_MACHINE`, Dienste, Treiber, lauschende Ports, systemweite
Installationen, und jede Art von Nutzdaten im Roaming-Profil.

**Begründung:** Der Sinn der Regel war, dass keine Gigabytes über ein Domänen-Roaming-Profil
synchronisiert werden. Eine Verknüpfung ist einige hundert Byte, ist pro Benutzer, wird vom Deinstaller
entfernt und ist die vom Betriebssystem vorgeschriebene Anwendungsidentität. Die Registry-Seite ist
unkritisch: `EnsureCLSIDRegistry()` schreibt ausschließlich HKCU, keine Elevation.

**Konsequenz für den Test:** Der Phase-0-Installer-Test auf dem verwalteten Zielrechner prüft zusätzlich,
dass außer diesen beiden Einträgen nichts außerhalb von `%LOCALAPPDATA%` entsteht.

---

## C – Direktantwort: eng begrenzte, dokumentierte Ausnahme

**Problem:** Der Plan wollte Direktantwort aus der Benachrichtigung (§4 Punkt 3, Phase 1) und verbot
gleichzeitig jedes Senden (§2, §11). Antworten ist Senden. Die Betriebssystemseite ist gelöst — Electron 44
kann Inline-Reply auf Windows und macOS.

**Entscheidung:** Die Direktantwort wird gebaut, als **einzige** Ausnahme vom Sendeverbot, unter allen
folgenden Bedingungen gleichzeitig. Fällt eine weg, wird das Feature abgeschaltet.

1. **Die Bridge bleibt read-only — ohne Ausnahme.** Die Antwort geht **nie** über interne Store-APIs.
   Sie wird in die sichtbare Eingabezeile der WhatsApp-Web-Oberfläche geschrieben und abgeschickt, exakt
   so, wie es ein Tastendruck täte. Damit bleibt die in §5.5 zugesagte Read-only-Eigenschaft der Bridge
   wörtlich wahr.
2. **Nur Klartext.** Keine Medien, keine Anhänge, keine Formatierung, keine Zitate, keine Reaktionen.
3. **Nur reaktiv.** Ausschließlich in einen Chat, aus dem soeben eine Nachricht eintraf und für den gerade
   ein Toast offen ist. Es gibt keinen Weg, aus der App heraus einen beliebigen Chat anzuschreiben.
4. **Eine Antwort pro Toast.** Kein Bulk, kein Scheduling, kein Auto-Reply, keine Vorlagen, keine
   Weiterleitung. Menschliches Tempo, ausgelöst durch eine menschliche Eingabe.
5. **Standardmäßig aus.** Feature-Flag in den Einstellungen, das der Nutzer aktiv einschalten muss, mit
   einer klaren Erklärung, dass dies die einzige Stelle ist, an der die App etwas sendet.
6. **Auditierbar.** Jede gesendete Antwort erzeugt einen Eintrag in `logs/outgoing.log` mit Zeitstempel,
   Chat-ID, Zeichenzahl und Ergebnis. Der Text selbst landet über die normale Live-Spiegelung als
   `from_me`-Nachricht im Archiv, wie jede andere ausgehende Nachricht auch.
7. **Ein einziger Ort im Code.** Das gesamte Sendeverhalten lebt in einem Modul, dessen Name es benennt.
   Kein anderer Teil des Projekts darf tippen, klicken oder absenden. Ein Pull Request, der Sendecode
   anderswo einführt, ist falsch.

**Was das kostet, offen gesagt:** Die Zusage „die App kann nichts senden" gilt nicht mehr uneingeschränkt.
Sie wird ersetzt durch „die App kann genau eine Sache senden, sie tut es nur auf ausdrückliche Eingabe hin,
und sie schreibt mit". Das README sagt das so.

**Fallback bleibt gebaut:** Lässt sich Inline-Reply auf einer Windows-Version nicht sauber zustellen,
öffnet der Klick den Chat mit fokussiertem Eingabefeld. Das ist kein Notbehelf, sondern das Verhalten,
solange das Feature-Flag aus ist.
