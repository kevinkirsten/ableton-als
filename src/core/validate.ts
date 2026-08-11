// ---------------------------------------------------------------------------
// The asserts that run BEFORE a file is delivered.
//
// Live validates nothing: a file with a broken grid opens and crashes, and a
// malformed XML takes the whole set with it. No file leaves without passing.
// ---------------------------------------------------------------------------

import {
  describeClipSlotLists,
  findSceneRanges,
  maxElementId,
} from "./surgery.js"

/**
 * A stable identifier for each message this module can produce.
 *
 * `detail` is English prose, ready to print. `code` and `values` are the same
 * message taken apart, so a consumer can render it in another language without
 * parsing English — which is the only alternative, and a fragile one. Codes are
 * part of the public contract: renaming one is a breaking change.
 */
export type ValidationCode =
  | "orphan_pointee"
  | "grid_slot_count"
  | "xml_mismatched_close"
  | "xml_unclosed"
  | "xml_duplicate_singleton"
  | "next_pointee_missing"
  | "next_pointee_too_low"
  | "routing_orphan_tracks"

export type ValidationProblem = {
  readonly rule: "grid" | "xml" | "ids" | "routing"
  /** English prose, ready to print. */
  readonly detail: string
  readonly code: ValidationCode
  /** The values interpolated into `detail`, kept separate for localization. */
  readonly values: Readonly<Record<string, string | number>>
}

export function validateGeneratedSet(
  xml: string
): readonly ValidationProblem[] {
  return [
    ...checkXmlWellFormed(xml),
    ...checkGrid(xml),
    ...checkIds(xml),
    ...checkTrackReferences(xml),
    ...checkSingletonMembers(xml),
    ...checkPointeeReferences(xml),
  ]
}

/**
 * Every `<PointeeId>` (a ClipEnvelope target) must point at a target that
 * EXISTS in the document — an orphan reference takes Live 10 down at load,
 * with no message (measured on a real song in the archive).
 */
function checkPointeeReferences(xml: string): readonly ValidationProblem[] {
  const referenced = new Set(
    [...xml.matchAll(/<PointeeId Value="(\d+)" \/>/g)].map((match) => match[1])
  )
  if (referenced.size === 0) return []
  const targets = new Set(
    [
      ...xml.matchAll(
        /<[A-Za-z0-9_.]*(?:Automation|Modulation)Target Id="(\d+)"/g
      ),
    ].map((match) => match[1])
  )
  const orphans = [...referenced].filter((id) => !targets.has(id))
  return orphans.length === 0
    ? []
    : [
        {
          rule: "ids",
          code: "orphan_pointee",
          values: { ids: orphans.join(", ") },
          detail: `orphan PointeeId (clip automation target does not exist): ${orphans.join(", ")}`,
        },
      ]
}

/** Every ClipSlotList has exactly one slot per scene — or none. */
function checkGrid(xml: string): readonly ValidationProblem[] {
  const sceneCount = findSceneRanges(xml).length
  return describeClipSlotLists(xml).flatMap((list, index) =>
    list.slots.length === sceneCount || list.slots.length === 0
      ? []
      : [
          {
            rule: "grid" as const,
            code: "grid_slot_count" as const,
            values: {
              list: index,
              track: list.trackName,
              slots: list.slots.length,
              scenes: sceneCount,
            },
            detail: `list ${index} ("${list.trackName}") has ${list.slots.length} slots for ${sceneCount} scenes`,
          },
        ]
  )
}

const TAG = /<(\/?)([A-Za-z_][\w.-]*)((?:"[^"]*"|[^>"])*?)(\/?)>/g

/**
 * Tag balancing without building a DOM: the file has millions of nodes and a
 * real parser would cost more than the whole export.
 */
function checkXmlWellFormed(xml: string): readonly ValidationProblem[] {
  const stack: string[] = []
  TAG.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TAG.exec(xml)) !== null) {
    const [, closing, name, , selfClosing] = match
    if (selfClosing === "/") continue
    if (closing === "/") {
      const open = stack.pop()
      if (open !== name) {
        return [
          {
            rule: "xml",
            code: "xml_mismatched_close",
            values: {
              closing: name!,
              open: open ?? "nothing",
              offset: match.index,
            },
            detail: `</${name}> closes <${open ?? "nothing"}> at offset ${match.index}`,
          },
        ]
      }
      continue
    }
    stack.push(name!)
  }
  return stack.length === 0
    ? []
    : [
        {
          rule: "xml",
          code: "xml_unclosed",
          values: { tags: stack.join(" > ") },
          detail: `tags opened and never closed: ${stack.join(" > ")}`,
        },
      ]
}

/**
 * Members Live 10 demands UNIQUE per parent element — duplicating refuses the
 * file with "Class X already has member Y". They are exactly the elements the
 * porter restores when v12 stops writing them: if a v12 file DOES write one
 * of them (some write `NeedArrangerRefreeze`), a blind restore would
 * duplicate it.
 */
const SINGLETON_MEMBERS: ReadonlySet<string> = new Set([
  "NeedRefreeze",
  "NeedArrangerRefreeze",
  "VelocityDetail",
  "MarkerDensity",
  "AutoWarpTolerance",
  "EnvelopeModePreferred",
  "SessionMixer",
  "SessionTrackDelay",
  "ArrangerMixer",
  "ArrangerTrackDelay",
])

function checkSingletonMembers(xml: string): readonly ValidationProblem[] {
  const problems: ValidationProblem[] = []
  const stack: Array<{
    readonly name: string
    counts: Map<string, number> | null
  }> = []

  TAG.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TAG.exec(xml)) !== null && problems.length < 5) {
    const [, closing, name, , selfClosing] = match
    if (closing === "/") {
      stack.pop()
      continue
    }
    if (SINGLETON_MEMBERS.has(name!)) {
      const parent = stack[stack.length - 1]
      if (parent) {
        const counts = (parent.counts ??= new Map())
        const seen = (counts.get(name!) ?? 0) + 1
        counts.set(name!, seen)
        if (seen === 2) {
          problems.push({
            rule: "xml",
            code: "xml_duplicate_singleton",
            values: {
              element: name!,
              parent: parent.name,
              offset: match.index,
            },
            detail: `<${name}> duplicated inside <${parent.name}> at offset ${match.index}`,
          })
        }
      }
    }
    if (selfClosing !== "/") stack.push({ name: name!, counts: null })
  }
  return problems
}

function checkIds(xml: string): readonly ValidationProblem[] {
  const declared = /<NextPointeeId Value="(\d+)" \/>/.exec(xml)
  if (!declared) {
    return [
      {
        rule: "ids",
        code: "next_pointee_missing",
        values: {},
        detail: "NextPointeeId missing",
      },
    ]
  }
  const max = maxElementId(xml)
  return Number(declared[1]) > max
    ? []
    : [
        {
          rule: "ids",
          code: "next_pointee_too_low",
          values: { declared: declared[1]!, max },
          detail: `NextPointeeId ${declared[1]} is not greater than the file's highest Id (${max})`,
        },
      ]
}

/** Bus routing that points at a nonexistent track changes the audio without warning. */
function checkTrackReferences(xml: string): readonly ValidationProblem[] {
  const trackIds = new Set(
    [
      ...xml.matchAll(
        /<(?:AudioTrack|MidiTrack|ReturnTrack|GroupTrack) Id="(\d+)"/g
      ),
    ].map((match) => match[1])
  )
  const orphans = new Set(
    [...xml.matchAll(/Value="Audio(?:Out|In)\/Track\.(\d+)\//g)]
      .map((match) => match[1])
      .filter((id) => !trackIds.has(id))
  )
  return orphans.size === 0
    ? []
    : [
        {
          rule: "routing",
          code: "routing_orphan_tracks",
          values: { ids: [...orphans].join(", ") },
          detail: `references to nonexistent tracks: ${[...orphans].join(", ")}`,
        },
      ]
}
