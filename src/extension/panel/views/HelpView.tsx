import { HELP, SEARCH_SYNTAX, bodyFor, helpArticle, type HelpBlock, type HelpTopic } from '../help'
import { HelpLink, RichText, useHelpContext } from '../helpui'
import { BackIcon, ChevronIcon } from '../icons'
import { MEDIA_PROBLEMS } from '../problems'
import { t, type StringKey } from '../strings'

/**
 * The help, inside the panel: a list of topics, and one article at a time (help.ts). It needs no
 * network — the text ships with the extension.
 */

export function HelpView({
  topic,
  onTopic,
}: {
  topic: HelpTopic | undefined
  onTopic: (topic: HelpTopic | undefined) => void
}): React.JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-1">
      <div className="mx-auto max-w-2xl">
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
    </div>
  )
}

function Topics({ onTopic }: { onTopic: (topic: HelpTopic) => void }): React.JSX.Element {
  return (
    <section aria-labelledby="help-title">
      <h2 id="help-title" className="text-base font-semibold">
        {t('help.title')}
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-wa-muted">{t('help.intro')}</p>
      <ul className="mt-4 divide-y divide-wa-hairline overflow-hidden rounded-2xl bg-wa-surface">
        {HELP.map((article) => (
          <li key={article.id}>
            <button
              type="button"
              onClick={() => {
                onTopic(article.id)
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-wa-raised/60"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{article.title}</span>
                <span className="block text-xs text-wa-muted">{article.summary}</span>
              </span>
              <ChevronIcon className="h-4 w-4 shrink-0 text-wa-muted" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Article({ topic, onBack }: { topic: HelpTopic; onBack: () => void }): React.JSX.Element {
  const article = helpArticle(topic)
  // Only what is true in this browser and for this kind of install (help.ts).
  const context = useHelpContext()
  return (
    <article aria-labelledby="help-article-title">
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 mb-2 inline-flex items-center gap-1 rounded-full px-1.5 py-1 text-xs font-medium text-wa-accent hover:bg-wa-accent-soft"
      >
        <BackIcon className="h-4 w-4" />
        {t('help.back')}
      </button>
      <h2 id="help-article-title" className="text-base font-semibold">
        {article.title}
      </h2>
      <div className="mt-3 space-y-3 text-[13px] leading-relaxed">
        {context && bodyFor(article, context).map((block, i) => <Block key={i} block={block} />)}
      </div>
      {article.related && article.related.length > 0 && (
        <div className="mt-6 border-t border-wa-hairline pt-3 text-xs">
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
  if ('h' in block) return <h3 className="pt-2 text-[13px] font-semibold">{block.h}</h3>
  if ('note' in block)
    return (
      <p className="rounded-xl bg-wa-accent-soft px-3 py-2">
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
  return <Generated kind={block.generated} />
}

function Table({
  rows,
  code = false,
}: {
  rows: [string, string][]
  code?: boolean
}): React.JSX.Element {
  return (
    <dl className="divide-y divide-wa-hairline rounded-xl bg-wa-surface px-3">
      {rows.map(([term, meaning], i) => (
        <div
          key={i}
          className="grid gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
        >
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

/** The parts of the help that are rendered from the data the interface itself uses. */
function Generated({
  kind,
}: {
  kind: 'search-syntax' | 'media-problems' | 'status'
}): React.JSX.Element {
  if (kind === 'search-syntax')
    return <Table code rows={SEARCH_SYNTAX.map((s) => [s.example, s.meaning])} />
  if (kind === 'media-problems')
    return (
      <Table rows={MEDIA_PROBLEMS.filter((p) => p.inHelp).map((p) => [p.text, p.advice ?? ''])} />
    )
  const states: [StringKey, StringKey][] = [
    ['status.archiving', 'status.archiving.explain'],
    ['status.noTab', 'status.noTab.explain'],
    ['status.waiting', 'status.waiting.explain'],
    ['status.problem', 'status.problem.explain'],
  ]
  return <Table rows={states.map(([state, explain]) => [t(state), t(explain)])} />
}
