// ---------------------------------------------------------------------------
// Parser for the XML of an `.als` file (already decompressed) — pure layer,
// no I/O.
//
// String surgery, never DOM: the file has millions of nodes and reserializing
// would destroy whatever was not touched. The format traps are documented in
// this repo's CLAUDE.md; the main ones here:
//
//   - `<ClipSlot>` carries an INNER `<ClipSlot>` without an Id → only the
//     outer ones match `<ClipSlot Id="N">`.
//   - Every track has TWO `<ClipSlotList>`s (session and freeze). Tell them
//     apart by the closest opening wrapper (`MainSequencer` vs
//     `FreezeSequencer`), never by the slot Id.
//   - Scene ↔ ClipSlot is POSITIONAL: the Nth slot belongs to the Nth scene.
//   - All text comes XML-escaped.
// ---------------------------------------------------------------------------

export type SceneSchemaVersion = "v10" | "v12"

export type AlsHeader = {
  readonly majorVersion: string
  readonly minorVersion: string
  readonly schemaChangeCount: string | null
  readonly creator: string
}

export type AlsScene = {
  readonly id: string
  /** Verbatim name (already unescaped). Empty string = blank scene. */
  readonly rawName: string
  readonly colorIndex: number | null
  /** v12 only: structured tempo/time signature. In v10 they live in the NAME. */
  readonly tempo: number | null
  readonly tempoEnabled: boolean | null
  readonly timeSignatureId: number | null
}

export type AlsTimeSignature = {
  readonly num: number
  readonly den: number
}

export type AlsSampleRef = {
  readonly fileName: string | null
  /** Dirs from the `<RelativePath>` (relative to the project root). */
  readonly relativeDirs: readonly string[]
  readonly frames: number | null
  readonly sampleRate: number | null
}

export type AlsClip = {
  readonly kind: "audio" | "midi"
  /** The clip's label, verbatim. */
  readonly rawName: string | null
  readonly loopStart: number | null
  readonly loopEnd: number | null
  readonly loopOn: boolean | null
  readonly isWarped: boolean | null
  readonly timeSignature: AlsTimeSignature | null
  readonly followTime: number | null
  readonly followActionA: number | null
  /** Clip transposition in SEMITONES (this is how Live transposes audio). */
  readonly pitchCoarse: number | null
  /** Fine tuning in cents — the archive does not use it, but the field exists. */
  readonly pitchFine: number | null
  /** SecTime of the first warp marker: where this clip's epoch is anchored. */
  readonly warpAnchorSeconds: number | null
  /** BPM derived from the slope of the first two markers. */
  readonly warpBpm: number | null
  readonly warpMarkerCount: number
  readonly sample: AlsSampleRef | null
}

export type AlsTrack = {
  readonly type: "AudioTrack" | "MidiTrack" | "ReturnTrack" | "GroupTrack"
  readonly id: string
  readonly name: string
  readonly colorIndex: number | null
  readonly audioOutTarget: string | null
  /**
   * Session clips by scene POSITION (`null` = empty slot). The length is the
   * number of outer slots in the list — which must match the number of scenes.
   */
  readonly sessionClips: readonly (AlsClip | null)[]
}

export type AlsDocument = {
  readonly header: AlsHeader | null
  readonly sceneSchema: SceneSchemaVersion
  readonly scenes: readonly AlsScene[]
  readonly tracks: readonly AlsTrack[]
  readonly masterTempo: number | null
  readonly masterTimeSignatureId: number | null
  readonly nextPointeeId: number | null
}

// --- reading helpers --------------------------------------------------------

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
}

export function unescapeXml(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos|#\d+);/g, (entity) => {
    if (entity.startsWith("&#")) {
      return String.fromCodePoint(Number(entity.slice(2, -1)))
    }
    return XML_ENTITIES[entity] ?? entity
  })
}

function readString(segment: string, tag: string): string | null {
  const match = new RegExp(`<${tag} Value="([^"]*)"`).exec(segment)
  return match ? unescapeXml(match[1]!) : null
}

function readNumber(segment: string, tag: string): number | null {
  const raw = readString(segment, tag)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function readBoolean(segment: string, tag: string): boolean | null {
  const raw = readString(segment, tag)
  return raw === null ? null : raw === "true"
}

/** Content between `<tag>` and `</tag>` starting at `from` (null when absent). */
function readBlock(
  segment: string,
  tag: string,
  from = 0
): {
  readonly body: string
  readonly start: number
  readonly end: number
} | null {
  const openIndex = segment.indexOf(`<${tag}>`, from)
  if (openIndex === -1) return null
  const bodyStart = openIndex + tag.length + 2
  const closeIndex = segment.indexOf(`</${tag}>`, bodyStart)
  if (closeIndex === -1) return null
  return {
    body: segment.slice(bodyStart, closeIndex),
    start: openIndex,
    end: closeIndex + tag.length + 3,
  }
}

// --- header, tempo and the Id allocator -------------------------------------

const HEADER_RE =
  /<Ableton MajorVersion="([^"]*)" MinorVersion="([^"]*)"(?: SchemaChangeCount="([^"]*)")? Creator="([^"]*)"/

export function parseHeader(xml: string): AlsHeader | null {
  const match = HEADER_RE.exec(xml.slice(0, 800))
  if (!match) return null
  return {
    majorVersion: match[1]!,
    minorVersion: match[2]!,
    schemaChangeCount: match[3] ?? null,
    creator: unescapeXml(match[4]!),
  }
}

// ---------------------------------------------------------------------------
// Scenes
//
// v10 stores the name in the tag's ATTRIBUTE; v11+ in a `<Name>` child.
// Document order is what matters (positional mapping against the ClipSlots).
// ---------------------------------------------------------------------------

const SCENE_OPEN_RE = /<Scene Id="(\d+)"([^>]*)>/g

export function parseScenes(xml: string): {
  readonly schema: SceneSchemaVersion
  readonly scenes: readonly AlsScene[]
} {
  const opens: Array<{
    id: string
    attrs: string
    end: number
    start: number
  }> = []
  SCENE_OPEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SCENE_OPEN_RE.exec(xml)) !== null) {
    opens.push({
      id: match[1]!,
      attrs: match[2]!,
      start: match.index,
      end: SCENE_OPEN_RE.lastIndex,
    })
  }

  const withValueAttr = opens.filter((scene) =>
    /\bValue="/.test(scene.attrs)
  ).length
  const schema: SceneSchemaVersion =
    withValueAttr > opens.length / 2 ? "v10" : "v12"

  const scenes = opens.map((scene, index) => {
    // The LAST scene runs to the end of the document — using `scene.end` here
    // would leave the body empty and it would lose tempo/color/time signature
    // under the v12 schema.
    const bodyEnd =
      index + 1 < opens.length ? opens[index + 1]!.start : xml.length
    const body = xml.slice(scene.end, Math.min(bodyEnd, scene.end + 3000))

    if (schema === "v10") {
      const valueMatch = /\bValue="([^"]*)"/.exec(scene.attrs)
      return {
        id: scene.id,
        rawName: valueMatch ? unescapeXml(valueMatch[1]!) : "",
        colorIndex: readNumber(body, "ColorIndex"),
        tempo: null,
        tempoEnabled: null,
        timeSignatureId: null,
      }
    }

    return {
      id: scene.id,
      rawName: readString(body, "Name") ?? "",
      colorIndex: readNumber(body, "Color"),
      tempo: readNumber(body, "Tempo"),
      tempoEnabled: readBoolean(body, "IsTempoEnabled"),
      timeSignatureId: readNumber(body, "TimeSignatureId"),
    }
  })

  return { schema, scenes }
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

const WARP_MARKER_RE =
  /<WarpMarker Id="[^"]*" SecTime="([^"]*)" BeatTime="([^"]*)"/g

function parseWarp(segment: string): {
  readonly anchorSeconds: number | null
  readonly bpm: number | null
  readonly count: number
} {
  const markers: Array<{ sec: number; beat: number }> = []
  WARP_MARKER_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = WARP_MARKER_RE.exec(segment)) !== null) {
    markers.push({ sec: Number(match[1]), beat: Number(match[2]) })
  }
  if (markers.length < 2) {
    return {
      anchorSeconds: markers[0]?.sec ?? null,
      bpm: null,
      count: markers.length,
    }
  }
  const [first, second] = markers
  const deltaSeconds = second!.sec - first!.sec
  const deltaBeats = second!.beat - first!.beat
  const bpm =
    deltaSeconds > 0
      ? Math.round((deltaBeats / deltaSeconds) * 60 * 1000) / 1000
      : null
  return { anchorSeconds: first!.sec, bpm, count: markers.length }
}

function parseSampleRef(clipSegment: string): AlsSampleRef | null {
  const sampleRef = readBlock(clipSegment, "SampleRef")
  if (!sampleRef) return null

  const relativePath = readBlock(sampleRef.body, "RelativePath")
  const relativeDirs: string[] = []
  if (relativePath) {
    const dirRe = /<RelativePathElement[^>]*\sDir="([^"]*)"/g
    let dirMatch: RegExpExecArray | null
    while ((dirMatch = dirRe.exec(relativePath.body)) !== null) {
      relativeDirs.push(unescapeXml(dirMatch[1]!))
    }
  }

  // The file's `<Name>` comes AFTER `</RelativePath>`; before it there are
  // only the dirs. (The clip's label is a different `<Name>`, outside the
  // SampleRef.)
  const afterPath = relativePath
    ? sampleRef.body.slice(relativePath.end)
    : sampleRef.body

  return {
    fileName: readString(afterPath, "Name"),
    relativeDirs,
    frames: readNumber(sampleRef.body, "DefaultDuration"),
    sampleRate: readNumber(sampleRef.body, "DefaultSampleRate"),
  }
}

function parseClip(segment: string, kind: "audio" | "midi"): AlsClip {
  const loop = readBlock(segment, "Loop")
  const loopBody = loop?.body ?? ""

  const timeSignatureBlock = readBlock(segment, "TimeSignature")
  const num = timeSignatureBlock
    ? readNumber(timeSignatureBlock.body, "Numerator")
    : null
  const den = timeSignatureBlock
    ? readNumber(timeSignatureBlock.body, "Denominator")
    : null

  const warp = parseWarp(segment)

  return {
    kind,
    rawName: readString(segment, "Name"),
    loopStart: readNumber(loopBody, "LoopStart"),
    loopEnd: readNumber(loopBody, "LoopEnd"),
    loopOn: readBoolean(loopBody, "LoopOn"),
    isWarped: readBoolean(segment, "IsWarped"),
    timeSignature: num !== null && den !== null ? { num, den } : null,
    followTime: readNumber(segment, "FollowTime"),
    followActionA: readNumber(segment, "FollowActionA"),
    pitchCoarse: readNumber(segment, "PitchCoarse"),
    pitchFine: readNumber(segment, "PitchFine"),
    warpAnchorSeconds: warp.anchorSeconds,
    warpBpm: warp.bpm,
    warpMarkerCount: warp.count,
    sample: kind === "audio" ? parseSampleRef(segment) : null,
  }
}

// ---------------------------------------------------------------------------
// Tracks and the slot grid
// ---------------------------------------------------------------------------

const TRACK_OPEN_RE =
  /<(AudioTrack|MidiTrack|ReturnTrack|GroupTrack) Id="(\d+)"/g
const CLIP_SLOT_RE = /<ClipSlot Id="(-?\d+)">/g

/** The (positional) slots of an already isolated `<ClipSlotList>`. */
function parseSlots(listBody: string): ReadonlyArray<AlsClip | null> {
  const starts: number[] = []
  CLIP_SLOT_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CLIP_SLOT_RE.exec(listBody)) !== null) {
    starts.push(match.index)
  }

  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1]! : listBody.length
    const slot = listBody.slice(start, end)
    const audioIndex = slot.indexOf("<AudioClip ")
    if (audioIndex !== -1) return parseClip(slot.slice(audioIndex), "audio")
    const midiIndex = slot.indexOf("<MidiClip ")
    if (midiIndex !== -1) return parseClip(slot.slice(midiIndex), "midi")
    return null
  })
}

export function parseTracks(xml: string): readonly AlsTrack[] {
  const opens: Array<{ type: string; id: string; start: number }> = []
  TRACK_OPEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TRACK_OPEN_RE.exec(xml)) !== null) {
    opens.push({ type: match[1]!, id: match[2]!, start: match.index })
  }

  const masterIndex = xml.indexOf("<MasterTrack")
  const boundary = masterIndex === -1 ? xml.length : masterIndex

  return opens.map((track, index) => {
    const end =
      index + 1 < opens.length
        ? opens[index + 1]!.start
        : Math.max(boundary, track.start)
    const segment = xml.slice(track.start, end)

    const nameMatch = /<Name>\s*<EffectiveName Value="([^"]*)"/.exec(segment)
    const colorMatch =
      /<ColorIndex Value="(-?\d+)"/.exec(segment) ??
      /<Color Value="(-?\d+)"/.exec(segment)
    const routingMatch = /<AudioOutputRouting>\s*<Target Value="([^"]*)"/.exec(
      segment
    )

    // Of the track's ClipSlotLists, the SESSION one is the one whose closest
    // opening wrapper is `<MainSequencer`, not `<FreezeSequencer` (the Id can
    // never tell them apart).
    let sessionClips: ReadonlyArray<AlsClip | null> = []
    let cursor = 0
    while (true) {
      const list = readBlock(segment, "ClipSlotList", cursor)
      if (!list) break
      cursor = list.end
      const absolute = track.start + list.start
      const main = xml.lastIndexOf("<MainSequencer", absolute)
      const freeze = xml.lastIndexOf("<FreezeSequencer", absolute)
      if (main > freeze) {
        sessionClips = parseSlots(list.body)
        break
      }
    }

    return {
      type: track.type as AlsTrack["type"],
      id: track.id,
      name: nameMatch ? unescapeXml(nameMatch[1]!) : "",
      colorIndex: colorMatch ? Number(colorMatch[1]) : null,
      audioOutTarget: routingMatch ? unescapeXml(routingMatch[1]!) : null,
      sessionClips,
    }
  })
}

/**
 * The master's tempo and time signature. Positional: the first `<Manual>`
 * inside `<Tempo>` is the BPM; the first one after the closing tag is the
 * TimeSignatureId.
 *
 * ⚠️ `masterTempo` is the LAST tempo saved, NOT the song's BPM (one song in
 * the archive was saved at 300). Diagnostic information only.
 */
export function parseMasterTempo(xml: string): {
  readonly tempo: number | null
  readonly timeSignatureId: number | null
} {
  const tempoBlock = readBlock(xml, "Tempo")
  if (!tempoBlock) return { tempo: null, timeSignatureId: null }
  const tempo = readNumber(tempoBlock.body, "Manual")
  const after = xml.slice(tempoBlock.end, tempoBlock.end + 4000)
  return { tempo, timeSignatureId: readNumber(after, "Manual") }
}

export function parseAlsDocument(xml: string): AlsDocument {
  const { schema, scenes } = parseScenes(xml)
  const master = parseMasterTempo(xml)
  return {
    header: parseHeader(xml),
    sceneSchema: schema,
    scenes,
    tracks: parseTracks(xml),
    masterTempo: master.tempo,
    masterTimeSignatureId: master.timeSignatureId,
    nextPointeeId: readNumber(xml, "NextPointeeId"),
  }
}

/**
 * Time signature from the Live 11+ `TimeSignatureId`.
 * Encoding validated against the archive: `id = 99·log2(den) + (num − 1)`.
 */
export function decodeTimeSignatureId(id: number): AlsTimeSignature | null {
  if (!Number.isInteger(id) || id < 0) return null
  const num = (id % 99) + 1
  const den = Math.pow(2, Math.floor(id / 99))
  return { num, den }
}

/** The invariant Live crashes without: every list has one slot per scene. */
export function gridIsConsistent(document: AlsDocument): boolean {
  const sceneCount = document.scenes.length
  return document.tracks.every(
    (track) =>
      track.sessionClips.length === 0 ||
      track.sessionClips.length === sceneCount
  )
}

// ---------------------------------------------------------------------------
// The v10 scene-name tempo tokens
// ---------------------------------------------------------------------------

const BPM_RE = /(\d+(?:[.,]\d+)?)\s*BPM/i
const TIME_SIG_RE = /\b(\d{1,2})\/(\d{1,2})\b/

/** Collapses whitespace — for MATCHING only; never a replacement for the raw name. */
function collapseWhitespace(text: string): string {
  return text.split(/\s+/).join(" ").trim()
}

export type SceneTempo = {
  readonly bpm: number | null
  readonly timeSignatureLabel: string | null
}

/**
 * Reads the tempo and time-signature tokens from a v10 scene name.
 *
 * In Live 10 the scene NAME TEXT is what programs both — there are no
 * structured fields. `v10SceneName` in the downgrade porter WRITES these
 * tokens back when converting from v12; this is the matching reader, and the
 * pair is what lets a fidelity check prove a conversion is semantically
 * equivalent even when the text cannot be reproduced byte for byte.
 */
export function readSceneTempo(rawName: string): SceneTempo {
  const normalized = collapseWhitespace(rawName)
  const bpmMatch = BPM_RE.exec(normalized)
  const bpm = bpmMatch ? Number(bpmMatch[1]!.replace(",", ".")) : null
  const timeSigMatch = TIME_SIG_RE.exec(normalized)
  return {
    bpm: bpm !== null && Number.isFinite(bpm) ? bpm : null,
    timeSignatureLabel: timeSigMatch ? timeSigMatch[0] : null,
  }
}
