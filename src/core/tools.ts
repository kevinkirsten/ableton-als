// ---------------------------------------------------------------------------
// The `.als` repairs a tools surface can offer, as pure functions over the
// already-decompressed XML.
//
// Each one was born from a real problem in the archive, and they live here as
// one implementation because a UI and a command line need the SAME algorithm:
// two implementations of the same fix would drift apart, and the cost of
// drifting in a file that opens in Ableton is high.
//
// Rule that runs through the whole file: **no tool runs on a Live version that
// does not have the fields it touches.** Refusing is worth more than producing
// a file that passes every validation and takes Live down mid-load.
// ---------------------------------------------------------------------------

/** Shared format-reading rules (see `document.ts`). */
const TRACK_OPEN = /<(AudioTrack|MidiTrack) Id="\d+"/g
const CLIP_IN_SLOT = /<(AudioClip|MidiClip) [\s\S]*?<\/\1>/
const AUDIO_CLIP = /<AudioClip [\s\S]*?<\/AudioClip>/g
const WARP_MARKER =
  /<WarpMarker Id="(\d+)" SecTime="([-\d.e]+)" BeatTime="([-\d.e]+)"\s*\/>/g
const TARGET_ID = /<([A-Za-z0-9_.]*(?:Automation|Modulation)Target) Id="(\d+)"/g
const POINTEE_ID = /<PointeeId Value="(\d+)"/g
const NEXT_POINTEE = /<NextPointeeId Value="(\d+)"\s*\/>/

const TOLERANCE = 1e-6

/** Clip fields measured in beats. `FollowTime` is handled separately. */
const BEAT_FIELDS = [
  "CurrentStart",
  "CurrentEnd",
  "LoopStart",
  "LoopEnd",
  "HiddenLoopStart",
  "HiddenLoopEnd",
] as const

// ---------------------------------------------------------------------------
// Version and capabilities
// ---------------------------------------------------------------------------

export type ToolId =
  | "pointeeIds"
  | "rewarp"
  | "mirrorTrack"
  | "followActions"
  | "relinkSamples"

/**
 * Which Live version each tool can run on. Measured against real files on
 * 2026-08-09, not deduced: v10 has no `FollowActionEnabled`/`IsLinked` (it
 * uses `FollowChanceA` in 0..1), and v12 swaps the `RelativePathElement` list
 * for a `RelativePath` attribute, changing the whole `FileRef`.
 */
export const TOOL_SUPPORT: Readonly<
  Record<ToolId, { readonly v10: boolean; readonly v12: boolean }>
> = {
  pointeeIds: { v10: true, v12: true },
  rewarp: { v10: true, v12: true },
  mirrorTrack: { v10: true, v12: true },
  followActions: { v10: false, v12: true },
  relinkSamples: { v10: true, v12: false },
}

export type AlsVersion = {
  /** 10, 11, 12… `null` when the header is not from a Live file. */
  readonly major: number | null
  readonly minorVersion: string
  readonly creator: string
}

export function detectVersion(xml: string): AlsVersion {
  const minor = /<Ableton[^>]*MinorVersion="([^"]*)"/.exec(xml)?.[1] ?? ""
  const creator = /<Ableton[^>]*Creator="([^"]*)"/.exec(xml)?.[1] ?? ""
  const major = /^(\d+)\./.exec(minor)?.[1]
  return {
    major: major === undefined ? null : Number(major),
    minorVersion: minor,
    creator,
  }
}

/**
 * Versions whose format has actually been verified. The archive is v9/v10 and
 * the maintainer works in v12; a Live 8 set from MultiTracks.com, for example,
 * has already turned up WITHOUT `NextPointeeId` — renumbering there would
 * leave Live free to reuse an Id we had just handed to another target.
 * Outside this range, nothing runs.
 */
const LEGACY_RANGE = { min: 9, max: 10 } as const
const MODERN_MINIMUM = 11

/** Can the tool run on this file? An unverified version never can. */
export function supportsTool(tool: ToolId, version: AlsVersion): boolean {
  if (version.major === null) return false
  const support = TOOL_SUPPORT[tool]
  if (version.major >= MODERN_MINIMUM) return support.v12
  if (version.major >= LEGACY_RANGE.min && version.major <= LEGACY_RANGE.max) {
    return support.v10
  }
  return false
}

/** Why no tool shows up at all: the version was never verified. */
export function isUntestedVersion(version: AlsVersion): boolean {
  return version.major !== null && version.major < LEGACY_RANGE.min
}

// ---------------------------------------------------------------------------
// Reading helpers
// ---------------------------------------------------------------------------

function formatBeat(value: number): string {
  const rounded = Math.round(value)
  return Math.abs(value - rounded) < TOLERANCE
    ? String(rounded)
    : String(Number(value.toPrecision(17)))
}

/** The BPM described by the first two warp markers. */
export function clipWarpBpm(clipBody: string): number | null {
  const markers = [...clipBody.matchAll(WARP_MARKER)]
  if (markers.length < 2) return null
  const seconds = Number(markers[1]![2]) - Number(markers[0]![2])
  const beats = Number(markers[1]![3]) - Number(markers[0]![3])
  return seconds > 0 ? (beats / seconds) * 60 : null
}

/**
 * The track's SESSION `<ClipSlotList>`. Every track has two (session and
 * freeze) and the Id does not tell them apart: the right one is the one
 * preceded by a `<MainSequencer` closer than any `<FreezeSequencer`.
 */
function sessionListRange(
  xml: string,
  trackStart: number,
  trackEnd: number
): { readonly start: number; readonly end: number } | null {
  let cursor = trackStart
  while (cursor < trackEnd) {
    const open = xml.indexOf("<ClipSlotList>", cursor)
    if (open < 0 || open >= trackEnd) return null
    const close = xml.indexOf("</ClipSlotList>", open)
    if (close < 0 || close >= trackEnd) return null
    if (
      xml.lastIndexOf("<MainSequencer", open) >
      xml.lastIndexOf("<FreezeSequencer", open)
    ) {
      return { start: open + "<ClipSlotList>".length, end: close }
    }
    cursor = close + 1
  }
  return null
}

export type ClipRef = {
  /** Scene index: the Nth slot belongs to the Nth scene. */
  readonly scene: number
  readonly track: string
  readonly trackIndex: number
  readonly kind: "AudioClip" | "MidiClip"
  readonly start: number
  readonly end: number
  readonly body: string
}

/** Every session clip in the document, with its position in the XML. */
export function collectClips(xml: string): readonly ClipRef[] {
  const clips: ClipRef[] = []
  const starts = [...xml.matchAll(TRACK_OPEN)].map((match) => match.index)

  for (const [trackIndex, start] of starts.entries()) {
    const end = starts[trackIndex + 1] ?? xml.length
    const name =
      /<Name>\s*<EffectiveName Value="([^"]*)"/.exec(
        xml.slice(start, end)
      )?.[1] ?? ""
    const list = sessionListRange(xml, start, end)
    if (list === null) continue

    const opens: number[] = []
    const slotOpen = /<ClipSlot Id="(-?\d+)">/g
    slotOpen.lastIndex = list.start
    let match: RegExpExecArray | null
    while ((match = slotOpen.exec(xml)) !== null) {
      if (match.index >= list.end) break
      opens.push(match.index)
    }

    for (const [scene, slotStart] of opens.entries()) {
      const slotEnd = opens[scene + 1] ?? list.end
      const segment = xml.slice(slotStart, slotEnd)
      const clip = CLIP_IN_SLOT.exec(segment)
      if (clip === null) continue
      clips.push({
        scene,
        track: name,
        trackIndex,
        kind: clip[1] as ClipRef["kind"],
        start: slotStart + clip.index,
        end: slotStart + clip.index + clip[0].length,
        body: clip[0],
      })
    }
  }
  return clips
}

/** Applies range replacements back to front (offsets do not shift). */
function applyEdits(
  xml: string,
  edits: readonly {
    readonly start: number
    readonly end: number
    readonly text: string
  }[]
): string {
  let output = xml
  for (const edit of [...edits].sort(
    (left, right) => right.start - left.start
  )) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end)
  }
  return output
}

export type ToolOutcome =
  | {
      readonly ok: true
      readonly xml: string
      readonly summary: string
      readonly changed: number
    }
  | { readonly ok: false; readonly error: string }

// ---------------------------------------------------------------------------
// 1. Duplicated pointee Ids  (Live 12 refuses the file)
// ---------------------------------------------------------------------------

export type PointeeReport = {
  readonly targets: number
  readonly duplicatedIds: readonly string[]
  readonly extraOccurrences: number
  /** References pointing at a duplicated Id: they block the automatic fix. */
  readonly collidingReferences: readonly string[]
}

export function inspectPointeeIds(xml: string): PointeeReport {
  const seen = new Map<string, number>()
  for (const match of xml.matchAll(TARGET_ID)) {
    seen.set(match[2]!, (seen.get(match[2]!) ?? 0) + 1)
  }
  const duplicated = [...seen.entries()].filter(([, count]) => count > 1)
  const duplicatedIds = new Set(duplicated.map(([id]) => id))
  const referenced = new Set(
    [...xml.matchAll(POINTEE_ID)].map((match) => match[1]!)
  )
  return {
    targets: [...seen.values()].reduce((total, count) => total + count, 0),
    duplicatedIds: duplicated.map(([id]) => id),
    extraOccurrences: duplicated.reduce(
      (total, [, count]) => total + count - 1,
      0
    ),
    collidingReferences: [...referenced].filter((id) => duplicatedIds.has(id)),
  }
}

export function fixPointeeIds(xml: string): ToolOutcome {
  const report = inspectPointeeIds(xml)
  if (report.duplicatedIds.length === 0) {
    return { ok: true, xml, summary: "no duplicated Ids", changed: 0 }
  }
  if (report.collidingReferences.length > 0) {
    return {
      ok: false,
      error: `an automation reference points at a duplicated Id (${report.collidingReferences.join(", ")}) — renumbering blindly would attach the automation to the wrong occurrence`,
    }
  }

  const declaredNext = Number(NEXT_POINTEE.exec(xml)?.[1] ?? 0)
  let highest = 0
  for (const match of xml.matchAll(/\sId="(\d+)"/g)) {
    highest = Math.max(highest, Number(match[1]))
  }
  let nextId = Math.max(declaredNext, highest + 1)

  const used = new Set<string>()
  const edits: { start: number; end: number; text: string }[] = []
  for (const match of xml.matchAll(TARGET_ID)) {
    const [whole, tag, id] = match
    if (!used.has(id!)) {
      used.add(id!)
      continue
    }
    edits.push({
      start: match.index,
      end: match.index + whole.length,
      text: `<${tag} Id="${nextId}"`,
    })
    nextId += 1
  }

  const output = applyEdits(xml, edits).replace(
    NEXT_POINTEE,
    `<NextPointeeId Value="${nextId}" />`
  )
  return {
    ok: true,
    xml: output,
    summary: `${edits.length} Ids reassigned (${report.duplicatedIds.length} were duplicated)`,
    changed: edits.length,
  }
}

// ---------------------------------------------------------------------------
// 2. Rewarp: clip BPM + the beat grid that arrived in the old scale
// ---------------------------------------------------------------------------

export type RewarpReport = {
  readonly masterBpm: number | null
  readonly clips: number
  /** BPM → how many clips. */
  readonly byBpm: readonly (readonly [number, number])[]
  readonly gridBpm: number | null
}

export function inspectRewarp(xml: string): RewarpReport {
  const tally = new Map<number, number>()
  let clips = 0
  for (const match of xml.matchAll(AUDIO_CLIP)) {
    clips += 1
    const bpm = clipWarpBpm(match[0])
    if (bpm !== null) {
      const key = Number(bpm.toFixed(3))
      tally.set(key, (tally.get(key) ?? 0) + 1)
    }
  }
  const byBpm = [...tally.entries()].sort((left, right) => right[1] - left[1])
  const master = /<Tempo>[\s\S]*?<Manual Value="([\d.]+)"/.exec(xml)?.[1]
  return {
    masterBpm: master === undefined ? null : Number(master),
    clips,
    byBpm,
    gridBpm: byBpm[0]?.[0] ?? null,
  }
}

/**
 * Puts the audio clips at `targetBpm`. The whole beat grid scales along,
 * because it was written in the old BPM's scale: touching only the warp would
 * make each clip cover more audio than it should, with the last ones pointing
 * past the end of the wav. `FollowTime` is left out (it is a scene duration,
 * handled by the other tool), and so are MIDI clips (they have no warp).
 */
export function rewarpClips(xml: string, targetBpm: number): ToolOutcome {
  if (!Number.isFinite(targetBpm) || targetBpm <= 0) {
    return { ok: false, error: "invalid BPM" }
  }
  const report = inspectRewarp(xml)
  if (report.gridBpm === null) {
    return { ok: false, error: "no warped audio clips found" }
  }
  if (Math.abs(report.gridBpm - targetBpm) < TOLERANCE) {
    return { ok: true, xml, summary: `already at ${targetBpm} BPM`, changed: 0 }
  }

  const scale = targetBpm / report.gridBpm
  let warpFixed = 0
  let touched = 0

  const output = xml.replace(AUDIO_CLIP, (body) => {
    const bpm = clipWarpBpm(body)
    let next = body
    for (const field of BEAT_FIELDS) {
      next = next.replace(
        new RegExp(`<${field} Value="([-\\d.e]+)"\\s*/>`, "g"),
        (_whole, value: string) =>
          `<${field} Value="${formatBeat(Number(value) * scale)}" />`
      )
    }
    // The warp only scales on clips sitting at the grid BPM: a clip already
    // fixed by hand keeps its warp, but its grid still scales — it is still
    // in the old scale, and that is exactly how the guide and click tracks
    // ended up out of place.
    if (bpm !== null && Math.abs(bpm - report.gridBpm!) < 1e-3) {
      next = next.replace(
        WARP_MARKER,
        (_whole, id: string, sec: string, beat: string) =>
          `<WarpMarker Id="${id}" SecTime="${sec}" BeatTime="${formatBeat(Number(beat) * scale)}" />`
      )
      warpFixed += 1
    }
    touched += 1
    return next
  })

  return {
    ok: true,
    xml: output,
    summary: `${touched} clips rescaled (${report.gridBpm} → ${targetBpm} BPM; warp fixed in ${warpFixed})`,
    changed: touched,
  }
}

// ---------------------------------------------------------------------------
// 3. Mirroring one track's geometry onto another
// ---------------------------------------------------------------------------

/** What defines "where and how long" a clip plays — none of the audio itself. */
type Geometry = {
  readonly fields: ReadonlyMap<string, string>
  readonly warp: readonly { readonly sec: string; readonly beat: string }[]
  readonly followTime: string | null
}

function readGeometry(body: string): Geometry {
  const fields = new Map<string, string>()
  for (const field of BEAT_FIELDS) {
    const value = new RegExp(`<${field} Value="([-\\d.e]+)"`).exec(body)?.[1]
    if (value !== undefined) fields.set(field, value)
  }
  return {
    fields,
    warp: [...body.matchAll(WARP_MARKER)].map((match) => ({
      sec: match[2]!,
      beat: match[3]!,
    })),
    followTime: /<FollowTime Value="([\d.e-]+)"/.exec(body)?.[1] ?? null,
  }
}

function writeGeometry(body: string, geometry: Geometry): string {
  let next = body
  for (const [field, value] of geometry.fields) {
    next = next.replace(
      new RegExp(`<${field} Value="[-\\d.e]+"\\s*/>`),
      `<${field} Value="${value}" />`
    )
  }
  if (geometry.followTime !== null) {
    next = next.replace(
      /<FollowTime Value="[\d.e-]+"\s*\/>/,
      `<FollowTime Value="${geometry.followTime}" />`
    )
  }
  // The base's warp markers replace the target's one by one, in order. SecTime
  // goes along: it is what defines the clip's BPM, together with BeatTime.
  let index = 0
  next = next.replace(WARP_MARKER, (whole, id: string) => {
    const marker = geometry.warp[index]
    index += 1
    return marker === undefined
      ? whole
      : `<WarpMarker Id="${id}" SecTime="${marker.sec}" BeatTime="${marker.beat}" />`
  })
  return next
}

export type MirrorPreview = {
  readonly tracks: readonly string[]
  /** Scenes where both tracks have a clip — the ones that can be mirrored. */
  readonly shared: number
  /** Scenes only on the base or only on the target: left as they are. */
  readonly baseOnly: number
  readonly targetOnly: number
  readonly differing: number
}

export function listTrackNames(xml: string): readonly string[] {
  const names: string[] = []
  for (const clip of collectClips(xml)) {
    if (!names.includes(clip.track)) names.push(clip.track)
  }
  return names
}

function sameGeometry(left: Geometry, right: Geometry): boolean {
  for (const [field, value] of left.fields) {
    if (right.fields.get(field) !== value) return false
  }
  if (left.warp.length !== right.warp.length) return false
  return left.warp.every(
    (marker, index) =>
      marker.sec === right.warp[index]!.sec &&
      marker.beat === right.warp[index]!.beat
  )
}

export function previewMirror(
  xml: string,
  baseTrack: string,
  targetTrack: string
): MirrorPreview {
  const clips = collectClips(xml)
  const base = new Map(
    clips
      .filter((clip) => clip.track === baseTrack)
      .map((clip) => [clip.scene, clip])
  )
  const target = new Map(
    clips
      .filter((clip) => clip.track === targetTrack)
      .map((clip) => [clip.scene, clip])
  )
  let shared = 0
  let differing = 0
  for (const [scene, clip] of target) {
    const reference = base.get(scene)
    if (reference === undefined) continue
    shared += 1
    if (!sameGeometry(readGeometry(reference.body), readGeometry(clip.body))) {
      differing += 1
    }
  }
  return {
    tracks: listTrackNames(xml),
    shared,
    baseOnly: [...base.keys()].filter((scene) => !target.has(scene)).length,
    targetOnly: [...target.keys()].filter((scene) => !base.has(scene)).length,
    differing,
  }
}

/**
 * Copies the base track's geometry onto the target track, scene by scene:
 * loop windows, warp markers and `FollowTime`. Does not touch the `SampleRef`,
 * the name, the color or the pitch — the target keeps playing its own audio,
 * just aligned.
 *
 * A scene where only one of the two has a clip stays as it is: inventing a
 * clip out of thin air is more dangerous than letting the operator see the
 * hole.
 */
export function mirrorTrackGeometry(
  xml: string,
  baseTrack: string,
  targetTrack: string
): ToolOutcome {
  if (baseTrack === targetTrack) {
    return { ok: false, error: "base and target track are the same" }
  }
  const clips = collectClips(xml)
  const base = new Map(
    clips
      .filter((clip) => clip.track === baseTrack)
      .map((clip) => [clip.scene, clip])
  )
  const target = clips.filter((clip) => clip.track === targetTrack)
  if (base.size === 0)
    return { ok: false, error: `track "${baseTrack}" has no clips` }
  if (target.length === 0)
    return { ok: false, error: `track "${targetTrack}" has no clips` }

  const edits: { start: number; end: number; text: string }[] = []
  for (const clip of target) {
    const reference = base.get(clip.scene)
    if (reference === undefined) continue
    const geometry = readGeometry(reference.body)
    const next = writeGeometry(clip.body, geometry)
    if (next !== clip.body) {
      edits.push({ start: clip.start, end: clip.end, text: next })
    }
  }

  return {
    ok: true,
    xml: applyEdits(xml, edits),
    summary: `${edits.length} clips of "${targetTrack}" aligned to "${baseTrack}"`,
    changed: edits.length,
  }
}

// ---------------------------------------------------------------------------
// 4. Follow Action: enable, mark Unlinked, and match the time to the scene
// ---------------------------------------------------------------------------

export type FollowReport = {
  readonly clips: number
  readonly scenesWithDuration: number
  readonly needEnable: number
  readonly needUnlink: number
  readonly needRetime: number
  /** Scenes whose clips disagree on duration: they block the fix. */
  readonly conflicting: readonly number[]
  /** Looping clips on a scene without audio (the click bookends). */
  readonly loopOnlyScenes: number
}

function sceneDurations(clips: readonly ClipRef[]) {
  const perScene = new Map<number, Set<number>>()
  for (const clip of clips) {
    if (/<LoopOn Value="true"/.test(clip.body)) continue
    const loopStart = Number(
      /<LoopStart Value="([-\d.e]+)"/.exec(clip.body)?.[1]
    )
    const loopEnd = Number(/<LoopEnd Value="([-\d.e]+)"/.exec(clip.body)?.[1])
    const duration = loopEnd - loopStart
    if (!Number.isFinite(duration)) continue
    const set = perScene.get(clip.scene) ?? new Set<number>()
    set.add(Number(duration.toFixed(6)))
    perScene.set(clip.scene, set)
  }
  return perScene
}

export function inspectFollowActions(xml: string): FollowReport {
  const clips = collectClips(xml)
  const perScene = sceneDurations(clips)
  const conflicting = [...perScene.entries()]
    .filter(([, set]) => set.size > 1)
    .map(([scene]) => scene)
  const duration = new Map(
    [...perScene.entries()]
      .filter(([, set]) => set.size === 1)
      .map(([scene, set]) => [scene, [...set][0]])
  )

  let needEnable = 0
  let needUnlink = 0
  let needRetime = 0
  let loopOnly = 0
  for (const clip of clips) {
    const wanted = duration.get(clip.scene)
    if (wanted === undefined) {
      loopOnly += 1
      continue
    }
    if (/<FollowActionEnabled Value="false"/.test(clip.body)) needEnable += 1
    if (/<IsLinked Value="true"/.test(clip.body)) needUnlink += 1
    const current = Number(/<FollowTime Value="([\d.]+)"/.exec(clip.body)?.[1])
    if (!Number.isFinite(current) || Math.abs(current - wanted) > TOLERANCE) {
      needRetime += 1
    }
  }

  return {
    clips: clips.length,
    scenesWithDuration: duration.size,
    needEnable,
    needUnlink,
    needRetime,
    conflicting,
    loopOnlyScenes: loopOnly,
  }
}

export function syncFollowActions(xml: string): ToolOutcome {
  const clips = collectClips(xml)
  const perScene = sceneDurations(clips)
  const conflicting = [...perScene.entries()].filter(([, set]) => set.size > 1)
  if (conflicting.length > 0) {
    return {
      ok: false,
      error: `${conflicting.length} scene(s) have clips with different durations (${conflicting
        .slice(0, 3)
        .map(([scene]) => scene)
        .join(
          ", "
        )}…) — without a single duration per row there is no way to tell when the Follow Action should fire`,
    }
  }
  const duration = new Map(
    [...perScene.entries()].map(([scene, set]) => [scene, [...set][0]])
  )

  const edits: { start: number; end: number; text: string }[] = []
  for (const clip of clips) {
    const wanted = duration.get(clip.scene)
    // A scene without an audio clip is a click bookend: it keeps looping until
    // the operator fires the next row, so it gets no Follow Action.
    if (wanted === undefined) continue

    let next = clip.body
      .replace(
        /<FollowActionEnabled Value="false"\s*\/>/,
        '<FollowActionEnabled Value="true" />'
      )
      .replace(/<IsLinked Value="true"\s*\/>/, '<IsLinked Value="false" />')
    const current = Number(/<FollowTime Value="([\d.]+)"/.exec(next)?.[1])
    if (!Number.isFinite(current) || Math.abs(current - wanted) > TOLERANCE) {
      next = next.replace(
        /<FollowTime Value="[\d.e-]+"\s*\/>/,
        `<FollowTime Value="${formatBeat(wanted)}" />`
      )
    }
    if (next !== clip.body) {
      edits.push({ start: clip.start, end: clip.end, text: next })
    }
  }

  return {
    ok: true,
    xml: applyEdits(xml, edits),
    summary: `${edits.length} clips synced across ${duration.size} scenes`,
    changed: edits.length,
  }
}
