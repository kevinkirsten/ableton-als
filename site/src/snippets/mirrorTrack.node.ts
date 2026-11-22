import { readFile, writeFile } from "node:fs/promises"
import {
  decodeAls,
  encodeAls,
  mirrorTrackGeometry,
  previewMirror,
} from "ableton-als/node"

const xml = decodeAls(await readFile("Song.als"))

const preview = previewMirror(xml, "DRUMS", "BASS")
console.log(preview.differing, "scenes differ")

// Copies loop windows, warp markers and follow times
// from the first track onto the second, scene by scene.
// The audio each track plays is left alone.
const fixed = mirrorTrackGeometry(xml, "DRUMS", "BASS")
if (!fixed.ok) throw new Error(fixed.error)

console.log(fixed.summary)
await writeFile("Song [fix].als", encodeAls(fixed.xml))
