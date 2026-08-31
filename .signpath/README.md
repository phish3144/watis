# SignPath-Konfiguration

Kostenloses Code Signing für Open Source über die [SignPath Foundation](https://signpath.org/).
Hintergrund und die Abwägung dazu: [`docs/free-signing.md`](../docs/free-signing.md).

## Was noch von Hand zu prüfen ist

Die Pipeline in [`.github/workflows/release.yml`](../.github/workflows/release.yml) ist fertig, aber
vier Werte darin sind **angenommen** und müssen gegen das echte SignPath-Projekt abgeglichen werden,
sobald der Antrag bewilligt ist. Sie stehen im Job `release-windows-signed`:

| Wert                          | angenommen        | wo nachsehen                                |
| ----------------------------- | ----------------- | ------------------------------------------- |
| `project-slug`                | `watis`           | SignPath → Projekt → Slug                   |
| `signing-policy-slug`         | `release-signing` | Projekt → Signing Policies                  |
| `artifact-configuration-slug` | `app`             | Projekt → Artifact Configurations (Phase 1) |
| `artifact-configuration-slug` | `installers`      | Projekt → Artifact Configurations (Phase 2) |

Die beiden Artifact Configurations werden im SignPath-Portal angelegt; der Inhalt ist
[`app.xml`](app.xml) bzw. [`installers.xml`](installers.xml).

## Repository-Secrets

Zwei Stück. Solange **eines** davon fehlt, läuft der bisherige unsignierte Release-Pfad unverändert
weiter — das Hinzufügen der Signier-Pipeline kann einen Release also nicht kaputt machen.

| Secret                     | Inhalt                       |
| -------------------------- | ---------------------------- |
| `SIGNPATH_API_TOKEN`       | SignPath → User → API Tokens |
| `SIGNPATH_ORGANIZATION_ID` | SignPath → Organization → ID |

Zusätzlich muss die **SignPath GitHub App** für das Repository installiert sein. Ohne sie schlägt die
Origin Verification fehl, die für Open-Source-Abonnements Pflicht ist.

## Warum zwei Signaturen pro Release

SignPath kann nicht in die Nutzlast eines NSIS-Installers hineinsignieren — NSIS ist keines der
unterstützten Containerformate. Deshalb:

1. `--dir` baut die Anwendung → `WatIs.exe` wird signiert
2. Die Installer werden um die **bereits signierte** Anwendung herum gebaut
3. `WatIs-Setup-x64.exe` und `WatIs-Portable-x64.exe` werden signiert

Jede der beiden Anfragen wartet auf einen menschlichen Klick — die Foundation-Bedingungen verlangen
das ausdrücklich: _„Every release needs manual approval for signing."_ Ein Release kostet also zwei
Freigaben. Der CI-Job wartet bis zu einer Stunde je Anfrage.

## Was NICHT signiert wird

Nur `WatIs.exe` und die beiden Installer. Die Electron-Laufzeit-DLLs und better-sqlite3s `.node`
sind fremde Open-Source-Binaries, und die Bedingungen sind da eindeutig:

> „remember that upstream OSS projects' binaries must not be signed using your subscription, but may
> be included in signed packages and installers"

Sie fahren also unsigniert mit, was erlaubt ist.
