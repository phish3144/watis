import { t } from '../i18n'
import { BACKFILL_PAUSES, BACKFILL_REASONS, HEALTH_ADVICE, MIRROR_STATES } from '../status-texts'
import {
  HELP,
  SEARCH_SYNTAX,
  helpArticle,
  type Generated,
  type HelpBlock,
  type HelpTopic,
} from './articles'
import { HelpLink, RichText } from './help-ui'

/**
 * The "Hilfe" tab: a list of topics, and one article at a time (articles.ts). It needs no
 * network — the text ships with the application.
 */
export function HelpView({
  topic,
  onTopic,
}: {
  topic: HelpTopic | undefined
  onTopic: (topic: HelpTopic | undefined) => void
}): React.JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      {topic ? (
        <Article
          topic={topic}
          onBack={() => {
            onTopic(undefined)
          }}
        />
      ) : (
        <Topics onTopic={onTopic} />
      )}
    </div>
  )
}

function Topics({ onTopic }: { onTopic: (topic: HelpTopic) => void }): React.JSX.Element {
  return (
    <section aria-labelledby="help-title">
      <h2 id="help-title" className="text-sm font-semibold">
        {t('help.title')}
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-wa-muted">{t('help.intro')}</p>
      <ul className="mt-3 divide-y divide-wa-hairline overflow-hidden rounded-lg bg-wa-surface">
        {HELP.map((article) => (
          <li key={article.id}>
            <button
              type="button"
              onClick={() => {
                onTopic(article.id)
              }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-wa-raised"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{article.title}</span>
                <span className="block text-xs text-wa-muted">{article.summary}</span>
              </span>
              <span aria-hidden="true" className="text-wa-muted">
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Article({ topic, onBack }: { topic: HelpTopic; onBack: () => void }): React.JSX.Element {
  const article = helpArticle(topic)
  return (
    <article aria-labelledby="help-article-title">
      <button
        type="button"
        onClick={onBack}
        aria-label={t('help.back')}
        className="mb-2 rounded-md px-1 py-0.5 text-xs font-medium text-wa-accent hover:bg-wa-accent-soft"
      >
        ‹ {t('help.back')}
      </button>
      <h2 id="help-article-title" className="text-sm font-semibold">
        {article.title}
      </h2>
      <div className="mt-2 space-y-2.5 text-[13px] leading-relaxed">
        {article.body.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </div>
      {article.related && article.related.length > 0 && (
        <div className="mt-5 border-t border-wa-hairline pt-2 text-xs">
          <span className="text-wa-muted">{t('help.related')}: </span>
          {article.related.map((id, i) => (
            <span key={id}>
              {i > 0 && ' · '}
              <HelpLink topic={id}>{helpArticle(id).title}</HelpLink>
            </span>
          ))}
        </div>
      )}
    </article>
  )
}

function Block({ block }: { block: HelpBlock }): React.JSX.Element {
  if ('p' in block)
    return (
      <p>
        <RichText text={block.p} />
      </p>
    )
  if ('h' in block) return <h3 className="pt-1.5 text-[13px] font-semibold">{block.h}</h3>
  if ('note' in block)
    return (
      <p className="rounded-lg bg-wa-accent-soft px-3 py-2">
        <RichText text={block.note} />
      </p>
    )
  if ('list' in block)
    return (
      <ul className="list-disc space-y-1 pl-5">
        {block.list.map((item, i) => (
          <li key={i}>
            <RichText text={item} />
          </li>
        ))}
      </ul>
    )
  if ('steps' in block)
    return (
      <ol className="list-decimal space-y-1 pl-5">
        {block.steps.map((item, i) => (
          <li key={i}>
            <RichText text={item} />
          </li>
        ))}
      </ol>
    )
  if ('table' in block) return <Table rows={block.table} />
  return <GeneratedBlock kind={block.generated} />
}

function Table({
  rows,
  code = false,
}: {
  rows: [string, string][]
  code?: boolean
}): React.JSX.Element {
  return (
    <dl className="divide-y divide-wa-hairline rounded-lg bg-wa-surface px-3">
      {rows.map(([term, meaning], i) => (
        <div key={i} className="py-1.5">
          <dt className="font-medium">
            {code ? (
              <code className="rounded bg-wa-raised px-1 py-0.5 text-wa-text">{term}</code>
            ) : (
              <RichText text={term} />
            )}
          </dt>
          <dd className="text-wa-muted">
            <RichText text={meaning} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** The parts of the help rendered from the same data the panel shows. */
function GeneratedBlock({ kind }: { kind: Generated }): React.JSX.Element {
  if (kind === 'search-syntax')
    return <Table code rows={SEARCH_SYNTAX.map((s) => [s.example, s.meaning])} />
  if (kind === 'mirror')
    return (
      <Table
        rows={Object.values(MIRROR_STATES).map((state) => [`**${state.label}**`, state.explain])}
      />
    )
  if (kind === 'health')
    return (
      <Table
        rows={Object.entries(HEALTH_ADVICE).map(([key, advice]) => [
          t(key as keyof typeof HEALTH_ADVICE),
          advice,
        ])}
      />
    )
  return (
    <Table
      rows={[
        ...Object.values(BACKFILL_PAUSES).map((text): [string, string] => [
          text,
          'Geht von selbst weiter.',
        ]),
        ...Object.values(BACKFILL_REASONS).map((text): [string, string] => [
          text,
          'Später noch einmal starten. Hält es an, bitte melden.',
        ]),
      ]}
    />
  )
}
