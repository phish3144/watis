# WatIs? auf einem verwalteten Firmenrechner

_Stand: 2026-08-30. Alle Zitate an diesem Tag gegen die verlinkten Primärquellen geprüft._

Dieses Dokument beantwortet eine einzige Frage: **Wie kommt WatIs? legitim auf einen Rechner, auf dem
die IT bestimmt, was laufen darf?** Es ergänzt [`windows-signing.md`](windows-signing.md), das nur den
Consumer-Fall Smart App Control behandelt.

Vorweg die Abgrenzung, die alles andere trägt: Es gibt hier **keinen Weg um die IT herum**, und dieses
Dokument beschreibt keinen. Jede Bauform, die eine Durchsetzung nur deshalb überlebt, weil die
Durchsetzung sie nicht sieht, ist gegen den Zweck der Richtlinie gebaut und steht unten unter
[Was nicht funktioniert](#was-nicht-funktioniert-und-warum-es-trotzdem-immer-vorgeschlagen-wird).

---

## Schritt 0: Erst diagnostizieren, dann beantragen

Ohne diesen Schritt rät der Antrag. Drei Mechanismen sehen für den Nutzer gleich aus und verlangen drei
verschiedene Anträge.

| Kandidat                            | Wo nachsehen                                                                                         | Beweis                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **AppLocker**                       | Ereignisanzeige → Anwendungs- und Dienstprotokolle → Microsoft → Windows → AppLocker → `EXE and DLL` | Event **8004** = blockiert, 8003 = nur Audit                     |
| **App Control for Business** (WDAC) | … → Microsoft → Windows → `CodeIntegrity/Operational`                                                | Event **3077** = blockiert, 3076 = Audit, 3089 = Signaturdetails |
| **SmartScreen**                     | Der Dialog selbst                                                                                    | Es gibt „Weitere Informationen“ → „Trotzdem ausführen“           |
| **Smart App Control**               | Windows-Sicherheit → App- und Browsersteuerung                                                       | Steht dort „Aus“, war es das **nicht**                           |

Zusätzlich `citool.exe -lp` in der Eingabeaufforderung: zeigt die aktiven Code-Integrity-Policies mit
Namen und `Is Currently Enforced`.

**SAC ist auf einem verwalteten Rechner der unwahrscheinlichste Kandidat.** Microsoft beschreibt es als
„an app control-based security solution designed for **consumer** users“ und schreibt in derselben
Übersicht: „there are some legitimate tasks that **corporate users**, developers, or others do regularly
that might not be a great experience with Smart App Control running. **If we detect that you're one of
those users, we automatically turn Smart App Control off.**“ Die Support-FAQ nennt als Abschaltgrund
wörtlich _„Your device is enterprise-managed“_. SAC ist außerdem von der IT gar nicht konfigurierbar –
es gibt keine Policy dafür.

Der Unterschied ist nicht akademisch: **Gegen SAC hilft nur eine Signatur, gegen AppLocker/WDAC hilft
auch eine Hash-Regel.**

---

## Der zentrale Befund: eine unsignierte EXE ist freigebbar

Microsoft benennt den Fall ausdrücklich:

> „if the software publisher didn't sign the file, you can: Sign the file by using an internal
> certificate. Create a rule by using a file hash condition. Create a rule by using a path condition.“
> — [Understanding AppLocker rule condition types](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/applocker/understanding-applocker-rule-condition-types)

Für App Control for Business gilt dasselbe über das File Rule Level **Hash**; Microsofts eigenes Beispiel
ist wörtlich der Fall „intern geschriebene, unsignierte Anwendung“ (`New-CIPolicy -Level Publisher
-Fallback Hash`), und dort steht: „The Authenticode/PE image hash can be calculated for digitally signed
**and unsigned** files.“

**Ein Zertifikat ist also nicht zwingend.** Der Preis liegt woanders: Der Authenticode-Hash ändert sich
mit jedem Build, die Regel muss pro Release nachgezogen werden. Genau daran scheitern solche Anträge in
der Praxis – nicht am ersten Ticket, sondern am zwölften. Wer signiert, tauscht _n_ Hash-Tickets pro Jahr
gegen **eine** Publisher-Regel, die Updates überlebt. Das ist das eigentliche Argument fürs Signieren,
nicht „sonst geht es nicht“.

### Zwei Fallstricke

- **KB2749690 – der NSIS-Installer ist womöglich gar nicht hashbar.** Für PE-Dateien, denen nach dem
  Signieren Daten angehängt wurden („This condition applies to some third-party installers“), lässt sich
  **weder** eine Hash- **noch** eine Publisher-Regel anlegen; es bleiben nur Pfadregeln.
  ([KB 2749690](https://learn.microsoft.com/en-us/troubleshoot/windows-server/shell-experience/0x800700c1-not-valid-win32-application-applocker-hash-rule))
  **Konsequenz für WatIs?: zusätzlich ein reines ZIP mit dem entpackten Programmverzeichnis ausliefern.**
  Dann hasht die IT die echte `WatIs.exe` statt eines Installer-Stubs. WDAC hat für solche Fälle einen
  Flat-File-Hash-Fallback, AppLocker nicht.
- **DLL-Regeln.** Electron bringt ein Dutzend eigener DLLs mit. Ist die AppLocker-DLL-Regelsammlung
  aktiv, braucht jede eine eigene Regel. Immerhin: die Sammlung ist **nicht** standardmäßig an. Unter
  WDAC mit UMCI dagegen wird jedes User-Mode-Binary geprüft – dort erzwingt die Bauform faktisch eine
  Signatur, auch wenn die Regel es nicht tut.

Edition ist kein Hindernis: seit KB 5024351 erzwingen **alle** Windows-11-Editionen AppLocker-Richtlinien.

---

## Wege zur Freigabe, sortiert nach Aufwand für die IT

### 1. Per-Machine-Installation nach `%ProgramFiles%\WatIs` — null neue Regeln

Die AppLocker-Standardregeln für EXE sind exakt drei: alles für `BUILTIN\Administrators`, `%windir%\*`
für Everyone, `%programfiles%\*` für Everyone. **`%LOCALAPPDATA%\Programs` ist von keiner davon
gedeckt** – ein Per-User-Installer landet als Standardbenutzer im impliziten Deny.

Das ist die billigste Freigabe, die es gibt: Wer nach `%ProgramFiles%` installiert, braucht gar keine
neue Regel.

> **Kein Widerspruch zur Projektregel „Keine Adminrechte“.** Die Regel schützt davor, dass die _App_
> Elevation braucht, Dienste installiert, HKLM anfasst oder Nutzdaten außerhalb `%LOCALAPPDATA%\watis`
> ablegt. Sie verbietet nicht, dass die _IT_ die Software einmalig deployt. Wenn wir diesen Weg gehen,
> gehört eine zweite Build-Variante (`perMachine`) **ausschließlich für verwaltete Geräte** dazu –
> Nutzdaten bleiben unverändert unter `%LOCALAPPDATA%\watis\`. Braucht ein ADR.

Und ausdrücklich **nicht**: eine Pfadregel für `%LOCALAPPDATA%` beantragen. WDAC prüft zur Laufzeit, ob
ein Pfad nur für Administratoren schreibbar ist; das Benutzerprofil ist es nicht. Wer trotzdem darauf
besteht, bittet um `18 Disabled:Runtime FilePath Rule Protection` – also um eine Schwächung der
Richtlinie – und bekommt zu Recht ein Nein.

### 2. Managed Installer — oft ist die Paketierung schon der ganze Antrag

Verteilt die Organisation über Intune oder ConfigMgr und ist `13 Enabled:Managed Installer` gesetzt, ist
alles automatisch autorisiert, was die Intune Management Extension geschrieben hat – **auch im
Benutzerprofil**, ohne jede Datei-Regel. Als Intune-Win32-App paketiert zu werden erledigt dann alles.

### 3. Signierter Katalog mit der Firmen-PKI — kostet den Autor kein Zertifikat

Microsoft sieht das für unsignierte Apps ausdrücklich vor: „Organizations can use built-in Windows tools
to add organization-specific App Catalog signatures to existing apps as a part of the app deployment
process.“ Die Binaries bleiben unangetastet, die IT signiert einen Katalog mit der eigenen PKI.

Für ein MIT-lizenziertes, öffentliches Projekt ist das der eleganteste Weg – die IT kann den Quelltext
selbst bauen und selbst signieren. Ab dann ist es „interne Software“ statt „Fremd-EXE aus dem Internet“,
und das ist ein völlig anderer Genehmigungspfad.

### 4. Eigene Signatur (SignPath Foundation, 0 EUR)

Details in [`windows-signing.md`](windows-signing.md). Für die Freigabe zählt hier nur: Publisher-Regeln
setzen eine Signatur voraus („Publisher conditions can only be used for files that are digitally
signed“), und sie überleben Releases. Eine signierte Version ist für die IT eine **einmalige**
Publisher-Freigabe statt einer Dauerlast.

---

## Der Antrag: was er enthalten muss

**Was ihn aussichtsreich macht** – gehört wörtlich ins Ticket:

- Kein Dienst, kein Treiber, kein HKLM, keine lauschenden Ports, keine Elevation zur Laufzeit. Nutzdaten
  ausschließlich unter `%LOCALAPPDATA%\watis\`, im Download-Ordner und in vom Nutzer gewählten Pfaden.
  Die zwei Ausnahmen – Startmenü-Verknüpfung und CLSID unter HKCU – sind Anforderungen des
  Windows-Toast-Subsystems und als solche benennbar (siehe ADR 0004, Abschnitt B).
- **Quelltext offen, MIT, öffentliches Repo, reproduzierbarer Build.** Der stärkste Hebel überhaupt, weil
  er der IT die Option gibt, die sie bei Closed Source nicht hat: selbst bauen, selbst signieren.
- **Kurze, prüfbare Egress-Liste**: `web.whatsapp.com`, WhatsApp-Medienserver, GitHub Releases für den
  Updater. Am Proxy verifizierbar. Keine Telemetrie, kein Crash-Upload, OCR und Transkription lokal.
- Read-only gegenüber WhatsApp; die eine Sendefunktion an genau einer Codestelle, hinter einem
  standardmäßig ausgeschalteten Flag, protokolliert.
- Beilegen: SBOM, Lizenzliste, Hash-Liste je Release, Liste aller geschriebenen Pfade, Beschreibung des
  Update-Mechanismus.

**Was ihn aussichtslos macht – und das ist nicht die Bauform, das ist die Funktion:**

Nicht die EXE ist das Problem, sondern das **Archiv**. Ein durchsuchbares lokales Archiv fremder
Nachrichten samt Telefonnummern, Medien, OCR-Text und Transkripten auf Firmenhardware bedeutet:

- Das Unternehmen wird **Verantwortlicher** im Sinne der DSGVO für personenbezogene Daten von
  Kommunikationspartnern, die davon nichts wissen. Daran hängen Rechtsgrundlage, Löschkonzept,
  Aufbewahrungsfristen, Betroffenenrechte, Verarbeitungsverzeichnis, ggf. DSFA.
- **Mitbestimmung**: eine technische Einrichtung, die geeignet ist, Verhalten und Leistung zu überwachen,
  ist nach BetrVG § 87 Abs. 1 Nr. 6 zustimmungspflichtig. Das entscheidet der Betriebsrat, nicht die IT.
- **eDiscovery und Legal Hold**: Was auf Firmenhardware liegt, ist im Streitfall herauszugeben. Ein
  Volltextindex privater Chats vergrößert diese Fläche erheblich.
- **WhatsApps Nutzungsbedingungen** stehen quer: untersagt sind u. a. „reverse engineer, alter, modify,
  create derivative works from, decompile, or extract code“, „collect information of or about our users
  in any impermissible or unauthorized manner“ und „any non-personal use of our Services“. Ein
  firmenseitig genehmigter Archivierer trifft alle drei.
- **Betriebslast**: ein Client gegen undokumentierte WA-Web-Interna bricht bei WhatsApp-Updates. Den
  Support übernimmt am Ende die IT, die ihn genehmigt hat.

### Daraus folgt: den Antrag teilen

Beantrage die **Client-Hülle** – persistente Session, Tray mit Zähler, native Benachrichtigungen,
Bündelung, Ruhezeit, Close-to-Tray, Autostart, CSS-Layer, geordnete Downloads. Das ist ein
Browser-Wrapper mit Desktop-Integration und speichert nichts, was der Browser nicht ohnehin speichert.
Gut verteidigbar.

**Archiv, Blob-Store und Inhaltsindex nicht auf Firmenhardware beantragen.** Wenn dieser Teil wichtig
ist, gehört er auf ein privates Gerät, wo die „persönliche Nutzung“ aus den WhatsApp-Bedingungen trägt
und kein Arbeitgeber Verantwortlicher wird. WhatsApp erlaubt mehrere verknüpfte Geräte; die Trennung ist
technisch gratis.

Ein Antrag, der diese Grenze selbst zieht, wirkt kompetent. Einer, der sie verschweigt und später
auffliegt, verbrennt das ganze Projekt.

---

## Was nicht funktioniert (und warum es trotzdem immer vorgeschlagen wird)

| Vorschlag                              | Urteil                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Portable EXE vom USB-Stick             | AppLocker/WDAC/SAC prüfen den Ladevorgang jeder PE-Datei, nicht die Herkunft. Ändert nichts.                                                                                                                                                                                                                                                                                                                                                                                         |
| Selbst kompilieren                     | Dito. Eine lokal gebaute unsignierte EXE ist für die Prüfung dieselbe unsignierte EXE.                                                                                                                                                                                                                                                                                                                                                                                               |
| Mark-of-the-Web entfernen („Zulassen“) | Wirkt gegen SmartScreen, nicht gegen AppLocker/WDAC/SAC.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Erweiterung im Entwicklermodus laden   | `ExtensionDeveloperModeSettings` (Chrome/Edge seit 128) sperrt genau das. Wo die Policy greift, ist es keine Lösung; wo sie nicht greift, ist es Zufall statt Freigabe – und exakt das, was die Policy verhindern soll.                                                                                                                                                                                                                                                              |
| WSL2                                   | Formal fallen ELF-Binaries nicht unter AppLocker (dessen Regeln sind über PE-Dateien definiert). Das ist eine Lücke, kein Weg: der Zweck der Richtlinie ist „auf diesem Gerät läuft nur freigegebener Code“. Scheitert außerdem an `wsl --install` (Adminrechte), und WSLg reicht keine Benachrichtigungen durch – die kursierenden Helfer rufen eine Windows-PE-Datei auf, die wieder unter AppLocker fällt. Für Entwicklung und Test des Linux-Builds: ja. Als Produktivweg: nein. |
| Microsoft Store / MSIX                 | Reizvoll – Store-MSIX wird von Microsoft kostenlos neu signiert, Standardnutzer dürfen Packaged Apps installieren, und der DefaultWindows-Modus jeder App-Control-Policy autorisiert Store-signierte MSIX. Aber Store-Policy 10.1.1 verlangt: „Products submitted as web apps must be published by the domain or website owner.“ Ein Drittanbieter-Wrapper um `web.whatsapp.com` ist genau der adressierte Fall. Ausgang **[UNGEKLÄRT]**.                                            |

---

## Die Browser-Erweiterung als zweite Bauform

Eine eigenständige Web-App ist ausgeschlossen – `web.whatsapp.com` sendet `X-Frame-Options: DENY`, und
die Same-Origin-Policy verbietet jeden Zugriff von fremdem Origin. Was bleibt, ist Code **innerhalb** der
Seite, also eine Erweiterung.

**Was überlebt** (rund 70 % des Funktionsumfangs, das Archiv eingeschlossen):

- Der IndexedDB-Zugriff auf `model-storage`/`chat` funktioniert. Chrome dokumentiert wörtlich: „In
  content scripts, calling web storage APIs accesses data from the host page the content script is
  injected on and not the extension.“ Die isolierte Welt trennt JS-Variablen, nicht Storage-Origin und
  nicht DOM. Der Unread-Zähler geht damit ohne MAIN-world-Injektion.
- Das SQLite/FTS5-Archiv geht – aber **nur** als WASM in einem dedizierten Worker innerhalb eines
  **Offscreen Document** (Reason `WORKERS`), im OPFS der `chrome-extension://`-Origin. Nicht im Service
  Worker (kein `createSyncAccessHandle`), nicht im Content Script (falscher Origin).
- Der MV3-Service-Worker ist **nicht** der Showstopper, für den er gilt – weil der Archivierer nicht in
  ihm laufen darf. Mitschreiben gehört ins Content Script (lebt so lange wie der Tab, kein
  Lifetime-Limit), die DB ins Offscreen Document (nur Reason `AUDIO_PLAYBACK` schließt automatisch), der
  SW ist bloß Nachrichten-Router und darf sterben.
- Downloads sind **sauberer** als in Electron: `chrome.downloads.download` nimmt einen Pfad relativ zum
  Download-Ordner „possibly containing subdirectories“, `conflictAction: "uniquify"` erledigt
  Kollisionen. Verboten sind nur absolute Pfade, leere Pfade und `..`.
- Der CSS-Layer ist sogar besser: Content-Script-CSS wird vom Browser injiziert, ist von der CSP der
  Seite unbetroffen und flackert bei `run_at: document_start` nicht.
- Benachrichtigungen: statt `window.Notification` zu patchen, blockt `chrome.contentSettings` die
  Web-Notification-Berechtigung für `web.whatsapp.com`, und die Erweiterung feuert eigene
  `chrome.notifications` mit bis zu zwei Buttons.

**Was stirbt:** Tray-Icon (Ersatz ist `chrome.action.setBadgeText`, sichtbar nur in der Toolbar),
Close-to-Tray, Autostart, Betrieb ohne Browser. Und die harte Bedingung: **ein Tab mit
`web.whatsapp.com` muss offen sein.**

**Vor jeder Architekturentscheidung zu klären [UNGEKLÄRT]:** ob ein Content Script mit `world: "MAIN"`
auf `web.whatsapp.com` trotz der Nonce-CSP ohne `unsafe-inline` tatsächlich ausgeführt wird. Der
Mechanismus spricht dafür (der Browser injiziert, es entsteht kein `<script>`-Tag der Seite), die
Dokumentation ist nicht eindeutig. Empirisch in zehn Minuten zu klären: Minimal-Erweiterung, `world:
MAIN`, `console.log`.

**Für den verwalteten Rechner ist die Erweiterung kein Ausweg um die IT herum, aber der kleinere
Antrag.** `ExtensionInstallBlocklist: ["*"]` mit Allowlist ist in verwalteten Umgebungen der Normalfall;
freigegeben wird per Extension-ID über `ExtensionInstallAllowlist`, ausgerollt per
`ExtensionInstallForcelist`. Der Vorteil gegenüber einer EXE: kein neues Binary auf der Platte, keine
Hash-Pflege, Update-Integrität durch den Store garantiert, Berechtigungen im Manifest deklariert, Blast
Radius auf eine Origin begrenzt, Widerruf per Policy jederzeit möglich. Das ist das Argument, mit dem man
an die IT herantritt.

---

## Prior Art — was der Markt sagt

- **Erweiterungen für WhatsApp Web sind ein etablierter, geduldeter Markt.** „WA Web Plus by Elbruz
  Technologies“ steht mit rund 2.000.000 Nutzern und einem Update vom 27.08.2026 im Chrome Web Store.
  Nicht entfernt, seit Jahren.
- **Exporter gibt es Dutzende – aber alle sind One-Shot-Dumper.** Keine einzige Erweiterung führt ein
  mitlaufendes, wachsendes, durchsuchbares Archiv. Das ist ein echtes Alleinstellungsmerkmal und
  gleichzeitig ein Warnzeichen: Wenn Anbieter mit 2 Mio. Nutzern es nicht bauen, liegt das an den
  Grenzen der Bauform, nicht an fehlender Nachfrage.
- **Die Trennlinie bei Takedowns ist Senden, nicht Lesen.** Der bestdokumentierte Fall (Socket, Oktober
  2025: 131 baugleiche Spamware-Erweiterungen, ~20.900 Nutzer) drehte sich ausnahmslos um
  Massenversand-Automatisierung. Die Read-only-Regel aus `CLAUDE.md` ist damit nicht Hygiene, sondern die
  Grenze zwischen „seit Jahren unbehelligt“ und „Ziel von Takedown-Kampagnen“.
- **Die Namenswahl ist nachweislich richtig.** WhatsApps DMCA-Welle vom 12.02.2014 sperrte 37
  GitHub-Repositories; `Enrico204/Whatsapp-Desktop` – ein Electron-Wrapper derselben Bauform – wurde
  2018 ausdrücklich deswegen archiviert. Metas Brand Resources sagen wörtlich: „DON'T use the WhatsApp
  Brand Resources as part of a name of a product or service of a company other than WhatsApp.“ Repo
  bleibt `watis`, und der Disclaimer „not affiliated with, associated with, endorsed by, or sponsored by
  WhatsApp“ gehört in README, Über-Dialog und Release-Beschreibung.
- **Meta hat die Bauform selbst legitimiert.** Seit Version 2.2584.3.0 (allgemein ab November 2025) ist
  der native WhatsApp-Windows-Client abgeschafft und durch einen WebView2-Wrapper um `web.whatsapp.com`
  ersetzt – exakt WatIs?' Architektur, nur mit Edge-WebView2 statt Chromium-in-Electron. Das verschiebt
  die Rechtfertigung von „Wrapper“ zu „die Desktop-Integration, die Meta gerade weggeworfen hat“.

---

## Reihenfolge

1. **Diagnose.** Welcher Mechanismus blockiert? Event-Log-Zeile besorgen. Alles Weitere hängt daran.
2. **SignPath Foundation beantragen** – kostenlos, für genau dieses Projektprofil gemacht. Parallel
   prüfen, ob die Firma eine interne Code-Signing-PKI hat; wenn ja, ist das der kürzere Weg.
3. **Per-Machine-Build nach `%ProgramFiles%`** bauen, zusätzlich ein entpacktes ZIP ausliefern (umgeht
   KB2749690).
4. **Ticket stellen** – für die Client-Hülle, mit SBOM, Egress-Liste, Pfadliste, Hashes, Signaturplan und
   der ausdrücklichen Aussage, dass keine Archivierung fremder Nachrichten auf Firmenhardware
   stattfindet.
5. Wird abgelehnt: **Erweiterung im Store veröffentlichen** und die ID zur Allowlist beantragen.
   Funktional weniger, aber der Antrag ist klein und die Chance hoch.
6. **Das Archiv aufs Privatgerät.** Dort trägt „persönliche Nutzung“, dort wird niemand Verantwortlicher.
