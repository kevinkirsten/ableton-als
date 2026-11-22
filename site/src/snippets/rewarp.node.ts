import { readFile, writeFile } from "node:fs/promises"
import {
  decodeAls,
  encodeAls,
  inspectRewarp,
  rewarpClips,
} from "ableton-als/node"

const xml = decodeAls(await readFile("Song.als"))

const report = inspectRewarp(xml)
console.log("clips warped at", report.gridBpm)

// Rescales every beat value of every audio clip, not
// just the warp marker. Touching only the warp makes
// clips drift.
const fixed = rewarpClips(xml, 120)
if (!fixed.ok) throw new Error(fixed.error)

console.log(fixed.summary)
await writeFile("Song [fix].als", encodeAls(fixed.xml))
