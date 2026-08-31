# Performance-Profil

Verlangt von PLAN.md Phase 9. Gemessen von `test/e2e/performance.spec.ts` gegen die echte
Electron-App; jeder Lauf schreibt `performance-profile.json`.

## Wie hier gemessen wird — und warum nicht als Summe

Electron liefert pro Prozess den **Working Set**. Diese Zahlen zu addieren ergibt eine
Gesamtzahl, die niemand gebrauchen kann: Jeder Chromium-Prozess bildet dasselbe Framework und
dieselben Bibliotheken ab, und der Working Set zählt diese Seiten in **jedem** Prozess mit. Die Summe
lag im ersten Anlauf bei 805 MiB — eine Zahl, die vor allem aussagt, dass sieben Prozesse laufen.

Das Profil nennt deshalb die Teile einzeln, und die Schwellen gelten für den Teil, den dieses
Projekt tatsächlich in der Hand hat: **den Main-Prozess.**

## Messwerte

Entwicklungsrechner (Container, geteilte CPU, Linux), 7 Prozesse, WhatsApp Web nicht angemeldet:

| Prozess                  | Leerlauf  | Unter Last |
| ------------------------ | --------- | ---------- |
| Main (`Browser`)         | 178,5 MiB | 209,9 MiB  |
| GPU                      | 135,4 MiB | 135,9 MiB  |
| Utility (Archiv + Index) | 313,2 MiB | 339,6 MiB  |
| Renderer (`Tab`)         | 177,4 MiB | 199,8 MiB  |

Last = 50 000 Nachrichten über den echten IPC-Kanal in Batches à 500: **11,0 s, 4 529 Zeilen/s.**

## Was die Schwellen abfangen

|                                    |                                                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Main wächst unter Last um < 80 MiB | Main hält keinen Datenbank-Handle und puffert nichts pro Nachricht. 50 000 Zeilen dürfen ihn kaum bewegen. Gemessen: **+31 MiB.** Wächst er hier deutlich, hat sich jemand etwas gemerkt, was in den Worker gehört |
| Main im Leerlauf < 400 MiB         | Gemessen: 178 MiB                                                                                                                                                                                                  |

Die Grenzen sind großzügig, weil sie nur den einen Fehler fangen müssen, der zählt: dass der
Main-Prozess anfängt zu akkumulieren. Eine enge Grenze auf einer geteilten CI-Maschine wäre ein
Test, der gelegentlich grundlos rot ist — und der wird abgeschaltet, nicht repariert.

## Vergleich mit der Store-App

**Steht aus.** Ein ehrlicher Vergleich braucht beide Anwendungen auf derselben Maschine mit
demselben angemeldeten Konto und demselben Chatbestand; hier läuft weder Windows noch eine
angemeldete Sitzung. Was sich ohne das sagen lässt, ist strukturell:

- WatIs? startet **sieben** Prozesse: Main, GPU, zwei Renderer (WhatsApp und das eigene Panel) und
  zwei `utilityProcess`-Worker plus deren Verwaltung. Die Store-App startet die Chromium-Prozesse
  auch, aber keine Worker — dafür macht sie weder Archiv noch Volltextindex noch Texterkennung.
- Der Preis für das Archiv ist der Utility-Prozess. Das ist eine bewusste Entscheidung und der Grund,
  warum Main überhaupt so klein bleibt: Ein synchroner SQLite-Handle im Main-Prozess wäre billiger
  im Speicher und würde die Oberfläche bei jeder langen Abfrage einfrieren (§5.6).

Die Zahl für den Vergleich gehört in einen Release-Test unter Windows und ist als offener Punkt in
PLAN.md Phase 9 vermerkt.
