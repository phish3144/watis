# `src/main/outgoing` — der einzige Sendepfad

Dies ist die **einzige** Stelle im Projekt, an der WatIs? etwas an WhatsApp schickt. Festgelegt in
[ADR 0004](../../../docs/decisions/0004-bridge-roaming-direktantwort.md), Abschnitt C.

## Was hier hineingehört

Ausschließlich die Direktantwort aus einer Benachrichtigung, und nur unter allen Bedingungen zugleich:

- **Nie über interne Store-APIs.** Der Text wird in die sichtbare Eingabezeile der
  WhatsApp-Web-Oberfläche geschrieben und abgeschickt, exakt so, wie es ein Tastendruck täte.
  Die Bridge in `src/main/bridge` bleibt dadurch wörtlich read-only.
- **Nur Klartext.** Keine Medien, keine Anhänge, keine Formatierung, keine Zitate, keine Reaktionen.
- **Nur reaktiv.** Nur in einen Chat, aus dem soeben eine Nachricht kam und für den ein Toast offen ist.
- **Eine Antwort pro Toast.** Kein Bulk, kein Scheduling, kein Auto-Reply, keine Vorlagen.
- **Standardmäßig aus.** Feature-Flag, das der Nutzer aktiv einschalten muss.
- **Auditierbar.** Jede Antwort erzeugt einen Eintrag in `logs/outgoing.log`.

## Was hier nicht hineingehört

Alles andere. Löschen, Blockieren, Gruppen ändern, Als-gelesen-markieren, Status posten, Kontakte
bearbeiten – nichts davon, auch nicht als Experiment und auch nicht hinter einem Flag.

## Wie das durchgesetzt wird

`eslint.config.mjs` verbietet die Schreibaufrufe der WhatsApp-Internals im gesamten `src/`-Baum und
nimmt nur dieses Verzeichnis aus. Ein Pull Request, der Sendecode woanders einführt, scheitert am
Linter, nicht erst am Review.

Das Verbot lauschender Sockets gilt auch hier ohne Ausnahme.
