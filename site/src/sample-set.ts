// The demo's sample set, and the damaged variant made from it.
//
// The sample itself is not generated here. It is `site/sample/Demo Set.als`,
// a set SAVED BY LIVE 12.4.3 (see `site/sample/README.md` for how it was
// authored), so that what the page makes from it opens in Live.
//
// What this file does make is the damaged variant: the same document with
// structural damage planted in it, so the Validate view has something to
// show. Live refuses a set like that, which is why the page never offers a
// file made from the damaged one.

import {
  applyEdits,
  describeClipSlotLists,
  type Edit,
} from "../../src/index.js"

export const SAMPLE_FILE_NAME = "Demo Set.als"
export const DAMAGED_FILE_NAME = "Damaged Set.als"

/** Where the sample's audio lives, as the set states it. */
export const SAMPLE_LIBRARY_ROOT = "/Volumes/Demo SSD/Library"

/** The two tracks whose clip geometry differs in the sample. */
export const SAMPLE_MIRROR_BASE = "DRUMS"
export const SAMPLE_MIRROR_TARGET = "GUITAR"

type Track = { readonly name: string; readonly start: number; readonly end: number }

function tracksOf(xml: string): readonly Track[] {
  const opens = [
    ...xml.matchAll(/<(?:AudioTrack|MidiTrack|ReturnTrack|GroupTrack) Id="\d+"/g),
  ].map((match) => match.index)
  return opens.map((start, index) => {
    const end = opens[index + 1] ?? xml.length
    const name =
      /<EffectiveName Value="([^"]*)"/.exec(xml.slice(start, end))?.[1] ?? ""
    return { name, start, end }
  })
}

function trackNamed(xml: string, name: string): Track {
  const track = tracksOf(xml).find((candidate) => candidate.name === name)
  if (!track) throw new Error(`the sample has no track named ${name}`)
  return track
}

/** The first match of `pattern` at or after `from`, as an edit target. */
function locate(
  xml: string,
  pattern: RegExp,
  from: number,
  until: number
): { readonly start: number; readonly end: number; readonly text: string } {
  const match = pattern.exec(xml.slice(from, until))
  if (!match) throw new Error(`the sample no longer has ${pattern.source}`)
  return {
    start: from + match.index,
    end: from + match.index + match[0].length,
    text: match[0],
  }
}

/**
 * The sample with six kinds of damage planted, one edit each:
 *
 * - grid: BASS loses its last clip slot, so it has 11 slots for 12 scenes.
 * - ids: three automation targets on PAD take the Ids of three on KEYS.
 * - ids: `NextPointeeId` drops below the highest Id in use.
 * - ids: an automation envelope points at a target that does not exist.
 * - routing: DRUMS sends its output into a track that does not exist.
 * - xml: DRUMS carries `NeedArrangerRefreeze` twice.
 */
export function buildDamagedSampleSet(healthy: string): string {
  const edits: Edit[] = []

  const bass = describeClipSlotLists(healthy).find(
    (list) => list.isSession && list.trackName === "BASS"
  )
  const lastSlot = bass?.slots[bass.slots.length - 1]
  if (!lastSlot) throw new Error("the sample has no BASS session list")
  edits.push({ start: lastSlot.start, end: lastSlot.end, replacement: "" })

  const keys = trackNamed(healthy, "KEYS")
  const pad = trackNamed(healthy, "PAD")
  const target = /<AutomationTarget Id="(\d+)">/g
  const keysIds = [...healthy.slice(keys.start, keys.end).matchAll(target)]
    .slice(0, 3)
    .map((match) => match[1]!)
  const padTargets = [...healthy.slice(pad.start, pad.end).matchAll(target)].slice(
    0,
    3
  )
  if (keysIds.length < 3 || padTargets.length < 3) {
    throw new Error("the sample has too few automation targets")
  }
  padTargets.forEach((match, index) => {
    edits.push({
      start: pad.start + match.index,
      end: pad.start + match.index + match[0].length,
      replacement: `<AutomationTarget Id="${keysIds[index]}">`,
    })
  })

  const allocator = locate(healthy, /<NextPointeeId Value="\d+" \/>/, 0, healthy.length)
  edits.push({ ...allocator, replacement: '<NextPointeeId Value="900" />' })

  const pointee = locate(healthy, /<PointeeId Value="\d+" \/>/, 0, healthy.length)
  edits.push({ ...pointee, replacement: '<PointeeId Value="4242" />' })

  const drums = trackNamed(healthy, "DRUMS")
  const routing = locate(
    healthy,
    /<AudioOutputRouting>\s*<Target Value="[^"]*" \/>/,
    drums.start,
    drums.end
  )
  edits.push({
    ...routing,
    replacement: routing.text.replace(
      /<Target Value="[^"]*" \/>/,
      '<Target Value="AudioOut/Track.99/TrackIn" />'
    ),
  })

  const freeze = locate(healthy, /<Freeze Value="(?:true|false)" \/>/, drums.start, drums.end)
  edits.push({
    ...freeze,
    replacement: `${freeze.text}<NeedArrangerRefreeze Value="true" /><NeedArrangerRefreeze Value="true" />`,
  })

  return applyEdits(
    healthy,
    [...edits].sort((a, b) => a.start - b.start)
  )
}
