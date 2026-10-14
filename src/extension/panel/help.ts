/**
 * The help that ships inside the panel: short articles, readable offline, in plain German.
 *
 * The interface explains itself in one sentence where something happens; everything beyond that
 * sentence is here, one click away ("Mehr dazu"). Each article answers what somebody asks at that
 * moment, not what the code does — and says what to do when something goes wrong.
 *
 * It has to stay true as the software changes (CLAUDE.md, "Hilfe aktuell halten"), so as little
 * as possible is written twice:
 * - the search syntax, the reasons a file did not come and the states of the status line are
 *   rendered from the same data the interface uses (`generated` blocks);
 * - model sizes come from whisper-models.json (`{size:base}`, `{size:small}`);
 * - every label of this interface the text names is written `[[like this]]`, and
 *   test/unit/help.test.ts fails when one of them no longer exists in strings.ts — renaming a
 *   button without updating the help breaks the build.
 *
 * Markup: `**bold**`, `[[label of this interface]]` (shown bold, checked), `` `typed text` ``.
 * Labels of the browser's own pages (Neu laden, Entfernen …) are plain bold: not ours to check.
 *
 * A block can carry `when`: then it shows only in that browser, or only for that kind of install.
 * The help names no browser but the one it runs in — the Edge Add-ons policy forbids an extension
 * to reference other browsers (1.1.2), and the steps differ anyway — and it explains updating from
 * a ZIP only to somebody who installed from one.
 */

import {
  SEARCH_SYNTAX,
  type HelpArticle as SharedHelpArticle,
  type HelpBlock as SharedHelpBlock,
} from '@shared/help/content'

export type HelpTopic =
  | 'erste-schritte'
  | 'suchen'
  | 'chats'
  | 'medien'
  | 'texterkennung'
  | 'sprachnachrichten'
  | 'sicherung'
  | 'aktualisieren'
  | 'datenschutz'
  | 'probleme'
  | 'grenzen'

type Generated = 'search-syntax' | 'media-problems' | 'status'

/** The browser the panel runs in. Other Chromium browsers read the Chrome text. */
export type HelpBrowser = 'chrome' | 'edge' | 'firefox'

/** `store`: installed from the browser's add-on store, which updates it. `manual`: from the ZIP. */
export type HelpInstall = 'store' | 'manual'

export interface HelpContext {
  browser: HelpBrowser
  install: HelpInstall
}

/** Where a block applies. Absent fields mean "everywhere". */
export interface HelpCondition {
  browser?: readonly HelpBrowser[]
  install?: HelpInstall
}

export type HelpBlock = SharedHelpBlock<Generated> & { when?: HelpCondition }

export interface HelpArticle extends Omit<SharedHelpArticle<HelpTopic, Generated>, 'body'> {
  body: HelpBlock[]
}

/** Every situation the help is written for, for the tests. */
export const HELP_CONTEXTS: readonly HelpContext[] = (
  ['chrome', 'edge', 'firefox'] as const
).flatMap((browser) => (['store', 'manual'] as const).map((install) => ({ browser, install })))

export function appliesTo(block: HelpBlock, context: HelpContext): boolean {
  const when = block.when
  if (!when) return true
  if (when.browser && !when.browser.includes(context.browser)) return false
  if (when.install && when.install !== context.install) return false
  return true
}

/** The blocks of an article that are true where the panel runs. */
export function bodyFor(article: HelpArticle, context: HelpContext): HelpBlock[] {
  return article.body.filter((block) => appliesTo(block, context))
}

const CHROMIUM: HelpCondition = { browser: ['chrome', 'edge'] }
const FIREFOX: HelpCondition = { browser: ['firefox'] }

// Rows of "Wenn etwas nicht klappt", combined below per browser and kind of install.
const ROW_MEDIA: [string, string] = [
  'Ein Bild oder Video kommt nicht',
  'Siehe „Bilder, Videos und Sprachnachrichten" – meist ist es nicht mehr auf WhatsApps Servern.',
]
const ROW_TRANSCRIBE: [string, string] = [
  'Transkribieren meldet einen Fehler',
  'Ist ein Sprachmodell geladen?',
]
const ROW_TRANSCRIBE_FIREFOX: [string, string] = [
  'Transkribieren meldet einen Fehler',
  'Ist ein Sprachmodell geladen? Ist der WhatsApp-Tab offen?',
]
const ROW_OTHER_FOLDER: [string, string] = [
  'Nach einem Update ist das Archiv leer',
  'Die neue Version wurde in einen anderen Ordner entpackt. Den alten Ordner wieder laden.',
]
const ROW_DEVELOPER_MODE: [string, string] = [
  'Der Entwicklermodus ist ausgegraut',
  'Die IT hat ihn gesperrt. WatIs? aus dem Add-on-Store deines Browsers braucht ihn nicht, und die IT kann es dort freigeben. Wie du mit deinem Archiv umsteigst, steht unter „Aktualisieren, ohne etwas zu verlieren“.',
]
const ROW_GONE_AFTER_RESTART: [string, string] = [
  'WatIs? ist nach dem Neustart weg',
  'Die ZIP wieder über „Temporäres Add-on laden …" laden – das Archiv ist noch da. Von addons.mozilla.org installiert, bleibt WatIs? dauerhaft, und dein Archiv kommt mit.',
]
const ROW_NO_UPDATES: [string, string] = [
  'WatIs? bekommt keine Updates',
  'Selbst geladen, aktualisiert es sich nicht. Aus dem Add-on-Store deines Browsers kommen Updates von selbst – siehe „Aktualisieren, ohne etwas zu verlieren“.',
]
const ROW_AFTER_UPDATE: [string, string] = [
  'Nach einem Update steht oben [[Wartet auf WhatsApp]]',
  'Den WhatsApp-Tab einmal neu laden. Das Archiv ist unverändert.',
]
const ROW_STORE_EMPTY: [string, string] = [
  'Das Archiv ist leer, obwohl WatIs? schon mitgeschrieben hat',
  'Hattest du WatIs? vorher selbst geladen? Für den Browser ist das eine andere Erweiterung mit eigenem Archiv. Dort [[Als ZIP herunterladen]], hier [[Sicherung zurückspielen]] → [[ZIP-Dateien wählen …]]. Das alte WatIs? erst danach entfernen.',
]

export { SEARCH_SYNTAX }

export const HELP: readonly HelpArticle[] = [
  {
    id: 'erste-schritte',
    title: 'Erste Schritte',
    summary: 'Was WatIs? macht und wie das Archiv sich füllt.',
    body: [
      {
        p: 'WatIs? schreibt mit, was in WhatsApp Web ankommt, und legt es in einem **durchsuchbaren Archiv auf deinem Rechner** ab. Wird eine Nachricht danach in WhatsApp gelöscht – von dir, vom Absender oder weil sie verschwindet –, behält dein Archiv sie.',
      },
      {
        steps: [
          '**WhatsApp Web öffnen** und wie gewohnt anmelden.',
          'Den Tab offen lassen. Solange er offen ist, schreibt WatIs? mit. Oben steht dann [[Archiv läuft]].',
          'Über das **WatIs?-Symbol** öffnest du dieses Panel: Suche, Chats, Medien und Einstellungen. Steht es nicht in der Symbolleiste, liegt es unter dem Puzzleteil neben der Adresszeile; dort lässt es sich anheften.',
        ],
      },
      {
        p: 'Beim ersten Mal übernimmt WatIs?, was WhatsApp Web gerade geladen hat. Ältere Nachrichten, die WhatsApp Web nicht geladen hat, kann WatIs? nicht holen. Der Nutzen liegt darin, dass **ab heute nichts mehr verloren geht**.',
      },
      {
        note: 'Einmal einrichten lohnt sich: unter [[Einstellungen]] → [[Archiv und Sicherung]] eine Sicherung anlegen. Das Archiv liegt im Browser und ist weg, wenn die Erweiterung entfernt wird.',
      },
      {
        p: 'Du hast WatIs? selbst geladen, aus einer ZIP. So aktualisiert es sich nicht von selbst, aus dem Add-on-Store deines Browsers schon. Wie du umsteigst, ohne dein Archiv zu verlieren, steht unter „Aktualisieren, ohne etwas zu verlieren“.',
        when: { install: 'manual' },
      },
    ],
    related: ['suchen', 'sicherung', 'aktualisieren', 'datenschutz'],
  },
  {
    id: 'suchen',
    title: 'Suchen',
    summary: 'Alle Chats auf einmal durchsuchen, auch Text in Bildern und PDFs.',
    body: [
      {
        p: 'Die Suche geht über **alle Chats gleichzeitig**: Nachrichten, Dateinamen, erkannter Text aus Bildern und PDFs und transkribierte Sprachnachrichten. Ein Klick auf einen Treffer öffnet den Chat an dieser Stelle.',
      },
      {
        p: 'Umlaute dürfen fehlen: „Muenchen" findet „München", „Gruesse" findet „Grüße". Groß- und Kleinschreibung ist egal.',
      },
      { h: 'Genauer suchen' },
      { generated: 'search-syntax' },
      {
        p: 'Alles lässt sich kombinieren: `Rechnung von:Anna nach:2026-01` findet Annas Rechnungen seit Januar.',
      },
      {
        p: 'Die Knöpfe unter dem Suchfeld – [[Nachrichten]], [[Text in Bildern]], [[PDFs]] und so weiter – schränken auf eine Quelle ein, ohne dass du etwas tippen musst.',
      },
    ],
    related: ['texterkennung', 'sprachnachrichten'],
  },
  {
    id: 'chats',
    title: 'Chats im Archiv',
    summary: 'Ältere Nachrichten lesen, zu einem Datum springen.',
    body: [
      {
        p: 'Unter [[Chats]] liegen alle Chats, die WatIs? mitgeschrieben hat, mit ihren Nachrichten und Anhängen – auch solchen, die in WhatsApp inzwischen gelöscht oder verschwunden sind.',
      },
      {
        list: [
          '[[Ältere laden]] zeigt weiter zurückliegende Nachrichten aus dem Archiv.',
          '[[Zu Datum springen]] öffnet den Chat an einem bestimmten Tag.',
          'Hat jemand eine Nachricht **für alle** gelöscht, bleibt sie im Archiv mit Text und Anhang stehen und ist mit „für alle gelöscht“ markiert. Die Suche findet sie weiterhin. Das gilt für Nachrichten, die WatIs? vor dem Löschen schon mitgeschrieben hatte.',
        ],
      },
      {
        note: 'Öffnet WatIs? einen Chat in WhatsApp Web, markiert WhatsApp ihn als gelesen – genauso, als hättest du ihn selbst angeklickt.',
      },
    ],
    related: ['suchen', 'medien'],
  },
  {
    id: 'medien',
    title: 'Bilder, Videos und Sprachnachrichten',
    summary: 'Was automatisch ins Archiv kommt und was auf Klick.',
    body: [
      {
        p: 'WhatsApp hält Medien nur eine begrenzte Zeit auf seinen Servern bereit. WatIs? holt sie deshalb **bald nach dem Eintreffen** ins Archiv.',
      },
      {
        table: [
          ['Bilder', 'automatisch'],
          ['Dokumente (PDF usw.)', 'automatisch'],
          ['Sprachnachrichten', 'auf Klick – oder automatisch, wenn du es einschaltest'],
          ['Videos', 'auf Klick – oder bis zu einer Größe, die du wählst'],
        ],
      },
      {
        p: 'Einstellen lässt sich das unter [[Einstellungen]] → [[Medien automatisch sichern]].',
      },
      { h: 'Noch nicht im Archiv' },
      {
        p: 'Steht bei einer Datei [[Noch nicht im Archiv]], ist sie noch nicht geholt. Ein Klick auf [[Laden]] holt sie jetzt. Dafür muss WhatsApp Web in einem Tab offen und angemeldet sein.',
      },
      { h: 'Wenn eine Datei nicht kommt' },
      { p: 'Dann steht bei der Datei, warum. Die häufigsten Gründe:' },
      { generated: 'media-problems' },
      { p: '[[Speichern]] legt eine Datei in deinen Download-Ordner, sortiert nach Chat.' },
    ],
    related: ['sprachnachrichten', 'sicherung', 'probleme'],
  },
  {
    id: 'texterkennung',
    title: 'Text in Bildern und PDFs',
    summary: 'Fotos von Zetteln und Rechnungen werden durchsuchbar.',
    body: [
      {
        p: 'WatIs? liest Text aus Bildern (zum Beispiel einem abfotografierten Zettel) und aus PDFs, auch eingescannten. Danach findet die Suche diesen Text wie eine Nachricht.',
      },
      {
        list: [
          'Das passiert **von selbst**, eine Datei nach der anderen, sobald sie im Archiv ist.',
          'Alles läuft **auf deinem Rechner**. Kein Bild verlässt ihn.',
          'Erkannt werden Deutsch und Englisch. Handschrift klappt selten.',
          'Ausschalten lässt es sich unter [[Einstellungen]] → [[Texterkennung und Transkription]].',
        ],
      },
      {
        p: 'Nur diesen Text suchen: Knopf [[Text in Bildern]] unter dem Suchfeld oder `quelle:ocr`.',
      },
    ],
    related: ['suchen'],
  },
  {
    id: 'sprachnachrichten',
    title: 'Sprachnachrichten zum Nachlesen',
    summary: 'Ein Klick macht aus einer Sprachnachricht Text, ganz auf deinem Rechner.',
    body: [
      {
        p: 'Unter jeder Sprachnachricht steht [[Transkribieren]]. Ein Klick macht daraus Text, der darunter erscheint und ab dann durchsuchbar ist. Ist die Sprachnachricht noch nicht im Archiv, holt WatIs? sie dabei gleich mit.',
      },
      { h: 'Beim ersten Mal' },
      {
        p: 'Dafür braucht es einmalig ein Sprachmodell ({size:base}). Beim ersten Klick fragt WatIs? direkt an der Sprachnachricht nach: [[Laden und transkribieren]] lädt das Modell von GitHub und wandelt danach sofort um. Der Browser fragt dabei einmal, ob WatIs? die Datei von GitHub laden darf. Danach reicht immer ein Klick.',
      },
      { h: 'Einstellen, wenn du willst' },
      {
        list: [
          'Unter [[Einstellungen]] → [[Texterkennung und Transkription]] gibt es neben [[Schnell]] ({size:base}, für klare Aufnahmen) auch [[Genau]] ({size:small}, auch bei Dialekt und Nebengeräuschen). Ist [[Schnell]] da, nimmt WatIs? dieses.',
          'Bei [[Sprache der Sprachnachrichten]] die Sprache wählen. Deutsch ist voreingestellt. [[Automatisch erkennen]] geht auch, dauert aber doppelt so lang.',
          'Ist GitHub im Firmennetz gesperrt: dieselbe Modelldatei von woanders besorgen und bei [[Modell aus einer Datei]] über [[Datei wählen …]] öffnen. WatIs? prüft sie gegen dieselbe Prüfsumme.',
        ],
      },
      {
        list: [
          'Die Umwandlung läuft **auf deinem Rechner**. Die Sprachnachricht geht nirgendwohin.',
          'Je nach Rechner dauert sie einige Sekunden bis zu einer Minute.',
        ],
      },
      {
        p: 'In Firefox rechnet der **WhatsApp-Tab**. Er muss dafür offen sein.',
        when: FIREFOX,
      },
    ],
    related: ['medien', 'datenschutz'],
  },
  {
    id: 'sicherung',
    title: 'Sicherung',
    summary: 'Das Archiv aus dem Browser holen, damit es nicht verloren geht.',
    body: [
      {
        p: 'Das Archiv liegt im Speicher deines Browsers. Abmelden, Cache leeren und Updates überlebt es. **Das Entfernen der Erweiterung oder ein zurückgesetztes Browserprofil nicht.** Eine Sicherung legt eine Kopie außerhalb des Browsers ab.',
      },
      { h: 'In einen Ordner', when: CHROMIUM },
      {
        when: CHROMIUM,
        steps: [
          '[[Einstellungen]] → [[Archiv und Sicherung]] → [[Ordner wählen …]]',
          'Einen Ordner aussuchen, zum Beispiel in „Dokumente". Auch ein Ordner, den OneDrive oder Nextcloud abgleicht, geht – dann liegt die Sicherung dort, wohin dieser Dienst sie bringt.',
          '[[Jetzt sichern]] klicken. Jedes weitere Mal kommt nur hinzu, was neu ist.',
        ],
      },
      {
        p: 'Nach einem Neustart des Browsers fragt er beim Sichern einmal nach, ob WatIs? wieder in den Ordner schreiben darf.',
        when: CHROMIUM,
      },
      { h: 'Als ZIP' },
      {
        p: 'In Firefox ist das der einzige Weg: Einen Ordner wählen lässt Firefox eine Erweiterung nicht.',
        when: FIREFOX,
      },
      {
        p: '[[Als ZIP herunterladen]] legt die Sicherung in deinen Download-Ordner unter „WatIs/Sicherung“. Die erste ZIP enthält alles, jede weitere nur die neuen Medien seit der letzten; [[Alle Medien neu]] packt wieder alles ein. Große Archive kommen in mehreren Teilen von höchstens 1 GB.',
      },
      { h: 'Zurückspielen' },
      {
        p: 'Nach dem Entfernen der Erweiterung, in einem neuen Browserprofil oder beim Umstieg vom selbst geladenen WatIs? auf das aus dem Add-on-Store beginnt das Archiv leer – für den Browser sind die beiden zwei verschiedene Erweiterungen. So kommt es zurück:',
        when: CHROMIUM,
      },
      {
        p: 'Nach dem Entfernen der Erweiterung oder in einem neuen Browserprofil beginnt das Archiv leer. So kommt es zurück:',
        when: FIREFOX,
      },
      {
        when: CHROMIUM,
        steps: [
          '[[Einstellungen]] → [[Archiv und Sicherung]] → [[Sicherung zurückspielen]]',
          '[[Aus einem Ordner …]] wählt den Sicherungsordner. [[ZIP-Dateien wählen …]] nimmt die ZIP-Sicherungen – **alle auf einmal markieren**, denn jede nach der ersten enthält nur die neuen Medien.',
          'WatIs? sagt, von wann die Sicherung ist und wie viele Medien sie enthält. [[Zurückspielen]] klicken.',
        ],
      },
      {
        when: FIREFOX,
        steps: [
          '[[Einstellungen]] → [[Archiv und Sicherung]] → [[Sicherung zurückspielen]]',
          '[[ZIP-Dateien wählen …]] nimmt die ZIP-Sicherungen – **alle auf einmal markieren**, denn jede nach der ersten enthält nur die neuen Medien.',
          'WatIs? sagt, von wann die Sicherung ist und wie viele Medien sie enthält. [[Zurückspielen]] klicken.',
        ],
      },
      {
        list: [
          'Die Sicherung **ersetzt** das Archiv in diesem Browser. Was WhatsApp Web gerade zeigt, holt WatIs? danach von selbst wieder dazu.',
          'Medien, die hier schon liegen, bleiben, und kommen nicht doppelt.',
          'Auch eine Sicherung der Desktop-App lässt sich so zurückspielen – sie hat dasselbe Format: die Datenbank archive.sqlite und die Medien im Ordner blobs.',
        ],
      },
    ],
    related: ['aktualisieren', 'datenschutz'],
  },
  {
    id: 'aktualisieren',
    title: 'Aktualisieren, ohne etwas zu verlieren',
    summary: 'Neue Versionen bekommen, ohne das Archiv zu verlieren.',
    body: [
      {
        p: 'Neue Versionen kommen **von selbst** aus dem Add-on-Store deines Browsers. Du musst nichts tun, und dein Archiv bleibt dabei erhalten.',
        when: { install: 'store' },
      },
      {
        p: 'Steht nach einem Update oben [[Wartet auf WhatsApp]], obwohl WhatsApp Web offen ist: den WhatsApp-Tab einmal neu laden. Dann schreibt WatIs? weiter mit.',
        when: { install: 'store' },
      },
      {
        p: 'Selbst geladen, aktualisiert sich WatIs? nicht von selbst. Aus dem Add-on-Store deines Browsers schon: Einmal umsteigen, danach kommen neue Versionen von allein.',
        when: { install: 'manual' },
      },
      { h: 'In den Chrome Web Store umsteigen', when: { browser: ['chrome'], install: 'manual' } },
      {
        when: { browser: ['chrome'], install: 'manual' },
        steps: [
          'Hier sichern: [[Einstellungen]] → [[Archiv und Sicherung]] → [[Als ZIP herunterladen]]. Hast du schon einmal als ZIP gesichert, nimm [[Alle Medien neu]] – dann steckt alles in dieser einen Sicherung.',
          'WatIs? im **Chrome Web Store** suchen und **Zu Chrome hinzufügen**. Für Chrome ist das eine zweite Erweiterung: Sie beginnt mit einem leeren Archiv.',
          'Im neuen WatIs?: [[Einstellungen]] → [[Archiv und Sicherung]] → [[Sicherung zurückspielen]] → [[ZIP-Dateien wählen …]], alle Teile der Sicherung auf einmal markieren und [[Zurückspielen]].',
          'Findet die Suche dort deine alten Nachrichten, unter chrome://extensions dieses WatIs? entfernen – das mit dem runden Pfeil **Neu laden**. Erst dann, denn **Entfernen** löscht sein Archiv.',
        ],
      },
      { h: 'Zu den Edge-Add-ons umsteigen', when: { browser: ['edge'], install: 'manual' } },
      {
        when: { browser: ['edge'], install: 'manual' },
        steps: [
          'Hier sichern: [[Einstellungen]] → [[Archiv und Sicherung]] → [[Als ZIP herunterladen]]. Hast du schon einmal als ZIP gesichert, nimm [[Alle Medien neu]] – dann steckt alles in dieser einen Sicherung.',
          'WatIs? bei den **Edge-Add-ons** suchen und **Abrufen**. Für Edge ist das eine zweite Erweiterung: Sie beginnt mit einem leeren Archiv.',
          'Im neuen WatIs?: [[Einstellungen]] → [[Archiv und Sicherung]] → [[Sicherung zurückspielen]] → [[ZIP-Dateien wählen …]], alle Teile der Sicherung auf einmal markieren und [[Zurückspielen]].',
          'Findet die Suche dort deine alten Nachrichten, unter edge://extensions dieses WatIs? entfernen – das mit **Erneut laden**. Erst dann, denn **Entfernen** löscht sein Archiv.',
        ],
      },
      { h: 'Auf addons.mozilla.org umsteigen', when: { browser: ['firefox'], install: 'manual' } },
      {
        when: { browser: ['firefox'], install: 'manual' },
        steps: [
          'Sicherheitshalber sichern: [[Einstellungen]] → [[Archiv und Sicherung]] → [[Als ZIP herunterladen]].',
          'Firefox beenden und wieder starten. Dieses WatIs? ist danach weg, sein Archiv nicht.',
          'WatIs? auf **addons.mozilla.org** suchen und **Zu Firefox hinzufügen**. Es ist dieselbe Erweiterung: Dein Archiv ist wieder da, und ab jetzt übersteht WatIs? jeden Neustart und aktualisiert sich selbst.',
          'Ist das Archiv doch leer: [[Einstellungen]] → [[Archiv und Sicherung]] → [[Sicherung zurückspielen]] → [[ZIP-Dateien wählen …]].',
        ],
      },
      { h: 'Ohne Store aktualisieren', when: { install: 'manual' } },
      {
        when: { browser: ['chrome'], install: 'manual' },
        steps: [
          'Die neue ZIP herunterladen.',
          'In **denselben Ordner** entpacken wie beim ersten Mal und vorhandene Dateien ersetzen.',
          'Unter chrome://extensions bei WatIs? auf den runden Pfeil **Neu laden** klicken.',
        ],
      },
      {
        when: { browser: ['edge'], install: 'manual' },
        steps: [
          'Die neue ZIP herunterladen.',
          'In **denselben Ordner** entpacken wie beim ersten Mal und vorhandene Dateien ersetzen.',
          'Unter edge://extensions bei WatIs? auf **Erneut laden** klicken.',
        ],
      },
      {
        p: 'Die neue ZIP unter about:debugging über **Temporäres Add-on laden …** laden. Das ist auch nach jedem Neustart von Firefox nötig. Dein Archiv bleibt dabei erhalten.',
        when: { browser: ['firefox'], install: 'manual' },
      },
      { h: 'Nie' },
      {
        list: ['**Entfernen** löscht das Archiv. Für ein Update musst du nichts tun.'],
        when: { install: 'store' },
      },
      {
        list: [
          '**Entfernen** löscht das Archiv. Für ein Update reicht **Neu laden**. Beim Umstieg in den Chrome Web Store dieses WatIs? erst entfernen, wenn dein Archiv im neuen zurück ist.',
          'In einen **anderen Ordner** entpacken: Chrome hält das für eine zweite Erweiterung und zeigt ein leeres WatIs?. Dein Archiv ist dann nicht weg – den alten Ordner wieder laden, und es ist zurück.',
        ],
        when: { browser: ['chrome'], install: 'manual' },
      },
      {
        list: [
          '**Entfernen** löscht das Archiv. Für ein Update reicht **Erneut laden**. Beim Umstieg zu den Edge-Add-ons dieses WatIs? erst entfernen, wenn dein Archiv im neuen zurück ist.',
          'In einen **anderen Ordner** entpacken: Edge hält das für eine zweite Erweiterung und zeigt ein leeres WatIs?. Dein Archiv ist dann nicht weg – den alten Ordner wieder laden, und es ist zurück.',
        ],
        when: { browser: ['edge'], install: 'manual' },
      },
      {
        list: [
          '**Entfernen** löscht das Archiv. Für ein Update reicht es, die neue ZIP zu laden, und zum Umstieg auf addons.mozilla.org ein Neustart von Firefox.',
        ],
        when: { browser: ['firefox'], install: 'manual' },
      },
    ],
    related: ['sicherung', 'probleme'],
  },
  {
    id: 'datenschutz',
    title: 'Was mit deinen Daten passiert',
    summary: 'Alles bleibt auf deinem Rechner.',
    body: [
      {
        list: [
          'Das Archiv liegt **nur in deinem Browser**, getrennt vom Speicher von WhatsApp Web.',
          'WatIs? hat **keine Server, keine Cloud, kein Konto und keine Telemetrie**. Texterkennung und Transkription rechnen auf deinem Rechner.',
          'Netzverbindungen gibt es nur zu WhatsApp (über WhatsApp Web selbst) und, wenn du ein Sprachmodell herunterlädst, zu GitHub.',
          'WatIs? sendet nichts in deinem Namen, löscht nichts und ändert nichts an deinen Chats. Es liest nur.',
          'Eine Sicherung landet dort, wo du sie hinlegst. Ist das ein synchronisierter Ordner, liegt sie auch bei diesem Anbieter.',
        ],
      },
      {
        p: 'Neue Versionen lädt dein Browser selbst aus seinem Add-on-Store, wie bei jeder Erweiterung. WatIs? schickt dabei nichts mit.',
        when: { install: 'store' },
      },
      {
        note: 'Das Archiv ist nicht verschlüsselt. Auf einem Firmenrechner kann die IT darauf zugreifen. Und es enthält Nachrichten anderer Leute – auch gelöschte und „verschwindende“, sobald sie einmal angekommen sind.',
      },
    ],
    related: ['sicherung', 'grenzen'],
  },
  {
    id: 'probleme',
    title: 'Wenn etwas nicht klappt',
    summary: 'Was die Anzeige oben bedeutet und was zu tun ist.',
    body: [
      { h: 'Die Anzeige oben' },
      {
        p: 'Oben im Panel steht in einem Wort, wie es dem Archiv geht. Ein Klick darauf zeigt Einzelheiten.',
      },
      { generated: 'status' },
      { h: 'Typische Fälle' },
      {
        table: [ROW_OTHER_FOLDER, ROW_NO_UPDATES, ROW_MEDIA, ROW_TRANSCRIBE, ROW_DEVELOPER_MODE],
        when: { ...CHROMIUM, install: 'manual' },
      },
      {
        table: [ROW_AFTER_UPDATE, ROW_STORE_EMPTY, ROW_MEDIA, ROW_TRANSCRIBE],
        when: { ...CHROMIUM, install: 'store' },
      },
      {
        table: [ROW_GONE_AFTER_RESTART, ROW_NO_UPDATES, ROW_MEDIA, ROW_TRANSCRIBE_FIREFOX],
        when: { ...FIREFOX, install: 'manual' },
      },
      {
        table: [ROW_AFTER_UPDATE, ROW_MEDIA, ROW_TRANSCRIBE_FIREFOX],
        when: { ...FIREFOX, install: 'store' },
      },
      {
        p: 'Hilft das alles nicht: Fehler melden unter github.com/phish3144/watis/issues – bitte ohne echte Nachrichten oder Telefonnummern.',
      },
    ],
    related: ['aktualisieren', 'medien'],
  },
  {
    id: 'grenzen',
    title: 'Was WatIs? nicht kann',
    summary: 'Ehrlich gesagt: die Grenzen.',
    body: [
      {
        list: [
          '**Rückwirkend nur, was WhatsApp Web geladen hat.** Ältere Nachrichten liegen nur auf dem Handy.',
          '**Mitgeschrieben wird nur, solange WhatsApp Web offen ist.** Was ankommt, während kein Tab offen ist, holt WatIs? beim nächsten Öffnen nach, soweit WhatsApp Web es lädt.',
          '**Kein Senden.** WatIs? schreibt keine Nachrichten und antwortet auf nichts.',
          '**„Einmal ansehen"** archiviert WatIs? bewusst nicht.',
          'Hängt an WhatsApp Web: Ändert WhatsApp etwas, kann ein Teil ausfallen, bis WatIs? nachgezogen ist. Nachrichten und Suche laufen dann meist weiter.',
        ],
      },
    ],
    related: ['datenschutz', 'erste-schritte'],
  },
]

export function helpArticle(id: HelpTopic): HelpArticle {
  const article = HELP.find((a) => a.id === id)
  if (!article) throw new Error(`no help article ${id}`)
  return article
}
