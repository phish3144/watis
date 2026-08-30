# Smart App Control und WatIs? – Entscheidungsgrundlage

_Stand: 2026-08-30. Alle Preise und Zitate an diesem Tag gegen die genannten Primärquellen geprüft._

## Die kurze Antwort

**Ja, es geht kostenlos – aber nur, indem man Smart App Control abschaltet.** Eine Ausnahmeliste für einzelne Programme existiert bei SAC bewusst nicht. Microsoft schreibt in der Support-FAQ wörtlich:

> "There is currently no way to bypass Smart App Control protection for individual apps. You can turn Smart App Control off, or (better yet), contact the developer of the app and encourage them to sign their app with a valid signature."

Es bleiben also genau zwei legitime Wege: **signieren** oder **SAC ausschalten**. Kein "Trotzdem ausführen", kein Ordnerausschluss, keine Hash-Freigabe.

**Eine kostenpflichtige Lizenz ist aber nicht zwingend.** Für ein öffentliches MIT-Projekt gibt es kostenloses OV-Signing über die SignPath Foundation; ein eigenes Zertifikat kostet bei Certum 49 EUR im Jahr. Ein EV-Zertifikat für 400+ USD wäre 2026 rausgeworfenes Geld.

---

## Schritt 0: Zuerst beweisen, dass es überhaupt SAC ist

Das ist der wichtigste Abschnitt dieses Dokuments, denn der Zielrechner ist möglicherweise ein verwalteter Firmenrechner – und dort passt die Diagnose "SAC" nicht zur Aktenlage.

Microsoft schreibt im Windows 11 Security Book:

> "Smart App Control is disabled on devices enrolled in enterprise management. We suggest enterprises running line-of-business applications continue to use App Control for Business."

Und in der Support-FAQ steht als Abschaltgrund ausdrücklich: _"Your device is enterprise-managed or developer-mode has been configured."_ Auf einem Intune-verwalteten Gerät ist SAC also per Design aus. Wenn die Ausführung trotzdem blockiert wird, blockiert **etwas anderes** – und gegen eine AppLocker- oder WDAC-Richtlinie hilft kein Zertifikat, solange die IT den Publisher nicht in die Regel aufnimmt.

### Die vier Prüfungen

| Prüfung                  | Wo                                                                        | Was es bedeutet                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `citool.exe -lp`         | Eingabeaufforderung                                                       | Friendly Name `VerifiedAndReputableDesktop` + `Is Currently Enforced: true` = SAC im Enforcement. `…DesktopEvaluation` = Evaluation. Andere Policy = App Control for Business.                                                                                                                                         |
| Event-ID **3077**        | Ereignisanzeige > … > Microsoft > Windows > **CodeIntegrity/Operational** | SAC hat blockiert (3076 = Evaluation, also nur protokolliert).                                                                                                                                                                                                                                                         |
| Event-ID **8004 / 8007** | … > Microsoft > Windows > **AppLocker**                                   | AppLocker hat blockiert. 8029/8036 ("due to Config CI policy") = App Control for Business.                                                                                                                                                                                                                             |
| Meldungstext             | Der Dialog selbst                                                         | SAC: _"Smart App Control has blocked part of this app"_, **ohne** Weiter-Klick. Gibt es "Weitere Informationen" > "Trotzdem ausführen", war es **SmartScreen** – dann reicht dieser Klick, und das ganze übrige Dokument ist gegenstandslos. Verschwindet die Datei vom Datenträger, war es **Defender** (Quarantäne). |

Merksatz: **Gibt es einen Weiter-Klick, war es nicht SAC.**

---

## Wie SAC entscheidet

Zweistufig, laut Support-FAQ:

1. Der Cloud-Dienst (Intelligent Security Graph) versucht ein sicheres Urteil über die Datei. Fällt es positiv aus, läuft sie.
2. Gelingt kein sicheres Urteil, prüft SAC die Signatur. Ist sie gültig, läuft die App. _"If the app is unsigned, or the signature is invalid, Smart App Control will consider it untrusted and block it."_

Daraus folgen drei Konsequenzen, die man kennen muss:

- **Selbst kompilieren hilft nicht.** Die Prüfung hängt am Ladevorgang jeder PE-Datei, nicht am Mark-of-the-Web und nicht an der Herkunft. _"Malware, Potentially Unwanted Apps (PUA), and unknown, unsigned code are blocked by default."_ Eine lokal gebaute, unsignierte `WatIs.exe` ist für SAC dasselbe wie eine heruntergeladene.
- **Die portable EXE hilft nicht.** _"Smart App Control signature checks apply to all executable files, not just those downloaded from the Internet."_
- **"Zulassen" in den Dateieigenschaften hilft nicht.** Das entfernt den Mark-of-the-Web und wirkt gegen SmartScreen, nicht gegen SAC.

---

## SAC abschalten – die kostenlose Lösung, und was sie kostet

**Weg:** Einstellungen > Datenschutz und Sicherheit > Windows-Sicherheit > App- und Browsersteuerung > Einstellungen für Smart App Control > **Aus**.

### Die wichtigste Korrektur in diesem Dokument

Die verbreitete Warnung, das Abschalten sei eine Einbahnstraße und nur per Windows-Neuinstallation umkehrbar, **ist überholt**. Die Support-FAQ sagt inzwischen wörtlich:

> "Recent Windows updates allow Smart App Control to be re-enabled without requiring a clean installation."

(Am 2026-08-30 live abgerufen und verifiziert.) Microsoft empfiehlt dort sogar selbst das temporäre Abschalten für Installationen. **Achtung beim Nachlesen:** Die Entwicklerdoku (`test-your-app-with-smart-app-control`, ms.date 2025-10-28) behauptet noch das Gegenteil (_"one-way operation"_). Das ist Doku-Drift; die Consumer-FAQ ist neuer und maßgeblich. Nur der **Evaluation-Modus** bleibt ohne Reset unerreichbar.

Welches Update die Lockerung gebracht hat, ist **[UNGEKLÄRT]** – Blogs nennen KB5083769 vom 14.04.2026, aber die Changelogs beider April-KBs erwähnen Smart App Control nachweislich nicht. Praktisch irrelevant: entscheidend ist, ob der Schalter am konkreten Gerät bedienbar ist.

### Der Preis

- Es entfällt die SAC-Schutzschicht für das **gesamte System**, nicht nur für WatIs?. SmartScreen und Defender bleiben aktiv.
- Es braucht **Adminrechte** (die Einstellung liegt unter `HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy`, Wert `VerifiedAndReputablePolicyState`). Ein wörtlicher Microsoft-Beleg für die Adminpflicht fehlt, aus dem Speicherort folgt sie aber zwingend – **[ABGELEITET]**.
- Auf einem verwalteten Gerät ist der Schalter ausgegraut. Und selbst wenn nicht: auf einem Firmenrechner eine Schutzfunktion ohne Rücksprache mit der IT abzuschalten, ist die falsche Reihenfolge.

Ausdrücklich **nicht** empfohlen wird der von Microsoft nur "for testing purposes only" dokumentierte Registry-Weg über die Wiederherstellungsumgebung. Er ist seit der Lockerung überflüssig.

---

## Signieren: was SAC wirklich verlangt

> "Smart App Control will still allow an app to run if it is signed with a certificate issued by a certificate authority (CA) within the Trusted Root Program."

Daraus folgt:

- **OV genügt. EV wird nicht gebraucht.** Microsofts eigener Signierdienst stellt gar keine EV-Zertifikate aus (_"There's no plan to issue EV certificates in the future"_) und wird trotzdem als SAC-tauglicher Weg geführt. Der EV-Sofortbonus bei SmartScreen wurde 2024 abgeschafft; Microsoft schreibt selbst, der Aufpreis sei _"no longer justified"_.
- **Nur RSA, kein ECC.** _"Smart App Control allows applications signed with RSA-based digital certificates… It does not currently support elliptic-curve cryptography (ECC)."_ Ein ECC-signiertes Build wird trotz gültiger Signatur blockiert.
- **Alles muss signiert sein.** _"Developers should include all binaries, such as exe, dll, temp installer files, scripts, and uninstallers."_ Für WatIs? heißt das: `WatIs-Setup-x64.exe`, `WatIs-Portable-x64.exe`, `app.exe`, sämtliche mitgelieferten DLLs, `elevate.exe`, der NSIS-Uninstaller und die entpackten Temp-Dateien. Der häufigste teure Fehler ist der signierte Installer mit unsignierter Nutzlast: die Installation läuft durch, die Anwendung startet trotzdem nicht.
- **Verifizieren vor dem Ausrollen** mit der Audit-Policy `SmartAppControlAuditNoISG.bin` – sie blendet Reputationseffekte aus und zeigt allein, ob die Signaturabdeckung vollständig ist.

### Notwendig, aber nicht garantiert hinreichend

Es gibt dokumentierte Fälle, in denen SAC trotz RSA-4096-signierter Binaries blockiert hat, weil keine Reputation vorlag. Microsofts eigene SmartScreen-Seite relativiert entsprechend: _"Even when signed, a newly created binary could still show a SmartScreen warning until its hash or publisher certificate accumulates sufficient evidence of positive reputation."_ Reputation wächst nur organisch – _"no exact threshold, but it can take several weeks and hundreds of clean installs from a wide audience"_ – und für Privatnutzer gibt es **keinen** Einreichungsmechanismus; das WDSI-Portal ist für Malware-Meldungen und steht in dieser Funktion nur Enterprise-Admins offen.

Konsequenz für ein Nischenprojekt mit zweistelligen Downloadzahlen: die **Hash**-Reputation baut sich womöglich nie auf. Was zählt, ist die **Zertifikats**-Reputation – deshalb: nie das Zertifikat wechseln, jedes Release konsistent signieren.

---

## Die Optionen, sortiert nach dem, was für eine Privatperson realistisch ist

### 1. SignPath Foundation – 0 EUR

Kostenloses OV-Codesigning für Open Source, HSM-gestützt, von Microsoft in der offiziellen Code-Signing-Übersicht selbst genannt.

**Preis, den man zahlt:** Das Zertifikat lautet auf **SignPath Foundation** – sie erscheint in allen Windows-Dialogen als Herausgeber, nicht du und nicht "WatIs". Die Publisher-Reputation wächst damit auf eine fremde Identität. Bedingungen (signpath.org/terms.html, live geprüft): OSI-Lizenz ohne kommerzielles Dual-Licensing, _"No proprietary code"_ (Systembibliotheken erlaubt), aktiv gepflegt, bereits released, dokumentiert; MFA für alle Beteiligten, getrennte Rollen Authors/Reviewers/Approvers, **manuelle Freigabe jedes Releases**, und auf der Projekt-Homepage der Satz _"Free code signing provided by SignPath.io, certificate by SignPath Foundation"_.

**[UNGEKLÄRT]:** ob die gebündelte Electron-/Chromium-Distribution die "no proprietary code"-Klausel berührt und ob die Nähe zur fremden Marke WhatsApp in der Prüfung Rückfragen auslöst.

### 2. Certum "Open Source Code Signing in the Cloud" – 49,00 EUR/Jahr

Preise am 2026-08-30 direkt aus Certums Shop verifiziert: **Cloud 49,00 EUR**, Set mit cryptoCertum-Karte 69,00 EUR, reiner Code 25,00 EUR. Zum Vergleich im selben Shop: Standard Cloud 209,00 EUR, EV Cloud 379,00 EUR. Cloud heißt: **kein Token, kein Versand, keine HSM-Zusatzgebühr**.

> **Widerspruch aufgelöst:** Mehrere Vergleichsportale behaupten, Certum sei für Open Source kostenlos. Certums eigene Preisseite widerlegt das. Vermutlich eine Verwechslung mit SignPath.

**Preis, den man zahlt:** 49 EUR/Jahr, Identitätsprüfung mit Ausweis und Adressnachweis, im Organization-Feld steht "Open Source Developer". Bei kommerziellem Vertrieb wird widerrufen. Seit 27.02.2026 max. 459 Tage Laufzeit pro Zertifikat. **[UNGEKLÄRT]:** ob Certums Cloud-Signierung (SimplySign) unbeaufsichtigt in GitHub Actions läuft – sonst wird jedes Release Handarbeit.

### 3. Azure Artifact Signing – ca. 9,99 USD/Monat, für dich vermutlich verschlossen

Früher "Trusted Signing", davor "Azure Code Signing". Technisch ideal: kein Hardware-Token, native electron-builder-Integration, passt zum GitHub-Actions-Workflow. Basic ca. 9,99 USD/Monat (5.000 Signaturen), Premium ca. 99,99 USD/Monat (100.000). Die offizielle Azure-Preisseite rendert die Zahlen per JavaScript und liefert im Rohabruf nur "$-"; die 9,99 USD sind über learn.microsoft.com belegt.

**Der K.o. ist die Geografie**, nicht der Preis:

> "Public Trust certificates are available to organizations in the United States, Canada, the European Union, the United Kingdom, Australia, New Zealand, Japan, South Korea, Singapore, Switzerland, Norway, and Israel. **Individual developers must be located in the United States or Canada.**"

Eine deutsche Privatperson ohne Firma ist vom Individual-Pfad ausgeschlossen. Der Organization-Pfad steht der EU offen, verlangt aber Business Identifier, eine der Entität gehörende Website-Domain und eine E-Mail auf ebendieser Domain. Dazu: zwingend bezahltes Azure-Abo (_"doesn't support free, trial, or sponsored Azure subscriptions"_), keine anteilige Abrechnung, Identity Validation 1–20 Werktage mit nur drei Nachforderungsversuchen.

Die oft zitierte **3-Jahres-Firmenhistorie ist entfallen** – ein Microsoft-Mitarbeiter am 2026-08-17 in Microsoft Q&A: _"Artifact Signing has country/region onboarding pre-reqs, no minimum org age restrictions."_

### 4. Klassisches OV-Zertifikat – 150–300 USD/Jahr plus Hardware

Drei- bis zehnfacher Preis für dasselbe Ergebnis wie Certum Open Source. Seit Juni 2023 verlangt das CA/Browser Forum HSM oder Hardware-Token; ein USB-Token bricht die automatisierte Release-Pipeline. OV setzt eine validierbare Rechtsperson voraus – als Privatperson ohne Firma meist gar nicht erhältlich. Nur relevant, falls 1–3 ausscheiden.

### 5. EV-Zertifikat – nicht empfohlen

400+ USD/Jahr für null Zusatznutzen bei SAC. Der Sofortbonus bei SmartScreen ist seit 2024 weg. Sinnvoll nur noch für Kernel-Treibersignierung oder wenn eine Enterprise-Beschaffung es formal vorschreibt – beides trifft auf WatIs? nicht zu.

### 6. Microsoft Store (MSIX) – 0 EUR Gebühr, aber praktisch ausgeschlossen

Store-Pakete werden von Microsoft mit eigenem Zertifikat re-signiert und tragen volle Reputation. **Korrektur gegenüber älteren Angaben (19 USD Individual / 99 USD Company):** Beide Kontotypen sind inzwischen gebührenfrei – _"With the new onboarding experience, there are no registration fees for either account type"_ (learn.microsoft.com, Seite aktualisiert 2026-07-17, am 2026-08-30 live geprüft). Einstieg über storedeveloper.microsoft.com, Identitätsprüfung per Ausweis und Selfie.

Trotzdem realistisch ausgeschlossen: Ein Client, der `web.whatsapp.com` in Electron hostet und dessen Internals ausliest, wird die Store-Zertifizierung kaum bestehen. Der MSIX-Container kollidiert zudem mit den harten Projektregeln – `persist:wa`, Archiv außerhalb des Webview-Storage, GitHub-Releases-Updater, Nutzdaten unter `%LOCALAPPDATA%\watis`. Ein Wechsel bräuchte vorher ein ADR.

### 7. Was nachweislich nicht funktioniert

| Idee                                                               | Warum es scheitert                                                                                                                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selbst kompilieren statt herunterladen                             | Unsigniert bleibt unsigniert; SAC prüft die PE-Datei beim Laden, nicht die Herkunft.                                                                                            |
| Portable EXE statt Installer                                       | _"signature checks apply to all executable files"_.                                                                                                                             |
| winget-Aufnahme                                                    | Verleiht keine SAC-Vertrauensstufe.                                                                                                                                             |
| Selbstsigniertes Zertifikat, auch lokal in Trusted Root importiert | Kette führt nicht ins Microsoft Trusted Root Program.                                                                                                                           |
| Selbstsigniertes MSIX (Sideload)                                   | Erlaubt die Installation, macht die App zur Laufzeit nicht vertrauenswürdig.                                                                                                    |
| Datei bei Microsoft "freischalten lassen"                          | Für Consumer existiert kein solcher Mechanismus.                                                                                                                                |
| Dev-Modus (`npm start` gegen electron.exe aus node_modules)        | Ob die prebuilt `electron.exe` überhaupt Authenticode-signiert ausgeliefert wird, ist **[UNGEKLÄRT]**; die nativen `.node`-Module sind es sicher nicht. Kein verlässlicher Weg. |

Bewusst **nicht** aufgeführt und ausdrücklich nicht empfohlen: signierte Loader missbrauchen, DLL-Sideloading in vertrauenswürdige Prozesse, Manipulation von Reputationsdaten. Das sind Malware-Techniken. Sie würden fremden Code genauso durchlassen wie eigenen und untergraben genau den Schutz, um dessen legitime Erfüllung es hier geht.

---

## Empfehlung

1. **Diagnostizieren** (`citool -lp`, CodeIntegrity-Eventlog, AppLocker-Kanal). Kostet nichts, verhindert eine Fehlinvestition. Zeigt sich AppLocker oder App Control for Business: ab hier hilft nur die IT.
2. **Ist es wirklich SAC auf dem eigenen Rechner:** SAC bewusst abschalten. Das ist die ehrliche kostenlose Antwort – der Preis ist nicht Geld, sondern die geräteweite Schutzschicht, und die Entscheidung ist seit 2026 reversibel.
3. **Unabhängig davon signieren**, damit andere WatIs? überhaupt installieren können: zuerst SignPath Foundation anfragen (0 EUR, Preis ist die fremde Publisher-Identität), sonst Certum Open Source Cloud für 49 EUR/Jahr.
4. **Signaturabdeckung im Build sicherstellen** – alle EXE, alle DLL, Uninstaller, portable EXE; RSA statt ECC; mit `SmartAppControlAuditNoISG.bin` verifizieren, bevor Geld fließt.
5. **Kein EV.**

---

## Offene Punkte

- Ob der Zielrechner tatsächlich verwaltet ist – die wichtigste Variable, sie entscheidet, welche Hälfte dieses Dokuments überhaupt anwendbar ist.
- Ob ein OV-signiertes Electron-Paket bei aktivem SAC tatsächlich sofort durchgelassen wird oder erst nach Reputationsaufbau. **[UNGEKLÄRT]**, dokumentierte Gegenbeispiele existieren.
- Ob SignPath bzw. Certum ein Projekt akzeptieren, das eine fremde Marke im Funktionsumfang berührt. **[UNGEKLÄRT]**
- Ob Certums Cloud-Signierung CI-tauglich ist. **[UNGEKLÄRT]**
- Ob eine deutsche Privatperson ohne Gewerbe den Organization-Pfad bei Azure Artifact Signing nutzen kann. **[UNGEKLÄRT]** – vor jeder Abo-Buchung per Support-Ticket klären.
- Der deutsche Wortlaut der SAC-Blockmeldung ist nicht primärbelegt; nur die englischen Strings sind verifiziert. **[UNGEKLÄRT]**

---

## Quellen

| Aussage                                                                                                      | Quelle                                                                                        | Status                                          |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Keine Ausnahme für einzelne Apps; Wiedereinschalten ohne Neuinstallation; Abschaltgründe                     | support.microsoft.com, Smart App Control FAQ                                                  | **live geprüft 2026-08-30**                     |
| Zertifikat einer Trusted-Root-Program-CA genügt; unsigned code blocked by default; Clean-Install-Requirement | learn.microsoft.com/windows/apps/develop/smart-app-control/overview                           | geprüft                                         |
| Nur RSA, kein ECC                                                                                            | learn.microsoft.com/.../code-signing-for-smart-app-control                                    | geprüft                                         |
| "one-way operation" (veraltet), citool, Event-IDs 3076/3077, Registry-Pfad                                   | learn.microsoft.com/.../test-your-app-with-smart-app-control                                  | geprüft, **inhaltlich überholt**                |
| Alle Binaries signieren; SAC auf verwalteten Geräten deaktiviert                                             | learn.microsoft.com/windows/security/book/application-security-application-and-driver-control | geprüft                                         |
| EV ohne SmartScreen-Vorteil seit 2024; OV 150–300 USD, EV 400+ USD; SignPath-Empfehlung                      | learn.microsoft.com/.../code-signing-options und .../smartscreen-reputation                   | geprüft                                         |
| Kein EV; kein Free-/Trial-Abo; keine anteilige Abrechnung                                                    | learn.microsoft.com/azure/artifact-signing/faq                                                | geprüft                                         |
| Individual nur USA/Kanada; 1–20 Werktage; drei Appeals                                                       | learn.microsoft.com/azure/artifact-signing/quickstart                                         | geprüft                                         |
| Certum 49/69/25 EUR, Standard 209 EUR, EV 379 EUR                                                            | shop.certum.eu/code-signing.html                                                              | **live geprüft 2026-08-30**                     |
| Zertifikat auf SignPath Foundation; OSS-Bedingungen; Attributionspflicht                                     | signpath.org/terms.html                                                                       | **live geprüft 2026-08-30**                     |
| Keine Registrierungsgebühr für Individual- und Company-Konto                                                 | learn.microsoft.com/windows/apps/publish/partner-center/open-a-developer-account              | **live geprüft 2026-08-30**                     |
| AppLocker Event-IDs 8004/8007/8029/8036                                                                      | learn.microsoft.com/.../applocker/using-event-viewer-with-applocker                           | geprüft                                         |
| KB5083769 als Auslöser der Lockerung                                                                         | Blogs (windowslatest, ciaops)                                                                 | **nicht belegt**, Changelogs erwähnen SAC nicht |
