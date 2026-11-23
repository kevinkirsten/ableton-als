// ---------------------------------------------------------------------------
// The demo's engine: everything the page does to a set, as pure functions over
// the decompressed XML string. No DOM, no gzip, no worker plumbing, so the
// same code runs under vitest.
//
// It is deliberately thin. Every fact shown on the page comes from a function
// the library exports; this file only arranges those answers for a screen.
// The few places where it reads the XML itself are marked DEMO-SIDE READING:
// they exist to display something, never to write it.
// ---------------------------------------------------------------------------

import {
  clipColorHex,
  decodeTimeSignatureId,
  describeClipSlotLists,
  detectVersion,
  downgradeToV10,
  findSceneRanges,
  fixPointeeIds,
  gridIsConsistent,
  inspectFollowActions,
  inspectPointeeIds,
  inspectRewarp,
  isUntestedVersion,
  listTrackNames,
  liveColorHex,
  mirrorTrackGeometry,
  parseAlsDocument,
  previewMirror,
  readSceneTempo,
  relinkFileRefs,
  rewarpClips,
  supportsTool,
  syncFollowActions,
  PORTABLE_VOLUME_ATTRIBUTES,
  SYNTHETIC_CREATION_TIME,
  unescapeXml,
  validateGeneratedSet,
  type AlsVersion,
  type DowngradeWarning,
  type FollowReport,
  type MirrorPreview,
  type PointeeReport,
  type RewarpReport,
  type ToolId,
  type ToolOutcome,
  type ValidationProblem,
} from "../../src/index.js"

// ---------------------------------------------------------------------------
// What the page shows
// ---------------------------------------------------------------------------

export type ClipView = {
  readonly name: string
  readonly kind: "audio" | "midi"
  /** Hex of the clip's palette colour, `null` when it has none. */
  readonly color: string | null
  readonly bpm: number | null
  readonly sample: string | null
  readonly signature: string | null
  readonly lengthBeats: number | null
}

export type TrackView = {
  readonly name: string
  readonly type: "AudioTrack" | "MidiTrack" | "ReturnTrack" | "GroupTrack"
  readonly color: string | null
  readonly output: string | null
  /** One entry per scene, `null` for an empty slot. */
  readonly clips: readonly (ClipView | null)[]
}

export type SceneView = {
  readonly name: string
  readonly color: string | null
  readonly bpm: number | null
  readonly signature: string | null
}

export type FileRefView = {
  readonly name: string
  readonly folder: string
  /** Absolute path as the document states it, `null` when it states none. */
  readonly path: string | null
  /** How many references in the document point at this file. */
  readonly refs: number
  readonly audio: boolean
  /** Under `/Volumes/`: the only shape an alias record can be built for. */
  readonly external: boolean
  /** The reference already carries an alias record in `<Data>`. */
  readonly hasAlias: boolean
}

/**
 * Why a repair cannot run. A code and its values, never prose: the page words
 * it in the visitor's language. The codes are the library's own `BlockedCode`.
 */
export type Blocked =
  | {
      readonly code: "unsupported_version"
      readonly values: { readonly version: number | "?" }
      /** The whole version was never verified, as opposed to this one tool. */
      readonly untested: boolean
    }
  | {
      readonly code: "colliding_pointee_ids"
      readonly values: { readonly ids: string }
    }
  | {
      readonly code: "mixed_clip_durations"
      readonly values: { readonly count: number }
    }
  | {
      readonly code: "needs_two_tracks"
      readonly values: Record<never, never>
    }

/**
 * What a fact is about. A stable key the page maps to a label; the two that
 * name something in the set carry it along.
 */
export type Label =
  | {
      readonly key:
        | "automationTargets"
        | "duplicatedIds"
        | "extraOccurrences"
        | "audioClips"
        | "clipsWarpedAt"
        | "gridBpm"
        | "masterBpm"
        | "clips"
        | "needEnable"
        | "needUnlink"
        | "needRetime"
        | "tracksWithClips"
        | "sharedScenes"
        | "differingScenes"
        | "firstAudioRef"
        | "refsWithAlias"
        | "audioRefsWithAlias"
        | "savedBy"
        | "schema"
    }
  /** The name of a scene; `scene` counts from 1. */
  | { readonly key: "sceneName"; readonly scene: number }
  | { readonly key: "trackColor"; readonly track: string }

/**
 * A fact's value, as data. A number is a count or a BPM, a string is text
 * taken from the file and shown as it is, `null` means the file states none.
 */
export type FactValue =
  | number
  | string
  | null
  /** So many out of so many. */
  | { readonly part: number; readonly total: number }
  /** Warp BPM and how many clips use it, most used first. */
  | { readonly byBpm: readonly (readonly [number, number])[] }

export type Fact = { readonly label: Label; readonly value: FactValue }

export type ToolView = {
  readonly id: ToolId
  readonly supported: boolean
  /** How many items the tool would fix. 0 means nothing to do. */
  readonly pending: number
  readonly blocked: Blocked | null
  readonly facts: readonly Fact[]
}

export type ConvertAvailability =
  | { readonly state: "ready" }
  | { readonly state: "already_v10" }
  | { readonly state: "unverified"; readonly major: number }

export type Inspection = {
  readonly fileName: string
  readonly sizeBytes: number
  readonly xmlLength: number
  readonly version: AlsVersion
  readonly sceneSchema: "v10" | "v12"
  readonly masterTempo: number | null
  readonly masterSignature: string | null
  readonly nextPointeeId: number | null
  readonly gridConsistent: boolean
  readonly scenes: readonly SceneView[]
  readonly tracks: readonly TrackView[]
  readonly audioClips: number
  readonly midiClips: number
  readonly files: readonly FileRefView[]
  readonly problems: readonly ValidationProblem[]
  readonly tools: readonly ToolView[]
  readonly trackNames: readonly string[]
  readonly convert: ConvertAvailability
  readonly libraryRootGuess: string
}

export type Change = {
  readonly label: Label
  readonly before: FactValue
  readonly after: FactValue
}

export type TagDelta = {
  readonly tag: string
  readonly before: number
  readonly after: number
}

export type ExcerptTitle =
  | { readonly key: "header" }
  /** `scene` counts from 1. */
  | { readonly key: "scene"; readonly scene: number }
  | { readonly key: "firstAudioRef" }

/**
 * A fragment of XML laid out for reading. The two things it leaves out are
 * kept as numbers, so the page can say so in the visitor's language.
 */
export type PrettyXml = {
  readonly lines: readonly PrettyLine[]
  /** Lines left out at the end. 0 when the whole fragment is there. */
  readonly hiddenLines: number
}

export type PrettyLine =
  | string
  /** A long hex payload cut short: where it starts, and its full length. */
  | {
      readonly indent: string
      readonly head: string
      readonly hexChars: number
    }

export type Excerpt = {
  readonly title: ExcerptTitle
  readonly before: PrettyXml
  readonly after: PrettyXml
}

export type ConversionReport = {
  readonly sourceCreator: string
  readonly libraryRoot: string
  readonly scenesConverted: number
  readonly warnings: readonly DowngradeWarning[]
  readonly problems: readonly ValidationProblem[]
  readonly aliases: {
    readonly withRecord: number
    readonly audioRefs: number
    readonly offVolume: number
  }
  readonly changes: readonly Change[]
  readonly tagDeltas: readonly TagDelta[]
  readonly tagDeltaCount: number
  readonly excerpts: readonly Excerpt[]
}

export type StepView =
  | {
      readonly kind: "tool"
      readonly tool: ToolId
      /** How many items the repair rewrote: Ids, clips or references. */
      readonly changed: number
      /** Items it had to leave as they were. Only relinking reports any. */
      readonly skipped: number
      readonly changes: readonly Change[]
    }
  | { readonly kind: "convert"; readonly report: ConversionReport }

export type Operation =
  | { readonly tool: "pointeeIds" }
  | { readonly tool: "followActions" }
  | { readonly tool: "rewarp"; readonly bpm: number }
  | {
      readonly tool: "mirrorTrack"
      readonly base: string
      readonly target: string
    }
  | { readonly tool: "relinkSamples"; readonly libraryRoot: string }

/**
 * Where the opened document came from. The built-in sample is a set Live 12
 * saved; the damaged one is that set with structural damage planted in it.
 */
export type Origin = "file" | "sample" | "damaged"

export type SessionState = {
  readonly origin: Origin
  readonly inspection: Inspection
  readonly steps: readonly StepView[]
  readonly canUndo: boolean
  readonly output: {
    readonly name: string
    /** Why the result is not offered for download, or `null` when it is. */
    readonly blocked: OutputBlocked | null
  }
}

export type OutputBlocked =
  | { readonly reason: "unchanged" }
  /** The damaged sample: Live would refuse anything made from it. */
  | { readonly reason: "damaged" }
  /** `problems` is how many validation problems the converted set has. */
  | { readonly reason: "invalid"; readonly problems: number }

/**
 * Why an action was refused. Like `Blocked`, a code and its values: nothing
 * the engine returns is a sentence.
 */
export type Refusal =
  | Blocked
  | { readonly code: "nothing_to_change"; readonly values: Record<never, never> }
  | { readonly code: "already_v10"; readonly values: Record<never, never> }
  | {
      readonly code: "unverified_version"
      readonly values: { readonly version: number }
    }
  | { readonly code: "invalid_bpm"; readonly values: Record<never, never> }
  | { readonly code: "no_warped_clips"; readonly values: Record<never, never> }
  | { readonly code: "same_track"; readonly values: Record<never, never> }
  | {
      readonly code: "track_without_clips"
      readonly values: { readonly track: string }
    }
  | {
      readonly code: "relative_library_root"
      readonly values: Record<never, never>
    }
  | {
      readonly code: "relink_unresolved"
      readonly values: { readonly count: number; readonly folder: string }
    }
  | {
      readonly code: "relink_already_there"
      readonly values: Record<never, never>
    }
  | { readonly code: "output_unchanged"; readonly values: Record<never, never> }
  | { readonly code: "output_damaged"; readonly values: Record<never, never> }
  | {
      readonly code: "output_invalid"
      readonly values: { readonly problems: number }
    }
  /**
   * The library refused and gave only English prose, no code. The engine
   * checks every refusal it knows of first, so this is the fallback for one
   * a newer library adds.
   */
  | {
      readonly code: "library_error"
      readonly values: { readonly detail: string }
    }

export type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: Refusal }

/** What the worker is doing right now, as a code the page words. */
export type Phase =
  | "reading_file"
  | "building_sample"
  | "decompressing"
  | "reading_structure"
  | "listing_files"
  | "validating"
  | "diagnosing"
  | "converting"
  | "repairing"
  | "compressing"

/** The refusal that goes with a result that is not offered for download. */
export function outputRefusal(blocked: OutputBlocked): Refusal {
  switch (blocked.reason) {
    case "unchanged":
      return { code: "output_unchanged", values: {} }
    case "damaged":
      return { code: "output_damaged", values: {} }
    case "invalid":
      return { code: "output_invalid", values: { problems: blocked.problems } }
  }
}

// ---------------------------------------------------------------------------
// Opening a file
// ---------------------------------------------------------------------------

/** A large Live 12 set passes 50 MB decompressed; past this a tab struggles. */
export const MAX_XML_CHARS = 120 * 1024 * 1024

export type OpenError =
  | "empty_file"
  | "not_gzip"
  | "not_a_live_set"
  | "too_large"
  | "corrupt_gzip"

/** gzip magic number. An `.als` is validated by content, never by extension. */
export function looksGzipped(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

/** Is this decompressed text a Live document at all? */
export function checkDocument(xml: string): OpenError | null {
  if (xml.length > MAX_XML_CHARS) return "too_large"
  if (detectVersion(xml).major === null) return "not_a_live_set"
  return null
}

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

// DEMO-SIDE READING. Same pattern the library uses for a FileRef; here it only
// feeds the "referenced files" table.
const FILE_REF = /<FileRef(?:\s+[\w:-]+="[^"]*")*\s*>([\s\S]*?)<\/FileRef>/g
const AUDIO_FILE = /\.(wav|aif|aiff|mp3|flac|ogg|m4a)$/i

type RawFileRef = {
  readonly start: number
  readonly end: number
  readonly name: string
  readonly path: string | null
  readonly hasAlias: boolean
}

function readTag(body: string, tag: string): string | null {
  const match = new RegExp(`<${tag} Value="([^"]*)" />`).exec(body)
  return match ? unescapeXml(match[1]!) : null
}

function collectRawFileRefs(xml: string): readonly RawFileRef[] {
  const refs: RawFileRef[] = []
  FILE_REF.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FILE_REF.exec(xml)) !== null) {
    const body = match[1]!
    const start = match.index
    const end = match.index + match[0].length
    const name = readTag(body, "Name")
    if (name !== null) {
      // Live 10 shape: the absolute location is the `PathHint` chain.
      const hint = /<PathHint>([\s\S]*?)<\/PathHint>/.exec(body)
      const dirs = hint
        ? [...hint[1]!.matchAll(/Dir="([^"]*)"/g)].map((dir) =>
            unescapeXml(dir[1]!)
          )
        : []
      if (name === "") continue
      refs.push({
        start,
        end,
        name,
        path: dirs.length > 0 ? `/${[...dirs, name].join("/")}` : null,
        hasAlias: /<Data>\s*[0-9A-Fa-f]/.test(body),
      })
      continue
    }
    // Live 12 shape: one `<Path>` element, absolute most of the time.
    const path = readTag(body, "Path")
    if (path === null || path === "") continue
    refs.push({
      start,
      end,
      name: path.split("/").pop() ?? path,
      path,
      hasAlias: false,
    })
  }
  return refs
}

function summarizeFileRefs(raw: readonly RawFileRef[]): readonly FileRefView[] {
  const byKey = new Map<string, FileRefView>()
  for (const ref of raw) {
    const key = ref.path ?? ref.name
    const known = byKey.get(key)
    if (known) {
      byKey.set(key, {
        ...known,
        refs: known.refs + 1,
        hasAlias: known.hasAlias || ref.hasAlias,
      })
      continue
    }
    const folder =
      ref.path === null ? "" : ref.path.slice(0, ref.path.lastIndexOf("/"))
    byKey.set(key, {
      name: ref.name,
      folder,
      path: ref.path,
      refs: 1,
      audio: AUDIO_FILE.test(ref.name),
      external: ref.path !== null && ref.path.startsWith("/Volumes/"),
      hasAlias: ref.hasAlias,
    })
  }
  return [...byKey.values()].sort(
    (a, b) =>
      Number(b.audio) - Number(a.audio) ||
      (a.path ?? a.name).localeCompare(b.path ?? b.name)
  )
}

/**
 * The folder most of the audio lives under: the deepest directory that still
 * holds at least four fifths of the absolute audio paths. A stray file on
 * another disk must not drag the guess up to `/Volumes`.
 */
export function guessLibraryRoot(files: readonly FileRefView[]): string {
  const paths = files
    .filter((file) => file.audio && file.path !== null)
    .map((file) => file.path!)
    .filter((path) => path.startsWith("/"))
  if (paths.length === 0) return ""

  const counts = new Map<string, number>()
  for (const path of paths) {
    const segments = path.split("/").filter(Boolean).slice(0, -1)
    for (let depth = 2; depth <= segments.length; depth++) {
      const prefix = `/${segments.slice(0, depth).join("/")}`
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
    }
  }
  const needed = Math.ceil(paths.length * 0.8)
  let best = ""
  for (const [prefix, count] of counts) {
    if (count >= needed && prefix.length > best.length) best = prefix
  }
  return best
}

function signatureLabel(id: number | null): string | null {
  if (id === null) return null
  const signature = decodeTimeSignatureId(id)
  return signature ? `${signature.num}/${signature.den}` : null
}

/** Track and scene colour: Live 10 stores a shifted index, Live 12 the raw one. */
function elementColor(index: number | null, legacy: boolean): string | null {
  if (index === null) return null
  return legacy ? liveColorHex(index) : clipColorHex(index)
}

type SlotExtra = { readonly color: string | null; readonly file: string | null }

// DEMO-SIDE READING. A clip's colour is the raw palette index in both
// versions; only the tag name differs (`ColorIndex` in 10, `Color` in 12).
// The file name is looked up by position, because `parseAlsDocument` reads a
// clip's sample name only from the Live 10 reference shape.
function slotExtrasByTrack(
  xml: string,
  refs: readonly RawFileRef[]
): ReadonlyMap<number, SlotExtra[]> {
  const byTrack = new Map<number, SlotExtra[]>()
  const firstRefFrom = (offset: number): RawFileRef | undefined => {
    let low = 0
    let high = refs.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (refs[middle]!.start < offset) low = middle + 1
      else high = middle
    }
    return refs[low]
  }
  for (const list of describeClipSlotLists(xml)) {
    if (!list.isSession || list.trackIndex < 0) continue
    if (byTrack.has(list.trackIndex)) continue
    byTrack.set(
      list.trackIndex,
      list.slots.map((slot) => {
        const body = xml.slice(slot.start, slot.end)
        const clipAt = body.search(/<(?:AudioClip|MidiClip) /)
        if (clipAt === -1) return { color: null, file: null }
        const match = /<(?:ColorIndex|Color) Value="(-?\d+)"/.exec(
          body.slice(clipAt)
        )
        const ref = firstRefFrom(slot.start)
        return {
          color: match ? clipColorHex(Number(match[1])) : null,
          file: ref && ref.start < slot.end ? ref.name : null,
        }
      })
    )
  }
  return byTrack
}

function diagnoseTools(xml: string, version: AlsVersion): readonly ToolView[] {
  const pointee = inspectPointeeIds(xml)
  const rewarp = inspectRewarp(xml)
  const trackNames = listTrackNames(xml)
  // Follow actions are only inspected where the fields exist. On Live 10 the
  // read would return zeros and the page would claim everything is fine.
  const followSupported = supportsTool("followActions", version)
  const follow = followSupported ? inspectFollowActions(xml) : null

  const unsupported = (): Blocked => unsupportedVersion(version)

  const gridOff =
    rewarp.gridBpm !== null &&
    rewarp.masterBpm !== null &&
    Math.abs(rewarp.gridBpm - rewarp.masterBpm) > 1e-6

  return [
    {
      id: "pointeeIds",
      supported: supportsTool("pointeeIds", version),
      pending: pointee.extraOccurrences,
      blocked: !supportsTool("pointeeIds", version)
        ? unsupported()
        : pointee.collidingReferences.length > 0
          ? {
              code: "colliding_pointee_ids",
              values: { ids: pointee.collidingReferences.join(", ") },
            }
          : null,
      facts: pointeeFacts(pointee),
    },
    {
      id: "rewarp",
      supported: supportsTool("rewarp", version),
      pending: gridOff ? rewarp.clips : 0,
      blocked: !supportsTool("rewarp", version) ? unsupported() : null,
      facts: [
        { label: { key: "audioClips" }, value: rewarp.clips },
        ...rewarpFacts(rewarp),
      ],
    },
    {
      id: "followActions",
      supported: followSupported,
      pending:
        follow === null
          ? 0
          : follow.needEnable + follow.needUnlink + follow.needRetime,
      blocked: !followSupported
        ? unsupported()
        : follow !== null && follow.conflicting.length > 0
          ? {
              code: "mixed_clip_durations",
              values: { count: follow.conflicting.length },
            }
          : null,
      facts:
        follow === null
          ? []
          : [
              { label: { key: "clips" }, value: follow.clips },
              ...followFacts(follow),
            ],
    },
    {
      id: "mirrorTrack",
      supported: supportsTool("mirrorTrack", version),
      pending: 0,
      blocked: !supportsTool("mirrorTrack", version)
        ? unsupported()
        : trackNames.length < 2
          ? { code: "needs_two_tracks", values: {} }
          : null,
      facts: [{ label: { key: "tracksWithClips" }, value: trackNames.length }],
    },
    {
      id: "relinkSamples",
      supported: supportsTool("relinkSamples", version),
      pending: 0,
      blocked: !supportsTool("relinkSamples", version) ? unsupported() : null,
      facts: [],
    },
  ]
}

// Two different reasons to refuse, and the visitor needs to know which: the
// whole version was never verified, or only this tool does not cover it.
function unsupportedVersion(version: AlsVersion): Blocked {
  return {
    code: "unsupported_version",
    values: { version: version.major ?? "?" },
    untested: isUntestedVersion(version),
  }
}

function pointeeFacts(report: PointeeReport): readonly Fact[] {
  return [
    { label: { key: "automationTargets" }, value: report.targets },
    { label: { key: "duplicatedIds" }, value: report.duplicatedIds.length },
    { label: { key: "extraOccurrences" }, value: report.extraOccurrences },
  ]
}

function rewarpFacts(report: RewarpReport): readonly Fact[] {
  return [
    { label: { key: "clipsWarpedAt" }, value: { byBpm: report.byBpm } },
    { label: { key: "gridBpm" }, value: report.gridBpm },
    { label: { key: "masterBpm" }, value: report.masterBpm },
  ]
}

function followFacts(report: FollowReport): readonly Fact[] {
  return [
    { label: { key: "needEnable" }, value: report.needEnable },
    { label: { key: "needUnlink" }, value: report.needUnlink },
    { label: { key: "needRetime" }, value: report.needRetime },
  ]
}

export function inspect(
  xml: string,
  meta: { readonly fileName: string; readonly sizeBytes: number },
  phase: (phase: Phase) => void = () => {}
): Inspection {
  phase("reading_structure")
  const version = detectVersion(xml)
  const document = parseAlsDocument(xml)
  const legacy = version.major !== null && version.major <= 10

  const sceneRanges = findSceneRanges(xml)
  const scenes: SceneView[] = document.scenes.map((scene, index) => {
    if (document.sceneSchema === "v10") {
      const tempo = readSceneTempo(scene.rawName)
      return {
        name: scene.rawName,
        color: elementColor(scene.colorIndex, true),
        bpm: tempo.bpm,
        signature: tempo.timeSignatureLabel,
      }
    }
    const range = sceneRanges[index]
    const body = range ? xml.slice(range.start, range.end) : ""
    const signatureOn = /<IsTimeSignatureEnabled Value="true"/.test(body)
    // DEMO-SIDE READING. Live single-quotes an attribute whose value holds a
    // double quote, and `parseAlsDocument` reads such a scene name as empty.
    const quoted =
      scene.rawName === "" ? /<Name Value='([^']*)'/.exec(body) : null
    return {
      name: quoted ? unescapeXml(quoted[1]!) : scene.rawName,
      color: elementColor(scene.colorIndex, false),
      bpm: scene.tempoEnabled === true ? scene.tempo : null,
      signature: signatureOn ? signatureLabel(scene.timeSignatureId) : null,
    }
  })

  const rawRefs = collectRawFileRefs(xml)
  const slotExtras = slotExtrasByTrack(xml, rawRefs)
  let audioClips = 0
  let midiClips = 0
  const tracks: TrackView[] = document.tracks.map((track, trackIndex) => {
    const extras = slotExtras.get(trackIndex) ?? []
    return {
      name: track.name,
      type: track.type,
      color: elementColor(track.colorIndex, legacy),
      output: track.audioOutTarget,
      clips: track.sessionClips.map((clip, slot) => {
        if (clip === null) return null
        if (clip.kind === "audio") audioClips++
        else midiClips++
        return {
          name: clip.rawName ?? "",
          kind: clip.kind,
          color: extras[slot]?.color ?? null,
          bpm: clip.warpBpm,
          sample: clip.sample?.fileName ?? extras[slot]?.file ?? null,
          signature: clip.timeSignature
            ? `${clip.timeSignature.num}/${clip.timeSignature.den}`
            : null,
          lengthBeats:
            clip.loopStart !== null && clip.loopEnd !== null
              ? clip.loopEnd - clip.loopStart
              : null,
        }
      }),
    }
  })

  phase("listing_files")
  const files = summarizeFileRefs(rawRefs)

  phase("validating")
  const problems = validateGeneratedSet(xml)

  phase("diagnosing")
  const tools = diagnoseTools(xml, version)

  const major = version.major ?? 0
  const convert: ConvertAvailability =
    major <= 10
      ? { state: "already_v10" }
      : major === 11
        ? { state: "unverified", major }
        : { state: "ready" }

  return {
    fileName: meta.fileName,
    sizeBytes: meta.sizeBytes,
    xmlLength: xml.length,
    version,
    sceneSchema: document.sceneSchema,
    masterTempo: document.masterTempo,
    masterSignature: signatureLabel(document.masterTimeSignatureId),
    nextPointeeId: document.nextPointeeId,
    gridConsistent: gridIsConsistent(document),
    scenes,
    tracks,
    audioClips,
    midiClips,
    files,
    problems,
    tools,
    trackNames: listTrackNames(xml),
    convert,
    libraryRootGuess: guessLibraryRoot(files),
  }
}

// ---------------------------------------------------------------------------
// Excerpts: small, readable slices of the real XML, before and after
// ---------------------------------------------------------------------------

/**
 * Re-indents a fragment for display. The converter writes some elements on a
 * single line, and a 2,000 character line teaches nobody anything.
 */
export function prettyXml(fragment: string, maxLines = 18): PrettyXml {
  const tokens = fragment.match(/<[^>]+>|[^<]+/g) ?? []
  const lines: PrettyLine[] = []
  let depth = 0
  for (const token of tokens) {
    if (!token.startsWith("<")) {
      const text = token.replace(/\s+/g, "")
      if (text === "") continue
      const indent = "  ".repeat(depth)
      lines.push(
        text.length > 48
          ? { indent, head: text.slice(0, 48), hexChars: text.length }
          : `${indent}${text}`
      )
      continue
    }
    const closing = token.startsWith("</")
    const selfClosing = token.endsWith("/>") || token.startsWith("<?")
    if (closing) depth = Math.max(0, depth - 1)
    const tag = token.replace(/\s+/g, " ")
    const indent = "  ".repeat(depth)
    lines.push(
      tag.length + indent.length > 96
        ? `${indent}${tag.slice(0, 96 - indent.length)}…`
        : `${indent}${tag}`
    )
    if (!closing && !selfClosing) depth++
  }
  if (lines.length <= maxLines) return { lines, hiddenLines: 0 }
  // One line of the budget goes to saying how many were left out.
  return {
    lines: lines.slice(0, maxLines - 1),
    hiddenLines: lines.length - maxLines + 1,
  }
}

function headerExcerpt(xml: string): PrettyXml {
  const tag = /<Ableton [^>]*>/.exec(xml)?.[0] ?? ""
  const attributes = tag.match(/[\w:-]+="[^"]*"/g) ?? []
  const lines = ["<Ableton", ...attributes.map((attribute) => `  ${attribute}`)]
  const last = lines.pop() ?? ""
  return { lines: [...lines, `${last}>`], hiddenLines: 0 }
}

function countTags(xml: string): Map<string, number> {
  const counts = new Map<string, number>()
  const pattern = /<([A-Za-z_][\w.]*)[\s/>]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null) {
    counts.set(match[1]!, (counts.get(match[1]!) ?? 0) + 1)
  }
  return counts
}

function tagDeltas(before: string, after: string): readonly TagDelta[] {
  const a = countTags(before)
  const b = countTags(after)
  const deltas: TagDelta[] = []
  for (const tag of new Set([...a.keys(), ...b.keys()])) {
    const was = a.get(tag) ?? 0
    const is = b.get(tag) ?? 0
    if (was !== is) deltas.push({ tag, before: was, after: is })
  }
  return deltas.sort(
    (x, y) =>
      Math.abs(y.after - y.before) - Math.abs(x.after - x.before) ||
      x.tag.localeCompare(y.tag)
  )
}

// ---------------------------------------------------------------------------
// The session: one opened file and the steps applied to it
// ---------------------------------------------------------------------------

/** Undo keeps earlier documents alive; past this many characters it lets go. */
const HISTORY_BUDGET = 96 * 1024 * 1024

/** A file name safe to hand to a download: no separators, no control codes. */
export function safeFileName(name: string): string {
  return name.replace(/[/\\?%*:|"<>\x00-\x1f]/g, "_").slice(0, 180)
}

export function outputName(fileName: string, converted: boolean): string {
  const base = fileName.replace(/\.(als|xml)$/i, "").trim()
  const stem = safeFileName(base || (converted ? "converted" : "fixed"))
  return `${stem} ${converted ? "[v10]" : "[fix]"}.als`
}

function toolChanges(xml: string, operation: Operation): readonly Fact[] {
  switch (operation.tool) {
    case "pointeeIds":
      return pointeeFacts(inspectPointeeIds(xml))
    case "rewarp":
      return rewarpFacts(inspectRewarp(xml))
    case "followActions":
      return followFacts(inspectFollowActions(xml))
    case "mirrorTrack": {
      const preview = previewMirror(xml, operation.base, operation.target)
      return [
        { label: { key: "sharedScenes" }, value: preview.shared },
        { label: { key: "differingScenes" }, value: preview.differing },
      ]
    }
    case "relinkSamples": {
      const refs = collectRawFileRefs(xml).filter((ref) =>
        AUDIO_FILE.test(ref.name)
      )
      return [
        { label: { key: "firstAudioRef" }, value: refs[0]?.path ?? null },
        {
          label: { key: "refsWithAlias" },
          value: {
            part: refs.filter((ref) => ref.hasAlias).length,
            total: refs.length,
          },
        },
      ]
    }
  }
}

function zipChanges(
  before: readonly Fact[],
  after: readonly Fact[]
): readonly Change[] {
  return before.map((fact, index) => ({
    label: fact.label,
    before: fact.value,
    after: after[index]?.value ?? null,
  }))
}

export class Session {
  readonly fileName: string
  readonly sizeBytes: number
  readonly origin: Origin
  private readonly original: string
  private current: string
  private history: string[] = []
  private steps: StepView[] = []
  private cached: Inspection | null = null

  constructor(
    fileName: string,
    xml: string,
    sizeBytes: number,
    origin: Origin = "file"
  ) {
    this.fileName = fileName
    this.sizeBytes = sizeBytes
    this.origin = origin
    this.original = xml
    this.current = xml
  }

  /** The working document: the original plus every step applied so far. */
  get xml(): string {
    return this.current
  }

  get converted(): boolean {
    return this.steps.some((step) => step.kind === "convert")
  }

  state(phase?: (phase: Phase) => void): SessionState {
    this.cached ??= inspect(
      this.current,
      { fileName: this.fileName, sizeBytes: this.sizeBytes },
      phase
    )
    const inspection = this.cached
    // A converted file that fails validation is one Live 10 refuses, or opens
    // and then dies on. Handing it over would be the one unrecoverable mistake.
    const blocked: OutputBlocked | null =
      this.steps.length === 0
        ? { reason: "unchanged" }
        : this.converted && inspection.problems.length > 0
          ? { reason: "invalid", problems: inspection.problems.length }
          : this.origin === "damaged"
            ? { reason: "damaged" }
            : null
    return {
      origin: this.origin,
      inspection,
      steps: this.steps,
      canUndo: this.history.length > 0,
      output: { name: outputName(this.fileName, this.converted), blocked },
    }
  }

  private commit(next: string, step: StepView): void {
    this.history.push(this.current)
    let held = this.history.reduce((sum, xml) => sum + xml.length, 0)
    while (held > HISTORY_BUDGET && this.history.length > 0) {
      held -= this.history.shift()!.length
    }
    this.current = next
    this.steps.push(step)
    this.cached = null
  }

  undo(): void {
    const previous = this.history.pop()
    if (previous === undefined) return
    this.current = previous
    this.steps.pop()
    this.cached = null
  }

  reset(): void {
    this.current = this.original
    this.history = []
    this.steps = []
    this.cached = null
  }

  previewMirror(base: string, target: string): MirrorPreview {
    return previewMirror(this.current, base, target)
  }

  applyTool(operation: Operation): ActionResult {
    const version = detectVersion(this.current)
    if (!supportsTool(operation.tool, version)) {
      return { ok: false, refusal: unsupportedVersion(version) }
    }
    const before = toolChanges(this.current, operation)
    const outcome = runTool(this.current, operation)
    if (!outcome.ok) return { ok: false, refusal: outcome.refusal }
    if (outcome.changed === 0 || outcome.xml === this.current) {
      return { ok: false, refusal: { code: "nothing_to_change", values: {} } }
    }
    this.commit(outcome.xml, {
      kind: "tool",
      tool: operation.tool,
      changed: outcome.changed,
      skipped: outcome.skipped,
      changes: zipChanges(before, toolChanges(outcome.xml, operation)),
    })
    return { ok: true }
  }

  convert(libraryRoot: string): ActionResult {
    const source = this.current
    const version = detectVersion(source)
    const major = version.major ?? 0
    if (major <= 10) {
      return { ok: false, refusal: { code: "already_v10", values: {} } }
    }
    if (major === 11) {
      return {
        ok: false,
        refusal: { code: "unverified_version", values: { version: major } },
      }
    }

    const root = libraryRoot.trim()
    const result = downgradeToV10(source, {
      libraryRoot: root === "" ? "/" : root,
      // A browser cannot read a file's creation date, and Live ignores the
      // field (measured), so the library's deliberately synthetic constant
      // goes in. The path, which Live does use, is already in the document.
      fileCreatedAt: () => SYNTHETIC_CREATION_TIME,
      // A browser cannot tell how the visitor's disk is formatted. This value
      // made the alias records resolve on exFAT, HFS+ and APFS alike in
      // Live 10.1.43; the library's default works on exFAT only.
      volumeAttributes: PORTABLE_VOLUME_ATTRIBUTES,
    })
    if (!result.ok) return { ok: false, refusal: libraryError(result.error) }

    const beforeDocument = parseAlsDocument(source)
    const afterDocument = parseAlsDocument(result.xml)
    const afterRefs = collectRawFileRefs(result.xml).filter((ref) =>
      AUDIO_FILE.test(ref.name)
    )
    const beforeRefs = collectRawFileRefs(source)
    const firstAudio = beforeRefs.findIndex((ref) => AUDIO_FILE.test(ref.name))
    const allAfterRefs = collectRawFileRefs(result.xml)

    const changes: Change[] = [
      {
        label: { key: "savedBy" },
        before: version.creator,
        after: detectVersion(result.xml).creator,
      },
      {
        label: { key: "schema" },
        before: version.minorVersion,
        after: detectVersion(result.xml).minorVersion,
      },
    ]
    const tempoScene = beforeDocument.scenes.findIndex(
      (scene) => scene.tempoEnabled === true
    )
    const sceneIndex = tempoScene === -1 ? 0 : tempoScene
    const sceneBefore = beforeDocument.scenes[sceneIndex]
    const sceneAfter = afterDocument.scenes[sceneIndex]
    if (sceneBefore && sceneAfter) {
      changes.push({
        label: { key: "sceneName", scene: sceneIndex + 1 },
        before: sceneBefore.rawName,
        after: sceneAfter.rawName,
      })
    }
    const colored = beforeDocument.tracks.findIndex(
      (track) => track.colorIndex !== null && track.colorIndex >= 0
    )
    const trackBefore = beforeDocument.tracks[colored]
    const trackAfter = afterDocument.tracks[colored]
    if (trackBefore && trackAfter) {
      changes.push({
        label: { key: "trackColor", track: trackBefore.name },
        before: `Color ${trackBefore.colorIndex}`,
        after: `ColorIndex ${trackAfter.colorIndex}`,
      })
    }
    changes.push({
      label: { key: "audioRefsWithAlias" },
      before: { part: 0, total: afterRefs.length },
      after: {
        part: afterRefs.filter((ref) => ref.hasAlias).length,
        total: afterRefs.length,
      },
    })

    const excerpts: Excerpt[] = [
      {
        title: { key: "header" },
        before: headerExcerpt(source),
        after: headerExcerpt(result.xml),
      },
    ]
    const scenesBefore = findSceneRanges(source)
    const scenesAfter = findSceneRanges(result.xml)
    const rangeBefore = scenesBefore[sceneIndex]
    const rangeAfter = scenesAfter[sceneIndex]
    if (rangeBefore && rangeAfter) {
      excerpts.push({
        title: { key: "scene", scene: sceneIndex + 1 },
        before: prettyXml(source.slice(rangeBefore.start, rangeBefore.end)),
        after: prettyXml(result.xml.slice(rangeAfter.start, rangeAfter.end)),
      })
    }
    const refBefore = beforeRefs[firstAudio]
    const refAfter = allAfterRefs[firstAudio]
    if (refBefore && refAfter && beforeRefs.length === allAfterRefs.length) {
      excerpts.push({
        title: { key: "firstAudioRef" },
        before: prettyXml(source.slice(refBefore.start, refBefore.end)),
        after: prettyXml(result.xml.slice(refAfter.start, refAfter.end), 22),
      })
    }

    const deltas = tagDeltas(source, result.xml)
    this.commit(result.xml, {
      kind: "convert",
      report: {
        sourceCreator: version.creator,
        libraryRoot: root,
        scenesConverted: result.scenesConverted,
        warnings: result.warnings,
        problems: validateGeneratedSet(result.xml),
        aliases: {
          withRecord: afterRefs.filter((ref) => ref.hasAlias).length,
          audioRefs: afterRefs.length,
          offVolume: afterRefs.filter(
            (ref) => ref.path === null || !ref.path.startsWith("/Volumes/")
          ).length,
        },
        changes,
        tagDeltas: deltas.slice(0, 14),
        tagDeltaCount: deltas.length,
        excerpts,
      },
    })
    return { ok: true }
  }
}

/** A repair's result, without the library's English summary. */
type Outcome =
  | {
      readonly ok: true
      readonly xml: string
      readonly changed: number
      readonly skipped: number
    }
  | { readonly ok: false; readonly refusal: Refusal }

function libraryError(detail: string): Refusal {
  return { code: "library_error", values: { detail } }
}

function fromLibrary(outcome: ToolOutcome): Outcome {
  return outcome.ok
    ? { ok: true, xml: outcome.xml, changed: outcome.changed, skipped: 0 }
    : { ok: false, refusal: libraryError(outcome.error) }
}

const refuse = (refusal: Refusal): Outcome => ({ ok: false, refusal })

// The library says why it refuses in English prose only. Each refusal it is
// known to make is checked here first, from its own inspection functions, so
// the page gets a code it can word in any language.
function runTool(xml: string, operation: Operation): Outcome {
  switch (operation.tool) {
    case "pointeeIds": {
      const report = inspectPointeeIds(xml)
      if (
        report.duplicatedIds.length > 0 &&
        report.collidingReferences.length > 0
      ) {
        return refuse({
          code: "colliding_pointee_ids",
          values: { ids: report.collidingReferences.join(", ") },
        })
      }
      return fromLibrary(fixPointeeIds(xml))
    }
    case "followActions": {
      const report = inspectFollowActions(xml)
      if (report.conflicting.length > 0) {
        return refuse({
          code: "mixed_clip_durations",
          values: { count: report.conflicting.length },
        })
      }
      return fromLibrary(syncFollowActions(xml))
    }
    case "rewarp": {
      if (!Number.isFinite(operation.bpm) || operation.bpm <= 0) {
        return refuse({ code: "invalid_bpm", values: {} })
      }
      if (inspectRewarp(xml).gridBpm === null) {
        return refuse({ code: "no_warped_clips", values: {} })
      }
      return fromLibrary(rewarpClips(xml, operation.bpm))
    }
    case "mirrorTrack": {
      const { base, target } = operation
      if (base === target) return refuse({ code: "same_track", values: {} })
      const preview = previewMirror(xml, base, target)
      if (preview.shared + preview.baseOnly === 0) {
        return refuse({ code: "track_without_clips", values: { track: base } })
      }
      if (preview.shared + preview.targetOnly === 0) {
        return refuse({
          code: "track_without_clips",
          values: { track: target },
        })
      }
      return fromLibrary(mirrorTrackGeometry(xml, base, target))
    }
    case "relinkSamples": {
      const root = operation.libraryRoot.trim()
      if (!root.startsWith("/")) {
        return refuse({ code: "relative_library_root", values: {} })
      }
      const report = relinkFileRefs(xml, root, {
        fileCreatedAt: () => SYNTHETIC_CREATION_TIME,
        volumeAttributes: PORTABLE_VOLUME_ATTRIBUTES,
      })
      if (report.relinked === 0) {
        return refuse(
          report.unresolved.length > 0
            ? {
                code: "relink_unresolved",
                values: {
                  count: report.unresolved.length,
                  folder: root.split("/").filter(Boolean).pop() ?? "",
                },
              }
            : { code: "relink_already_there", values: {} }
        )
      }
      return {
        ok: true,
        xml: report.xml,
        changed: report.relinked,
        skipped: report.unresolved.length,
      }
    }
  }
}
