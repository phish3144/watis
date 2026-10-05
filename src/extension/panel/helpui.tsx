import { createContext, useContext, type ReactNode } from 'react'
import { tokenizeHelp } from '@shared/help/content'
import { bytes } from './format'
import { helpArticle, type HelpTopic } from './help'
import { HelpIcon } from './icons'
import { t } from './strings'
import { MODELS } from '../whisper'

/**
 * The way from any place in the panel to the help: a "?" beside a heading, a "Mehr dazu" after a
 * sentence. Both open the article for that place, so the one sentence the interface shows can stay
 * one sentence (help.ts).
 */

const OpenHelp = createContext<(topic: HelpTopic) => void>(() => undefined)

export const HelpProvider = OpenHelp.Provider

export function useOpenHelp(): (topic: HelpTopic) => void {
  return useContext(OpenHelp)
}

/** A small "?" that opens the article on what sits beside it. */
export function HelpButton({ topic }: { topic: HelpTopic }): React.JSX.Element {
  const open = useOpenHelp()
  const label = t('help.open', { topic: helpArticle(topic).title })
  return (
    <button
      type="button"
      onClick={() => {
        open(topic)
      }}
      aria-label={label}
      title={label}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-wa-muted transition hover:bg-wa-raised hover:text-wa-accent"
    >
      <HelpIcon className="h-4 w-4" />
    </button>
  )
}

/** "Mehr dazu" after a sentence. */
export function HelpLink({
  topic,
  children,
}: {
  topic: HelpTopic
  children?: ReactNode
}): React.JSX.Element {
  const open = useOpenHelp()
  return (
    <button
      type="button"
      onClick={() => {
        open(topic)
      }}
      className="font-medium text-wa-accent hover:underline"
    >
      {children ?? t('help.more')}
    </button>
  )
}

/** Model sizes come from the model list, so the help never quotes a size the download does not have. */
function resolve(text: string): string {
  return text.replace(/\{size:(\w+)\}/g, (_, key: string) => {
    const model = (MODELS as Record<string, { bytes: number } | undefined>)[key]
    return model ? bytes(model.bytes) : `{size:${key}}`
  })
}

/**
 * The help's inline markup (src/shared/help/content.ts): `**bold**`, `[[label of this interface]]`
 * (shown bold) and `` `typed text` ``. Everything else is text — no HTML is ever interpreted.
 */
export function RichText({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {tokenizeHelp(resolve(text)).map((token, i) => {
        if (token.kind === 'bold') return <strong key={i}>{token.text}</strong>
        if (token.kind === 'label')
          return (
            <strong key={i} className="font-semibold text-wa-text">
              {token.text}
            </strong>
          )
        if (token.kind === 'code')
          return (
            <code key={i} className="rounded bg-wa-raised px-1 py-0.5 text-[0.95em] text-wa-text">
              {token.text}
            </code>
          )
        return token.text
      })}
    </>
  )
}
