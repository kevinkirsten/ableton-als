// Arranges the demo's sample set out of a small set SAVED BY LIVE 12.
//
// The sample has to be a document Live itself wrote, so that what the page
// produces from it opens in Live. This script is the middle of a three-step
// recipe, and it writes nothing Live does not already know how to read:
//
//   1. In Live 12: a new set, nine tracks, twelve scenes, one clip per audio
//      file, two empty MIDI clips. Save. That file is this script's input.
//   2. This script: names the tracks and scenes, programs scene tempo and
//      time signature, and CLONES the clips Live wrote into other scenes. It
//      invents no element: every clip in the output is a copy of one Live
//      authored, with a handful of its values changed.
//   3. In Live 12 again: open the result and save it. The file the demo ships
//      is that save, written by Live from top to bottom.
//
// Run: npx tsx site/sample/arrange.ts <base.als> <arranged.als>

import { readFileSync, writeFileSync } from "node:fs"
import {
  applyEdits,
  decodeAls,
  describeClipSlotLists,
  encodeAls,
  escapeXml,
  findSceneRanges,
  parseAlsDocument,
  rewarpClips,
  validateGeneratedSet,
  type Edit,
} from "../../src/node.js"

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  throw new Error("usage: arrange.ts <base.als> <arranged.als>")
}

const base = decodeAls(readFileSync(input))
const edits: Edit[] = []

// --- tracks ----------------------------------------------------------------

/** Track order as Live saved it, and the name each one gets. */
const TRACKS = [
  { name: "SYNTH", color: 66 },
  { name: "BELLS", color: null },
  { name: "DRUMS", color: null },
  { name: "BASS", color: null },
  { name: "KEYS", color: null },
  { name: "PAD", color: null },
  { name: "GUITAR", color: null },
  { name: "LEAD VOX", color: 68 },
  { name: "CLICK", color: 13 },
] as const

const trackOpens = [
  ...base.matchAll(/<(?:AudioTrack|MidiTrack) Id="\d+"/g),
].map((match) => match.index)

TRACKS.forEach((track, index) => {
  const start = trackOpens[index]
  if (start === undefined) throw new Error(`track ${index} not found`)
  const head = base.slice(start, start + 4000)
  const effective = /<EffectiveName Value="[^"]*" \/>/.exec(head)
  const user = /<UserName Value="[^"]*" \/>/.exec(head)
  const color = /<Color Value="-?\d+" \/>/.exec(head)
  if (!effective || !user || !color) throw new Error(`track ${index} head`)
  edits.push({
    start: start + effective.index,
    end: start + effective.index + effective[0].length,
    replacement: `<EffectiveName Value="${track.name}" />`,
  })
  edits.push({
    start: start + user.index,
    end: start + user.index + user[0].length,
    replacement: `<UserName Value="${track.name}" />`,
  })
  if (track.color !== null) {
    edits.push({
      start: start + color.index,
      end: start + color.index + color[0].length,
      replacement: `<Color Value="${track.color}" />`,
    })
  }
})

// --- scenes ----------------------------------------------------------------

type SceneSpec = {
  readonly name: string
  readonly color: number
  readonly tempo?: number
  /** `TimeSignatureId`: 201 is 4/4, 200 is 3/4, 302 is 6/8. */
  readonly signature?: number
}

const SCENES: readonly SceneSpec[] = [
  { name: "COUNT IN", color: -1, tempo: 120, signature: 201 },
  { name: "INTRO", color: 8 },
  { name: "VERSE 1", color: 14 },
  { name: "PRE CHORUS", color: -1 },
  { name: "CHORUS", color: 38 },
  { name: "VERSE 2 & BUILD", color: 14 },
  { name: "CHORUS 2", color: 38 },
  { name: "BRIDGE", color: 50, tempo: 90, signature: 302 },
  { name: 'INTERLUDE "B"', color: -1, tempo: 120, signature: 201 },
  { name: "BREAKDOWN", color: 64, signature: 200 },
  { name: "LAST CHORUS", color: 38, signature: 201 },
  { name: "OUTRO", color: -1, tempo: 96.5 },
]

function setValue(block: string, tag: string, value: string | number): string {
  const pattern = new RegExp(`<${tag} Value="[^"]*" />`)
  if (!pattern.test(block)) throw new Error(`no <${tag}> to set`)
  return block.replace(pattern, `<${tag} Value="${value}" />`)
}

const sceneRanges = findSceneRanges(base)
if (sceneRanges.length !== SCENES.length) {
  throw new Error(`expected ${SCENES.length} scenes, found ${sceneRanges.length}`)
}
SCENES.forEach((scene, index) => {
  const range = sceneRanges[index]!
  let block = base.slice(range.start, range.end)
  // The scene's own <Name> comes after its <FollowAction> block.
  block = setValue(block, "Name", escapeXml(scene.name))
  block = setValue(block, "Color", scene.color)
  block = setValue(block, "Tempo", scene.tempo ?? 120)
  block = setValue(block, "IsTempoEnabled", String(scene.tempo !== undefined))
  block = setValue(block, "TimeSignatureId", scene.signature ?? 201)
  block = setValue(
    block,
    "IsTimeSignatureEnabled",
    String(scene.signature !== undefined)
  )
  edits.push({ start: range.start, end: range.end, replacement: block })
})

// --- clips -----------------------------------------------------------------

const FILLED = /<ClipSlot>\s*<Value>([\s\S]*)<\/Value>\s*<\/ClipSlot>/
const EMPTY = /<ClipSlot>\s*<Value \/>\s*<\/ClipSlot>/

const sessionLists = describeClipSlotLists(base).filter(
  (list) => list.isSession && list.trackIndex >= 0
)

function clipAt(track: number, scene: number): string {
  const list = sessionLists.find((entry) => entry.trackIndex === track)
  const slot = list?.slots[scene]
  if (!slot) throw new Error(`no slot ${track}/${scene}`)
  const clip = FILLED.exec(base.slice(slot.start, slot.end))?.[1]
  if (clip === undefined) throw new Error(`slot ${track}/${scene} is empty`)
  return clip
}

/** Where each track plays, and which clip Live authored it copies. */
const LAYOUT: readonly {
  readonly track: number
  readonly source: number
  readonly scenes: readonly number[]
  /** Scenes that copy a different source clip of the same track. */
  readonly other?: Readonly<Record<number, number>>
}[] = [
  { track: 0, source: 0, scenes: [1, 4, 6, 8, 10, 11] },
  { track: 1, source: 0, scenes: [7, 9] },
  { track: 2, source: 0, scenes: [1, 2, 3, 4, 5, 6, 8, 10, 11] },
  { track: 3, source: 0, scenes: [0, 2, 4, 5, 6, 10, 11], other: { 0: 1 } },
  { track: 4, source: 0, scenes: [1, 3, 4, 6, 7, 8, 9, 10] },
  { track: 5, source: 0, scenes: [1, 4, 6, 7, 9, 11] },
  { track: 6, source: 0, scenes: [3, 4, 5, 6, 8, 10, 11] },
  { track: 7, source: 0, scenes: [2, 3, 5, 6, 8, 10, 11] },
  {
    track: 8,
    source: 0,
    scenes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    other: { 7: 2, 9: 1 },
  },
]

/** Chorus scenes take the next palette row, the bridge the one after. */
const ROW_SHIFT: Readonly<Record<number, number>> = {
  4: 14,
  6: 14,
  10: 14,
  7: 28,
  9: 28,
}

/** Clips whose follow action is already on: the rest are what the repair finds. */
const FOLLOW_ON = new Set(["2/2", "2/4", "3/4", "8/1", "8/2", "8/3"])
/** One clip uses Jump (9), which Live 10 does not have. */
const JUMP = "4/8"
/** DRUMS, BASS, KEYS, PAD, GUITAR and LEAD VOX. */
const STEM_TRACKS = new Set([2, 3, 4, 5, 6, 7])
/** GUITAR plays half the loop DRUMS plays in these scenes. */
const SHORT_GUITAR = new Set([3, 5, 8, 10, 11])

function halve(clip: string, tags: readonly string[]): string {
  let next = clip
  for (const tag of tags) {
    const match = new RegExp(`<${tag} Value="([\\d.]+)" />`).exec(next)
    if (!match) continue
    next = next.replace(match[0], `<${tag} Value="${Number(match[1]) / 2}" />`)
  }
  return next
}

for (const entry of LAYOUT) {
  const list = sessionLists.find((item) => item.trackIndex === entry.track)
  if (!list) throw new Error(`no session list for track ${entry.track}`)
  list.slots.forEach((slot, scene) => {
    const body = base.slice(slot.start, slot.end)
    const wanted = entry.scenes.includes(scene)
    const filled = FILLED.test(body)
    if (!wanted) {
      if (!filled) return
      // A clip Live authored that this arrangement does not keep here.
      edits.push({
        start: slot.start,
        end: slot.end,
        replacement: body.replace(FILLED, "<ClipSlot><Value /></ClipSlot>"),
      })
      return
    }
    let clip = clipAt(entry.track, entry.other?.[scene] ?? entry.source)
    const color = /<Color Value="(-?\d+)" \/>/.exec(clip)
    if (color && ROW_SHIFT[scene] !== undefined) {
      clip = clip.replace(
        color[0],
        `<Color Value="${(Number(color[1]) + ROW_SHIFT[scene]!) % 70}" />`
      )
    }
    const key = `${entry.track}/${scene}`
    if (FOLLOW_ON.has(key)) {
      clip = setValue(clip, "FollowActionEnabled", "true")
    }
    if (key === JUMP) {
      clip = setValue(clip, "FollowActionA", 9)
      clip = setValue(clip, "FollowActionEnabled", "true")
    }
    // Stems play once through, which is what gives a scene a length for
    // follow actions to follow. The click and the MIDI clips keep looping.
    if (STEM_TRACKS.has(entry.track)) clip = setValue(clip, "LoopOn", "false")
    if (entry.track === 6 && SHORT_GUITAR.has(scene)) {
      clip = halve(clip, ["CurrentEnd", "LoopEnd", "OutMarker", "HiddenLoopEnd"])
    }
    const inner = `<ClipSlot><Value>${clip}</Value></ClipSlot>`
    edits.push({
      start: slot.start,
      end: slot.end,
      replacement: filled
        ? body.replace(FILLED, () => inner)
        : body.replace(EMPTY, () => inner),
    })
  })
}

let arranged = applyEdits(
  base,
  [...edits].sort((a, b) => a.start - b.start)
)

// The stems end up warped at half the set's tempo: the state a set is left in
// when a clip's BPM is changed by hand, and what `rewarpClips` exists to fix.
const warped = rewarpClips(arranged, 60)
if (!warped.ok) throw new Error(warped.error)
arranged = warped.xml

const problems = validateGeneratedSet(arranged)
if (problems.length > 0) {
  throw new Error(`arranged set fails validation: ${problems[0]!.detail}`)
}
const document = parseAlsDocument(arranged)
const clips = document.tracks.flatMap((track) =>
  track.sessionClips.filter((clip) => clip !== null)
)
writeFileSync(output, encodeAls(arranged))
console.log(
  `${document.tracks.length} tracks, ${document.scenes.length} scenes, ${clips.length} clips, ${arranged.length} characters`
)
