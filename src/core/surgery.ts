// ---------------------------------------------------------------------------
// Editing the XML of an `.als` file by string surgery.
//
// Never reserialize: the file has millions of nodes, and a DOM round-trip
// would change whitespace, attribute order and escaping in places nobody
// touched — a diff impossible to review and a silent-regression risk.
//
// The pattern is to collect `(start, end, replacement)` edits against the
// ORIGINAL text and apply them all at once, sorted. Whatever was not touched
// comes out byte-for-byte identical.
// ---------------------------------------------------------------------------

import { unescapeXml } from "./document.js"

export type Edit = {
  readonly start: number
  readonly end: number
  readonly replacement: string
}

/** Applies the edits in order; overlap is a programming error, not data. */
export function applyEdits(xml: string, edits: readonly Edit[]): string {
  const sorted = [...edits].sort((left, right) => left.start - right.start)
  const parts: string[] = []
  let cursor = 0
  for (const edit of sorted) {
    if (edit.start < cursor) {
      throw new Error(
        `overlapping edits at ${edit.start} (cursor is at ${cursor})`
      )
    }
    parts.push(xml.slice(cursor, edit.start), edit.replacement)
    cursor = edit.end
  }
  parts.push(xml.slice(cursor))
  return parts.join("")
}

export type Range = {
  readonly start: number
  readonly end: number
}

/**
 * The range of every `<Scene …>…</Scene>` in document order — including the
 * self-closing ones (`<Scene … />`), which exist in the v10 schema.
 */
export function findSceneRanges(xml: string): readonly Range[] {
  const ranges: Range[] = []
  const openRe = /<Scene Id="\d+"[^>]*?(\/?)>/g
  let match: RegExpExecArray | null
  while ((match = openRe.exec(xml)) !== null) {
    if (match[1] === "/") {
      ranges.push({ start: match.index, end: openRe.lastIndex })
      continue
    }
    const close = xml.indexOf("</Scene>", openRe.lastIndex)
    if (close === -1) break
    ranges.push({ start: match.index, end: close + "</Scene>".length })
  }
  return ranges
}

/**
 * The outer slots of every `<ClipSlotList>` (session and freeze), in document
 * order. The INNER `<ClipSlot>` has no `Id` and therefore stays out — the
 * format's classic trap.
 */
export function findClipSlotLists(xml: string): readonly (readonly Range[])[] {
  const lists: (readonly Range[])[] = []
  const listRe = /<ClipSlotList>/g
  while (listRe.exec(xml) !== null) {
    const bodyStart = listRe.lastIndex
    const bodyEnd = xml.indexOf("</ClipSlotList>", bodyStart)
    if (bodyEnd === -1) continue

    const slots: Range[] = []
    const slotRe = /<ClipSlot Id="-?\d+">/g
    slotRe.lastIndex = 0
    const body = xml.slice(bodyStart, bodyEnd)
    const starts: number[] = []
    let slotMatch: RegExpExecArray | null
    while ((slotMatch = slotRe.exec(body)) !== null) {
      starts.push(slotMatch.index)
    }
    for (const [index, start] of starts.entries()) {
      const end = index + 1 < starts.length ? starts[index + 1]! : body.length
      slots.push({ start: bodyStart + start, end: bodyStart + end })
    }
    lists.push(slots)
    listRe.lastIndex = bodyEnd
  }
  return lists
}

export type ClipSlotListInfo = {
  /** This list's outer slots, in document order. */
  readonly slots: readonly Range[]
  /** The track that owns the list (`""` when it is the master's). */
  readonly trackName: string
  /** The owning track's position in the document; `-1` when no track comes before. */
  readonly trackIndex: number
  /** `false` = FREEZE list, which never receives transplanted content. */
  readonly isSession: boolean
}

const TRACK_OPEN = /<(?:AudioTrack|MidiTrack|ReturnTrack|GroupTrack) Id="\d+"/g

/**
 * The same lists as `findClipSlotLists`, with the owning track and whether it
 * is the session list. Neither the Id nor the order can tell: the session one
 * is the one whose closest opening wrapper is `<MainSequencer`, not
 * `<FreezeSequencer`.
 */
export function describeClipSlotLists(
  xml: string
): readonly ClipSlotListInfo[] {
  const trackStarts: number[] = []
  TRACK_OPEN.lastIndex = 0
  let trackMatch: RegExpExecArray | null
  while ((trackMatch = TRACK_OPEN.exec(xml)) !== null) {
    trackStarts.push(trackMatch.index)
  }

  return findClipSlotLists(xml).map((slots) => {
    const anchor = slots[0]?.start ?? 0
    const main = xml.lastIndexOf("<MainSequencer", anchor)
    const freeze = xml.lastIndexOf("<FreezeSequencer", anchor)
    const trackIndex =
      trackStarts.findIndex((start) => start >= anchor) === -1
        ? trackStarts.length - 1
        : trackStarts.findIndex((start) => start >= anchor) - 1
    const owner = trackIndex >= 0 ? trackStarts[trackIndex] : undefined
    const nameMatch =
      owner === undefined
        ? null
        : /<Name>\s*<EffectiveName Value="([^"]*)"/.exec(
            xml.slice(owner, anchor)
          )
    return {
      slots,
      trackName: nameMatch ? unescapeXml(nameMatch[1]!) : "",
      trackIndex,
      isSession: main > freeze,
    }
  })
}

/** Replaces the root element's `Id` in a fragment (`<Scene Id="…"` etc.). */
export function withElementId(fragment: string, id: number): string {
  return fragment.replace(/^(\s*<\w+) Id="-?\d+"/, `$1 Id="${id}"`)
}

/** Replaces the root element's `Value` — in the v10 schema that is where the name lives. */
export function withElementValue(fragment: string, value: string): string {
  return fragment.replace(
    /^(\s*<\w+[^>]*?) Value="[^"]*"/,
    `$1 Value="${escapeXml(value)}"`
  )
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// The FIRST `<ColorIndex>` of a `<ClipSlot>` is the clip's: the outer slot
// only has `LomId` before it, and the order inside the clip is fixed
// (`CurrentStart`, `CurrentEnd`, `Loop`, `Name`, `Annotation`, `ColorIndex`).
// No `/g` — `String.replace` replaces only the first occurrence, never a
// nested one.
const CLIP_COLOR_INDEX = /<ColorIndex Value="(-?\d+)"\s*\/>/

/** The clip's `ColorIndex` inside a `<ClipSlot>`; `null` when the slot is empty. */
export function clipColorIndex(clipSlotXml: string): number | null {
  const match = CLIP_COLOR_INDEX.exec(clipSlotXml)
  return match ? Number(match[1]) : null
}

/** Rewrites the clip's `ColorIndex`; an empty slot comes out untouched. */
export function withClipColorIndex(
  clipSlotXml: string,
  colorIndex: number
): string {
  return clipSlotXml.replace(
    CLIP_COLOR_INDEX,
    `<ColorIndex Value="${colorIndex}" />`
  )
}

/** A clipless slot, in the exact shape Live writes. */
export function emptyClipSlot(id: number): string {
  return `<ClipSlot Id="${id}"><LomId Value="0" /><ClipSlot><Value /></ClipSlot><HasStop Value="true" /><NeedRefreeze Value="true" /></ClipSlot>`
}

export type SceneRow = {
  /** The complete `<Scene …>…</Scene>`. */
  readonly scene: string
  /** Slot by list index (the one from `describeClipSlotLists`). Absent = empty. */
  readonly slots: ReadonlyMap<number, string>
  /** This row's pointee Id; reused in the slot of every list. */
  readonly id: number
}

export type InsertRowsResult =
  | { readonly ok: true; readonly xml: string }
  | { readonly ok: false; readonly error: string }

/**
 * Inserts whole rows (scene + one slot in EVERY list) before the scene at
 * `position`; `position === scenes.length` inserts at the end. It is the
 * inverse of `removeScenes` and keeps the same invariant.
 */
export function insertSceneRows(
  xml: string,
  position: number,
  rows: readonly SceneRow[]
): InsertRowsResult {
  if (rows.length === 0) return { ok: true, xml }

  const scenes = findSceneRanges(xml)
  const lists = findClipSlotLists(xml)
  if (position < 0 || position > scenes.length) {
    return { ok: false, error: `position ${position} outside the grid` }
  }

  const sceneAnchor =
    position < scenes.length
      ? scenes[position]!.start
      : (scenes[scenes.length - 1]?.end ?? 0)

  const edits: Edit[] = [
    {
      start: sceneAnchor,
      end: sceneAnchor,
      replacement: rows.map((row) => row.scene).join(""),
    },
  ]

  for (const [listIndex, slots] of lists.entries()) {
    if (slots.length !== scenes.length) continue
    const anchor =
      position < slots.length
        ? slots[position]!.start
        : (slots[slots.length - 1]?.end ?? 0)
    edits.push({
      start: anchor,
      end: anchor,
      replacement: rows
        .map((row) => row.slots.get(listIndex) ?? emptyClipSlot(row.id))
        .join(""),
    })
  }

  return { ok: true, xml: applyEdits(xml, edits) }
}

export type RemoveScenesResult =
  | { readonly ok: true; readonly xml: string; readonly removed: number }
  | { readonly ok: false; readonly error: string }

/**
 * Removes scenes BY INDEX, taking along the matching slot from every list.
 * It is the only way to keep the invariant Live demands: every ClipSlotList
 * has exactly one slot per scene — breaking it crashes the program when the
 * file opens.
 */
export function removeScenes(
  xml: string,
  indices: readonly number[]
): RemoveScenesResult {
  if (indices.length === 0) return { ok: true, xml, removed: 0 }

  const scenes = findSceneRanges(xml)
  const lists = findClipSlotLists(xml)
  const doomed = new Set(indices)

  for (const index of doomed) {
    if (index < 0 || index >= scenes.length) {
      return { ok: false, error: `scene ${index} does not exist` }
    }
  }

  const edits: Edit[] = []
  for (const index of doomed) {
    edits.push({ ...scenes[index]!, replacement: "" })
  }
  for (const slots of lists) {
    // An empty or odd-sized list: touching it would break the grid.
    if (slots.length !== scenes.length) continue
    for (const index of doomed) {
      edits.push({ ...slots[index]!, replacement: "" })
    }
  }

  return { ok: true, xml: applyEdits(xml, edits), removed: doomed.size }
}

// ---------------------------------------------------------------------------
// Id accounting
// ---------------------------------------------------------------------------

/** The highest numeric `Id` attribute anywhere in the document. */
export function maxElementId(xml: string): number {
  let max = 0
  const pattern = / Id="(\d+)"/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null) {
    const value = Number(match[1])
    if (value > max) max = value
  }
  return max
}

/** Rewrites the `<NextPointeeId>` allocator to `value`. */
export function withNextPointeeId(xml: string, value: number): string {
  return xml.replace(
    /<NextPointeeId Value="\d+" \/>/,
    `<NextPointeeId Value="${value}" />`
  )
}
