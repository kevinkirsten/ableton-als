import { readFile } from "node:fs/promises"
import {
  decodeAls,
  detectVersion,
  parseAlsDocument,
} from "ableton-als/node"

const xml = decodeAls(await readFile("Song.als"))

const set = parseAlsDocument(xml)

// "Ableton Live 12.4.3"
console.log(detectVersion(xml).creator)
console.log(set.tracks.length, "tracks")
console.log(set.scenes.length, "scenes")

for (const track of set.tracks) {
  const clips = track.sessionClips.filter(Boolean)
  console.log(track.type, track.name, clips.length)
}
