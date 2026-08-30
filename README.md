# WatIs?

Ein Desktop-Client für WhatsApp Web mit lokalem Archiv, Volltextsuche und ordentlicher
Desktop-Integration. Für Windows 10/11; macOS wird mitgebaut.

> **Status: in Entwicklung.** Es gibt noch kein benutzbares Release. Der verbindliche Plan steht in
> [`PLAN.md`](PLAN.md), die getroffenen Entscheidungen in [`docs/decisions/`](docs/decisions/).

## Was es macht

- Hostet `web.whatsapp.com` in Electron mit persistenter Session – kein erneutes QR-Scannen nach Updates
- Spiegelt Nachrichten, Chats und Medien in eine lokale SQLite-Datenbank mit Volltextsuche
- Lädt History vom Handy nach, so weit WhatsApp Web sie liefert
- Speichert Dateien ohne Dialog in eine feste Ordnerstruktur
- Macht Text in Bildern (OCR), in PDFs und – auf Anforderung – in Sprachnachrichten durchsuchbar
- Tray, Badge, native Benachrichtigungen, Autostart, Shortcuts, Themes, Declutter-Schalter
- Exportiert alles in offene Formate (JSON, HTML, TXT)

Alles läuft lokal. Keine Telemetrie, keine Cloud, keine Accounts, keine laufenden Kosten.

## Was es bewusst nicht macht

- **Kein Protokoll-Client.** Alles läuft über den offiziellen Web-Client.
- **Keine Sende-Automatisierung.** Kein Scheduling, keine Bots, kein Bulk, kein Auto-Reply.
- **Kein Schreiben oder Löschen** über die internen Schnittstellen von WhatsApp Web. Die Bridge ist strikt
  read-only.
- **Nichts, was Adminrechte braucht.** Keine Dienste, keine HKLM-Registry, keine offenen Ports.

## Ehrliche Hinweise

- Dies ist **kein offizielles WhatsApp-Produkt** und steht in keiner Verbindung zu Meta. WhatsApp ist eine
  Marke von Meta Platforms, Inc.
- Der Client hängt an internen Strukturen von WhatsApp Web. Ein WhatsApp-Update kann Teile davon jederzeit
  brechen. Die App ist so gebaut, dass sie dann degradiert statt abzustürzen – aber sie tut es.
- Das Archiv liegt **unverschlüsselt** auf der Platte. Der Schutz kommt von der Laufwerksverschlüsselung
  des Betriebssystems (BitLocker, FileVault). Wer das nicht hat, sollte es einschalten.
- Das Archiv enthält Nachrichten anderer Leute, auch gelöschte, sobald sie einmal gespiegelt wurden.
  Das ist der Sinn eines Archivs, aber es ist eine bewusste Entscheidung – und je nach Umfeld und
  Rechtslage eine, die man treffen muss, nicht eine, die einem passiert.
- Die Installation ist **nicht signiert**. Windows SmartScreen zeigt beim ersten Start eine Warnung; sie
  wird über „Weitere Informationen → Trotzdem ausführen" bestätigt und braucht keine Adminrechte.
- Nutzung auf eigenes Risiko.

## Lizenz

[MIT](LICENSE)
