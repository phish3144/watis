/**
 * Windowing for the message list (PLAN.md §3.1: every list virtualised, "load everything" does not
 * exist).
 *
 * Pure arithmetic, deliberately: the hard parts of a virtual list are the off-by-ones at the edges
 * and the moment a page arrives while the user is mid-scroll, and neither is testable once it is
 * tangled up with the DOM.
 */

export interface Windowing {
  /** Total rows currently held in memory. */
  count: number
  /** Uniform row height in pixels. */
  rowHeight: number
  /** Height of the scrolling viewport. */
  viewportHeight: number
  scrollTop: number
  /** Rows rendered beyond each edge, so scrolling does not expose blank space. */
  overscan?: number
}

export interface VisibleRange {
  startIndex: number
  endIndex: number
  /** Pixels of spacer before the first rendered row. */
  paddingTop: number
  /** Pixels of spacer after the last. */
  paddingBottom: number
}

export function visibleRange(w: Windowing): VisibleRange {
  const overscan = w.overscan ?? 6
  if (w.count <= 0 || w.rowHeight <= 0) {
    return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 }
  }

  const first = Math.floor(w.scrollTop / w.rowHeight)
  const visible = Math.ceil(w.viewportHeight / w.rowHeight)
  const startIndex = Math.max(0, first - overscan)
  // endIndex is exclusive, and clamped so a short list never renders past its own end.
  const endIndex = Math.min(w.count, first + visible + overscan)

  return {
    startIndex,
    endIndex,
    paddingTop: startIndex * w.rowHeight,
    paddingBottom: Math.max(0, (w.count - endIndex) * w.rowHeight),
  }
}

/**
 * Whether the list should fetch another page, and in which direction.
 *
 * A chat is read newest-first, so scrolling up reaches older messages. The threshold is in pixels
 * rather than rows because it has to hold for a fast flick as much as a slow drag.
 */
export function pageDirection(w: Windowing, thresholdPx = 600): 'older' | 'newer' | undefined {
  const contentHeight = w.count * w.rowHeight
  if (contentHeight <= w.viewportHeight) return undefined
  if (w.scrollTop <= thresholdPx) return 'older'
  if (w.scrollTop + w.viewportHeight >= contentHeight - thresholdPx) return 'newer'
  return undefined
}

/**
 * Where to scroll to after older rows were prepended, so the view does not jump.
 *
 * Without this the content under the cursor slides down by exactly the height of what arrived,
 * which is the single most noticeable bug in an infinite list.
 */
export function scrollTopAfterPrepend(
  scrollTop: number,
  addedRows: number,
  rowHeight: number,
): number {
  return scrollTop + addedRows * rowHeight
}

/** The index of a message by id, for "jump to this hit". */
export function indexOf(ids: readonly string[], id: string): number | undefined {
  const index = ids.indexOf(id)
  return index === -1 ? undefined : index
}

/** Scroll offset that puts a row in the middle of the viewport rather than at its very top. */
export function scrollTopFor(
  index: number,
  w: Pick<Windowing, 'rowHeight' | 'viewportHeight'>,
): number {
  return Math.max(0, index * w.rowHeight - w.viewportHeight / 2 + w.rowHeight / 2)
}
