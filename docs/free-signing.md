# Der einfachste kostenlose Weg, WatIs? zu signieren

_Stand 2026-08-31. Drei Recherchebereiche, 48 tragende Behauptungen gegengeprüft. Ergänzt
[`windows-signing.md`](windows-signing.md), das den Sonderfall Smart App Control behandelt._

## Die unbequeme Antwort zuerst

**Signieren lässt den SmartScreen-Dialog nicht verschwinden.** Microsofts eigene Tabelle ist
kategorisch:

> „Valid Certificate (OV/EV) | ⚠️ Warning — app flagged as unrecognized until reputation accumulates;
> **verified publisher name is displayed**"

Die Warnung beim ersten Download ist für jedes OV-Zertifikat der **dokumentierte Regelfall**, nicht die
Ausnahme. Was Signieren sofort und garantiert bringt, ist eine Zeile im Dialog: aus
_„Herausgeber: Unbekannter Herausgeber"_ wird ein verifizierter Name. Für das Verschwinden nennt
Microsoft als Größenordnung _„several weeks and hundreds of clean installs from a wide audience"_ — bei
zweistelligen Downloadzahlen wird die **Datei**-Reputation pro Release nie erreicht.

Und: **EV hilft nicht mehr.** _„Years ago, signing files with an Extended Validation (EV) code signing
certificate would result in positive SmartScreen reputation by default, but this behavior no longer
exists."_ Wer EV empfiehlt, ist auf dem Stand vor 2024.

Wer also signiert, um den Dialog loszuwerden, kauft primär einen benannten Herausgeber. Das ist ein
echter Gewinn — auf einem verwalteten Rechner kann eine Richtlinie unsignierte Dateien ganz sperren, und
Herausgeber-Reputation ist eines von zwei Signalen. Aber es ist nicht das, wonach die Frage klang.

## Die einzige Ausnahme: der Microsoft Store

Genau ein kostenloser Weg trägt bei Microsoft ein Häkchen statt einer Warnung:

> „**Microsoft Store (MSIX)** — Store re-signs your package | Free | Worldwide | **✅ No warnings**"

Und das Entwicklerkonto kostet inzwischen nichts: _„With the new onboarding experience, there are no
registration fees for either account type."_ Die früher fälligen 19 USD sind Geschichte.

Der Haken ist real und ungeklärt: Store-Policy **10.1.1** verlangt _„Products submitted as web apps must
be published by the domain or website owner."_ Ob ein Electron-Wrapper um `web.whatsapp.com` darunter
fällt, entscheidet die Zertifizierung im Einzelfall — **[UNGEKLÄRT]**. Dazu kommt MSIX-Repackaging, und
Auto-Update liefe dann über den Store statt über electron-updater.

Es gibt einen zweiten Store-Kanal, den man leicht übersieht: Policy **10.2.9** erlaubt, statt eines MSIX
eine Download-URL auf den bestehenden `.exe`-Installer einzureichen. Der Store signiert den dann aber
**nicht** — dafür braucht es ein eigenes Zertifikat. Die sinnvolle Kombination ist deshalb: SignPath für
die Signatur, Store nach 10.2.9 als zusätzlicher Kanal, GitHub Releases und electron-updater unverändert
daneben.

## Rangliste der Wege, die wirklich 0 EUR kosten

| Weg                          | Kosten             | Berechtigt für uns?          | Urteil          |
| ---------------------------- | ------------------ | ---------------------------- | --------------- |
| **SignPath Foundation**      | 0 EUR, dauerhaft   | wahrscheinlich               | **empfohlen**   |
| Microsoft Store (MSIX)       | 0 EUR (Konto frei) | ungeklärt (Policy 10.1.1)    | prüfenswert     |
| OSSign                       | 0 EUR              | **nein** — 6-Monats-Regel    | derzeit zu      |
| Certum „Open Source"         | ab 25 EUR          | ja                           | nicht kostenlos |
| Azure Artifact Signing       | ~9,99 USD/Monat    | **nein** — nur USA/Kanada    | gesperrt        |
| SSL.com / DigiCert / Sectigo | ab 129 USD/Jahr    | kein OSS-Programm auffindbar | ungeeignet      |

**OSSign scheidet aus**, und zwar an einer Bedingung, die man leicht übersieht — sie steht nur im
JS-Bundle der Seite: _„There is an absolute minimum of 6 months of activity on your account,
organization and project."_ Bei einem Projekt bei v0.1.0 ist das ein hartes Nein. Als Plan B in einem
halben Jahr wieder ansehen.

**Was gar nicht geht:** Selbstsigniert verhält sich laut Microsoft wie „no signature". Sigstore/cosign
erzeugt kein Authenticode und ist nicht im Microsoft Trusted Root Program. Let's Encrypt stellt keine
Code-Signing-Zertifikate aus. Und ein Zertifikat von jemand anderem mitzubenutzen bricht die
CA/Browser-Forum-Baseline-Requirements §6.1.2 — der Widerruf trifft dann alle damit signierten Dateien.

## SignPath Foundation im Detail

**Die Bedingungen passen.** _„The project must use an OSI-approved Open Source license without commercial
dual-licensing for all components"_ — MIT erfüllt das. Die „no proprietary code"-Klausel zielt auf eigene
Closed-Source-Blobs, nicht auf OSS-Runtimes; Chromium, Node, Electron und better-sqlite3 sind sämtlich
OSI-approved. Ausdrücklich erlaubt: _„You may include unsigned binaries of upstream OSS projects, e.g.
DLL files, in your signed packages."_ Umgekehrt gilt die Grenze: fremde Binaries dürfen **nicht** mit
unserem Zertifikat signiert werden. Signiert werden also nur unsere beiden EXE — genau die zwei Dateien,
die SmartScreen anmeckert.

**Ein Entwickler genügt.** Die Rollen Authors/Reviewers/Approvers müssen laut Wortlaut nicht verschiedene
Personen sein; Reviewer greifen nur bei _„changes proposed by people who are not committers"_. Pflicht
ist **MFA** auf GitHub und SignPath.

**Präzedenzfälle gibt es reichlich**, darunter Electron-Projekte mit electron-builder (Super
Productivity, Heroic Games Launcher, PicGo, VSCodium). Der für uns wichtigste: **BlueBubbles** — ein
inoffizieller Client für einen fremden, proprietären Dienst. Das ist genau unsere Bauform.

**Vollautomatik gibt es nicht.** _„Every release needs manual approval for signing."_ Der CI-Job blockiert
bis zum Klick — bei der zweistufigen Pipeline unten sogar **zweimal pro Release**. Alles andere läuft
unbeaufsichtigt über `signpath/github-action-submit-signing-request@v2`.

**Das echte Risiko ist die Aufnahme.** _„we cannot sign binaries based on source code that nobody knows.
For executable programs that may be downloaded and executed based on our signature, we require a certain
verifiable reputation."_ Ein frisches Ein-Mann-Projekt bei v0.1.0 ist genau der Grenzfall — und
_„We're under no obligation to accept your project, and there is no independent arbitration mechanism."_

**Der Herausgeber sind nicht wir.** _„The code signing certificate is issued to SignPath Foundation. This
means that SignPath Foundation is the publisher of the OSS project."_ Im Dialog steht danach
**„SignPath Foundation"**, nicht „phish3144" und nicht „WatIs".

> Nicht als Ertrag verbuchen: Die Hoffnung, das Foundation-Zertifikat bringe fremde Reputation mit, ist
> eine plausible Hypothese, kein belegter Mechanismus. Die Terms sprechen im **Plural** von Zertifikaten
> (_„get certificates issued to SignPath Foundation"_) — auf welchem WatIs? landet, ist unbekannt.

## Was im Repo passieren muss

Der Teil, der beim Planen am meisten unterschätzt wird. SignPath verlangt **Origin Verification**
(_„Required for Open Source Code Signing"_), und die funktioniert nur über den GitHub-Actions-Connector
mit einer hochgeladenen Artefakt-ID. **Ein Custom-Sign-Hook in electron-builder ist damit ausgeschlossen
— signiert wird um electron-builder herum, in zwei Runden.**

Warum zwei: SignPath kann `<pe-file>`, `<msi-file>`, `<zip-file>`, `<msix>` tief signieren — **NSIS steht
nicht auf der Liste**. SignPath kommt also nicht in die Installer-Nutzlast hinein.

1. `electron-builder --win --dir` → `win-unpacked/` zippen
2. SignPath signiert darin `WatIs.exe`
3. Zurückspielen, dann `electron-builder --win --prepackaged release/win-unpacked`
4. Beide fertigen EXE erneut an SignPath

**Vier Fallen, jede davon teuer:**

- **`signExts`.** electron-builder signiert per Default **nur `.exe`** — `shouldSignFile` in
  `winPackager.js` gibt für alles andere `false` zurück. Die Electron-DLLs und die `.node` bleiben außen
  vor. Im Zweistufenmodell steuert das ohnehin die SignPath-Artifact-Configuration, nicht `signExts`.
- **`--prepackaged` überspringt `emitAfterPack`** — und genau dort schreibt electron-builder
  `app-update.yml`. Beide Phasen schreiben die Datei also nie, und **der Updater ist still kaputt**. Sie
  muss von Hand erzeugt werden.
- **`latest.yml` und Blockmap veralten.** electron-builder hasht vor dem externen Signieren; danach
  stimmen `sha512`, `size` und die `.blockmap` nicht mehr, und der Updater bricht mit Hash-Fehler ab.
  Neu erzeugen über `app-builder-lib/out/targets/blockmap/blockmap` — das früher übliche
  `app-builder blockmap` gibt es in v26 nicht mehr.
- **`publisherName` ist eine Einbahnstraße.** Unsigniert → signiert bricht nichts:
  `NsisUpdater.verifySignature` überspringt die Prüfung, wenn der Wert in der installierten
  `app-update.yml` null ist. Andersherum ist es fatal — einmal `publisherName: SignPath Foundation`
  ausgeliefert, lehnt jede installierte Kopie unsignierte Updates **dauerhaft** ab.

Dazu die Auflage auf der Projektseite, wörtlich aus den Terms: ein Abschnitt mit der Überschrift
**„Code signing policy"** auf Startseite **und** Download-/Release-Seite, mit dem Satz _„Free code signing
provided by SignPath.io, certificate by SignPath Foundation"_, den Team-Rollen samt Mitgliedern und einem
Datenschutz-Link. Dort muss auch stehen, dass die App mit WhatsApp/Meta spricht — _„Remember to specify
the privacy policies of other Open Source or third party components or services your application uses"_.

> Die README von Super Productivity ist als Muster **nicht** geeignet: Sie erfüllt die eigenen Auflagen
> nicht (falsche Überschrift, keine Rollen, kein Datenschutz-Link). Nur die Terms sind maßgeblich.

## Empfehlung

**SignPath Foundation beantragen — aber mit der richtigen Erwartung.** Es ist der einfachste kostenlose
Weg zu einer echten Signatur, und die Aufnahmebedingungen passen bis auf den Reputationsvorbehalt.

Was es bringt: ein verifizierter Herausgebername statt „Unbekannter Herausgeber", die Grundlage für
Herausgeber-Reputation über kommende Releases, und die Erfüllung von Richtlinien, die unsignierte
Dateien pauschal sperren.

Was es **nicht** bringt: den sofortigen Wegfall des Dialogs. Wer den garantiert will, muss in den
Microsoft Store — mit dem ungeklärten Policy-Risiko.

**Und die Reihenfolge zählt.** Der Aufwand ist ein Antrag plus ein Umbau der Release-Pipeline mit vier
bekannten Fallen. Solange der SmartScreen-Dialog auf dem Zielrechner ein
„Weitere Informationen → Trotzdem ausführen" anbietet, löst ein Klick dasselbe Problem in zehn Sekunden.
Signieren lohnt, wenn dieser Klick per Richtlinie entfernt wurde — oder wenn WatIs? über den eigenen
Rechner hinaus verteilt werden soll.
