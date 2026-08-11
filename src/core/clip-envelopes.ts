// ---------------------------------------------------------------------------
// Automation INSIDE the clip (ClipEnvelope) and its transplant between
// documents.
//
// A clip can carry envelopes — the dominant case in the archive is the volume
// fade drawn on the clip (58 songs, target `VolumeModulationTarget` of the
// track's own MainSequencer). The envelope points at its target through
// `<PointeeId>`: transplanting the clip into another document without
// translating the Id leaves an orphan reference — and Live 10 CRASHES
// resolving it at load (discovered on a real song in the archive).
//
// The translation is semantic: the target is equivalent to the SAME element
// (same tag path) in the DESTINATION track. A target with no equivalent (a
// device parameter, which does not travel in the transplant) → the whole
// envelope goes, with a WARNING — never a guess.
// ---------------------------------------------------------------------------

import { applyEdits, type Edit } from "./surgery.js"

const TRACK_OPEN = /<(?:AudioTrack|MidiTrack|ReturnTrack|GroupTrack) Id="\d+"/g
const ELEMENT = /<(\/?)([A-Za-z_][\w.-]*)((?:\s+[\w.:-]+="[^"]*")*)\s*(\/?)>/g
const TARGET_TAG = /(?:Automation|Modulation)Target$/

/** The slice of the document that belongs to the track at `trackIndex`. */
export function trackSegment(xml: string, trackIndex: number): string | null {
  const starts: number[] = []
  TRACK_OPEN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TRACK_OPEN.exec(xml)) !== null) {
    starts.push(match.index)
  }
  const start = starts[trackIndex]
  if (start === undefined) return null
  const end = starts[trackIndex + 1] ?? xml.length
  return xml.slice(start, end)
}

/**
 * A target's "role" is the tag path from the track down to it (outside
 * `<Devices>`): `DeviceChain/MainSequencer/VolumeModulationTarget`. A role
 * that repeats within the same track is ambiguous and leaves the map.
 */
function walkTargets(
  trackXml: string,
  visit: (role: string | null, id: number, start: number, end: number) => void
): void {
  const stack: string[] = []
  let opened = false

  ELEMENT.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ELEMENT.exec(trackXml)) !== null) {
    const [text, close, tag, attributes, self] = match
    if (close) {
      stack.pop()
      if (opened && stack.length === 0) return
      continue
    }
    if (!self && !opened) {
      // the first open is the track itself — the path starts AFTER it
      opened = true
      stack.push(tag!)
      continue
    }
    if (TARGET_TAG.test(tag!)) {
      const id = /Id="(\d+)"/.exec(attributes!)
      if (id) {
        const inDevices = stack.includes("Devices")
        const role = inDevices ? null : [...stack.slice(1), tag].join("/")
        visit(role, Number(id[1]), match.index, match.index + text!.length)
      }
    }
    if (!self) stack.push(tag!)
  }
}

/** Target Id → role, in the SOURCE track. Duplicated roles are discarded. */
export function collectPointeeRoles(
  trackXml: string
): ReadonlyMap<number, string> {
  const roles = new Map<number, string>()
  const seen = new Map<string, number>()
  walkTargets(trackXml, (role, id) => {
    if (role === null) return
    const count = (seen.get(role) ?? 0) + 1
    seen.set(role, count)
    roles.set(id, role)
  })
  for (const [id, role] of [...roles]) {
    if ((seen.get(role) ?? 0) > 1) roles.delete(id)
  }
  return roles
}

/** Role → target Id, in the DESTINATION track. Duplicated roles are discarded. */
export function collectRoleIds(trackXml: string): ReadonlyMap<string, number> {
  const ids = new Map<string, number>()
  const duplicated = new Set<string>()
  walkTargets(trackXml, (role, id) => {
    if (role === null) return
    if (ids.has(role)) duplicated.add(role)
    else ids.set(role, id)
  })
  for (const role of duplicated) ids.delete(role)
  return ids
}

const CLIP_ENVELOPE = /<ClipEnvelope[\s>][\s\S]*?<\/ClipEnvelope>/g
const POINTEE = /<PointeeId Value="(\d+)" \/>/

export type RemapResult = {
  readonly xml: string
  /** Roles (or Ids) of the dropped envelopes — they become warnings at assembly time. */
  readonly dropped: readonly string[]
}

/**
 * Translates the slot's ClipEnvelope `PointeeId`s to the destination
 * document. No equivalent → the whole envelope goes (and the caller warns).
 */
export function remapClipEnvelopes(
  slotXml: string,
  sourceRoles: ReadonlyMap<number, string>,
  destinationIds: ReadonlyMap<string, number>
): RemapResult {
  const edits: Edit[] = []
  const dropped: string[] = []

  CLIP_ENVELOPE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CLIP_ENVELOPE.exec(slotXml)) !== null) {
    const envelope = match[0]
    const pointee = POINTEE.exec(envelope)
    const role = pointee ? sourceRoles.get(Number(pointee[1])) : undefined
    const destination = role ? destinationIds.get(role) : undefined

    if (pointee && destination !== undefined) {
      const offset = match.index + pointee.index
      edits.push({
        start: offset,
        end: offset + pointee[0].length,
        replacement: `<PointeeId Value="${destination}" />`,
      })
      continue
    }

    // no translation: the whole envelope goes, leading whitespace included
    let start = match.index
    while (start > 0 && /\s/.test(slotXml[start - 1] ?? "")) start -= 1
    edits.push({ start, end: match.index + envelope.length, replacement: "" })
    dropped.push(role ?? `target ${pointee?.[1] ?? "?"}`)
  }

  if (edits.length === 0) return { xml: slotXml, dropped }
  // an inner list left empty comes out self-closed, as Live writes it
  const xml = applyEdits(slotXml, edits).replace(
    /<Envelopes>\s*<\/Envelopes>/g,
    "<Envelopes />"
  )
  return { xml, dropped }
}
