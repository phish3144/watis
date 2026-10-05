/**
 * Lets a timer stop holding a Node process open. In a browser a timer is a number and there is
 * nothing to release, so this is a no-op there — which is what lets the importer and the media
 * fetcher run unchanged in the browser extension (ADR 0010).
 */
export function unref(timer: unknown): void {
  ;(timer as { unref?: () => void } | null | undefined)?.unref?.()
}
