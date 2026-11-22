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
  SYNTHETIC_CREATION_TIME,
  unescapeXml,
  validateGeneratedSet,
  type AlsVersion,
  type DowngradeWarning,
  type MirrorPreview,
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

export type Blocked = {
  readonly code: string
  readonly values: Readonly<Record<string, string | number>>
  readonly detail: string
}

export type Fact = { readonly label: string; readonly value: string }

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
  readonly label: string
  readonly before: string
  readonly after: string
}

export type TagDelta = {
  readonly tag: string
  readonly before: number
  readonly after: number
}

export type Excerpt = {
  readonly title: string
  readonly before: string
  readonly after: string
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
      readonly summary: string
      readonly changed: number
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

export type SessionState = {
  /** The built-in sample: a skeleton, never saved by Live. */
  readonly synthetic: boolean
  readonly inspection: Inspection
  readonly steps: readonly StepView[]
  readonly canUndo: boolean
  readonly output: {
    readonly name: string
    /** Why the result is not offered for download, or `null` when it is. */
    readonly blocked: {
      readonly reason: "unchanged" | "synthetic" | "invalid"
      readonly message: string
    } | null
  }
}

export type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string }

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

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)))
}

function diagnoseTools(xml: string, version: AlsVersion): readonly ToolView[] {
  const pointee = inspectPointeeIds(xml)
  const rewarp = inspectRewarp(xml)
  const trackNames = listTrackNames(xml)
  // Follow actions are only inspected where the fields exist. On Live 10 the
  // read would return zeros and the page would claim everything is fine.
  const followSupported = supportsTool("followActions", version)
  const follow = followSupported ? inspectFollowActions(xml) : null

  const unsupported = (): Blocked => ({
    code: "unsupported_version",
    values: { version: version.major ?? "?" },
    detail: isUntestedVersion(version)
      ? `Live ${version.major} files have not been verified yet, so no fix runs on them`
      : `this tool does not run on Live ${version.major ?? "?"} files`,
  })

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
              detail: `automation points at a duplicated Id (${pointee.collidingReferences.join(", ")}), so renumbering would attach it to the wrong occurrence`,
            }
          : null,
      facts: [
        { label: "Automation targets", value: String(pointee.targets) },
        { label: "Duplicated Ids", value: String(pointee.duplicatedIds.length) },
        { label: "Extra occurrences", value: String(pointee.extraOccurrences) },
      ],
    },
    {
      id: "rewarp",
      supported: supportsTool("rewarp", version),
      pending: gridOff ? rewarp.clips : 0,
      blocked: !supportsTool("rewarp", version) ? unsupported() : null,
      facts: [
        { label: "Audio clips", value: String(rewarp.clips) },
        { label: "Clips warped at", value: bpmSpread(rewarp.byBpm) },
        {
          label: "Grid BPM",
          value: rewarp.gridBpm === null ? "none" : formatNumber(rewarp.gridBpm),
        },
        {
          label: "Master BPM",
          value:
            rewarp.masterBpm === null ? "none" : formatNumber(rewarp.masterBpm),
        },
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
              detail: `${follow.conflicting.length} scene(s) have clips with different durations, and without one duration per row there is no way to tell when to jump`,
            }
          : null,
      facts:
        follow === null
          ? []
          : [
              { label: "Clips", value: String(follow.clips) },
              { label: "Need enabling", value: String(follow.needEnable) },
              { label: "Need unlinking", value: String(follow.needUnlink) },
              { label: "Need retiming", value: String(follow.needRetime) },
            ],
    },
    {
      id: "mirrorTrack",
      supported: supportsTool("mirrorTrack", version),
      pending: 0,
      blocked: !supportsTool("mirrorTrack", version)
        ? unsupported()
        : trackNames.length < 2
          ? {
              code: "needs_two_tracks",
              values: {},
              detail: "the file does not have two tracks with clips",
            }
          : null,
      facts: [{ label: "Tracks with clips", value: String(trackNames.length) }],
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

function bpmSpread(byBpm: readonly (readonly [number, number])[]): string {
  if (byBpm.length === 0) return "none"
  const shown = byBpm
    .slice(0, 4)
    .map(([bpm, count]) => `${formatNumber(bpm)} (${count})`)
    .join(", ")
  return byBpm.length > 4 ? `${shown}, +${byBpm.length - 4} more` : shown
}

export function inspect(
  xml: string,
  meta: { readonly fileName: string; readonly sizeBytes: number },
  phase: (label: string) => void = () => {}
): Inspection {
  phase("Reading tracks, scenes and clips…")
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

  phase("Listing referenced files…")
  const files = summarizeFileRefs(rawRefs)

  phase("Checking the structure Live depends on…")
  const problems = validateGeneratedSet(xml)

  phase("Looking for repairs…")
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
export function prettyXml(fragment: string, maxLines = 18): string {
  const tokens = fragment.match(/<[^>]+>|[^<]+/g) ?? []
  const lines: string[] = []
  let depth = 0
  for (const token of tokens) {
    if (!token.startsWith("<")) {
      const text = token.replace(/\s+/g, "")
      if (text === "") continue
      const shown =
        text.length > 48 ? `${text.slice(0, 48)}… (${text.length} hex chars)` : text
      lines.push(`${"  ".repeat(depth)}${shown}`)
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
  if (lines.length <= maxLines) return lines.join("\n")
  const hidden = lines.length - maxLines + 1
  return [...lines.slice(0, maxLines - 1), `… ${hidden} more lines`].join("\n")
}

function headerExcerpt(xml: string): string {
  const tag = /<Ableton [^>]*>/.exec(xml)?.[0] ?? ""
  const attributes = tag.match(/[\w:-]+="[^"]*"/g) ?? []
  return ["<Ableton", ...attributes.map((attribute) => `  ${attribute}`)].join(
    "\n"
  ) + ">"
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
    case "pointeeIds": {
      const report = inspectPointeeIds(xml)
      return [
        { label: "Automation targets", value: String(report.targets) },
        { label: "Duplicated Ids", value: String(report.duplicatedIds.length) },
        { label: "Extra occurrences", value: String(report.extraOccurrences) },
      ]
    }
    case "rewarp": {
      const report = inspectRewarp(xml)
      return [
        { label: "Clips warped at", value: bpmSpread(report.byBpm) },
        {
          label: "Grid BPM",
          value: report.gridBpm === null ? "none" : formatNumber(report.gridBpm),
        },
        {
          label: "Master BPM",
          value:
            report.masterBpm === null ? "none" : formatNumber(report.masterBpm),
        },
      ]
    }
    case "followActions": {
      const report = inspectFollowActions(xml)
      return [
        { label: "Need enabling", value: String(report.needEnable) },
        { label: "Need unlinking", value: String(report.needUnlink) },
        { label: "Need retiming", value: String(report.needRetime) },
      ]
    }
    case "mirrorTrack": {
      const preview = previewMirror(xml, operation.base, operation.target)
      return [
        { label: "Scenes both tracks share", value: String(preview.shared) },
        { label: "Scenes that differ", value: String(preview.differing) },
      ]
    }
    case "relinkSamples": {
      const refs = collectRawFileRefs(xml).filter((ref) =>
        AUDIO_FILE.test(ref.name)
      )
      return [
        { label: "First audio reference", value: refs[0]?.path ?? "none" },
        {
          label: "References with an alias record",
          value: `${refs.filter((ref) => ref.hasAlias).length} of ${refs.length}`,
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
    after: after[index]?.value ?? "",
  }))
}

export class Session {
  readonly fileName: string
  readonly sizeBytes: number
  readonly synthetic: boolean
  private readonly original: string
  private current: string
  private history: string[] = []
  private steps: StepView[] = []
  private cached: Inspection | null = null

  constructor(
    fileName: string,
    xml: string,
    sizeBytes: number,
    synthetic = false
  ) {
    this.fileName = fileName
    this.sizeBytes = sizeBytes
    this.synthetic = synthetic
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

  state(phase?: (label: string) => void): SessionState {
    this.cached ??= inspect(
      this.current,
      { fileName: this.fileName, sizeBytes: this.sizeBytes },
      phase
    )
    const inspection = this.cached
    // A converted file that fails validation is one Live 10 refuses, or opens
    // and then dies on. Handing it over would be the one unrecoverable mistake.
    const blocked: SessionState["output"]["blocked"] =
      this.steps.length === 0
        ? { reason: "unchanged", message: "Nothing has been changed yet." }
        : this.converted && inspection.problems.length > 0
          ? {
              reason: "invalid",
              message: `The converted set has ${inspection.problems.length} validation problem(s). Live 10 would refuse it or crash loading it, so it is not offered for download.`,
            }
          : this.synthetic
            ? {
                reason: "synthetic",
                message:
                  "The sample is a skeleton written for this page, not a complete set, so its result is not offered as a file. Open your own .als to download one.",
              }
            : null
    return {
      synthetic: this.synthetic,
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
      return {
        ok: false,
        error: `This tool does not run on Live ${version.major ?? "?"} files.`,
      }
    }
    const before = toolChanges(this.current, operation)
    const outcome = runTool(this.current, operation)
    if (!outcome.ok) return { ok: false, error: outcome.error }
    if (outcome.changed === 0 || outcome.xml === this.current) {
      return { ok: false, error: "Nothing to change: the set already agrees." }
    }
    this.commit(outcome.xml, {
      kind: "tool",
      tool: operation.tool,
      summary: outcome.summary,
      changed: outcome.changed,
      changes: zipChanges(before, toolChanges(outcome.xml, operation)),
    })
    return { ok: true }
  }

  convert(libraryRoot: string): ActionResult {
    const source = this.current
    const version = detectVersion(source)
    const major = version.major ?? 0
    if (major <= 10) {
      return { ok: false, error: "This set is already in the Live 10 format." }
    }
    if (major === 11) {
      return {
        ok: false,
        error:
          "Live 11 sets have never been measured against a real file, so this page does not convert them.",
      }
    }

    const root = libraryRoot.trim()
    const result = downgradeToV10(source, {
      libraryRoot: root === "" ? "/" : root,
      // A browser cannot read a file's creation date, and Live ignores the
      // field (measured), so the library's deliberately synthetic constant
      // goes in. The path, which Live does use, is already in the document.
      fileCreatedAt: () => SYNTHETIC_CREATION_TIME,
    })
    if (!result.ok) return { ok: false, error: result.error }

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
        label: "Saved by",
        before: version.creator,
        after: detectVersion(result.xml).creator,
      },
      {
        label: "Schema",
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
        label: `Scene ${sceneIndex + 1} name`,
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
        label: `Colour of track ${trackBefore.name}`,
        before: `Color ${trackBefore.colorIndex}`,
        after: `ColorIndex ${trackAfter.colorIndex}`,
      })
    }
    changes.push({
      label: "Audio references with an alias record",
      before: `0 of ${afterRefs.length}`,
      after: `${afterRefs.filter((ref) => ref.hasAlias).length} of ${afterRefs.length}`,
    })

    const excerpts: Excerpt[] = [
      {
        title: "Document header",
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
        title: `Scene ${sceneIndex + 1}`,
        before: prettyXml(source.slice(rangeBefore.start, rangeBefore.end)),
        after: prettyXml(result.xml.slice(rangeAfter.start, rangeAfter.end)),
      })
    }
    const refBefore = beforeRefs[firstAudio]
    const refAfter = allAfterRefs[firstAudio]
    if (refBefore && refAfter && beforeRefs.length === allAfterRefs.length) {
      excerpts.push({
        title: "First audio reference",
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

function runTool(xml: string, operation: Operation): ToolOutcome {
  switch (operation.tool) {
    case "pointeeIds":
      return fixPointeeIds(xml)
    case "followActions":
      return syncFollowActions(xml)
    case "rewarp":
      return rewarpClips(xml, operation.bpm)
    case "mirrorTrack":
      return mirrorTrackGeometry(xml, operation.base, operation.target)
    case "relinkSamples": {
      const root = operation.libraryRoot.trim()
      if (!root.startsWith("/")) {
        return {
          ok: false,
          error: "Enter the absolute path of the library folder, starting with /",
        }
      }
      const report = relinkFileRefs(xml, root, {
        fileCreatedAt: () => SYNTHETIC_CREATION_TIME,
      })
      if (report.relinked === 0) {
        return {
          ok: false,
          error:
            report.unresolved.length > 0
              ? `No reference could be re-rooted. The document does not say where ${report.unresolved.length} file(s) sit inside a folder named "${root.split("/").filter(Boolean).pop() ?? ""}".`
              : "Every reference already points inside that folder.",
        }
      }
      return {
        ok: true,
        xml: report.xml,
        changed: report.relinked,
        summary:
          report.unresolved.length > 0
            ? `${report.relinked} reference(s) re-rooted at ${root}; ${report.unresolved.length} left as they were`
            : `${report.relinked} reference(s) re-rooted at ${root}`,
      }
    }
  }
}
