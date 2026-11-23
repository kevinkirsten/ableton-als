import { readFile, writeFile } from "node:fs/promises"
import {
  decodeAls,
  encodeAls,
  fileCreatedAt,
  PORTABLE_VOLUME_ATTRIBUTES,
  relinkFileRefs,
} from "ableton-als/node"

const xml = decodeAls(await readFile("Song.als"))

// Re-roots every Live 10 sample reference at this
// machine's copy of the library, keeping each file's
// place inside it, and rebuilds the alias record Live
// 10 finds audio by.
const report = relinkFileRefs(
  xml,
  "/Volumes/Demo SSD/Library",
  {
    fileCreatedAt,
    volumeAttributes: PORTABLE_VOLUME_ATTRIBUTES,
  }
)

console.log(report.relinked, "relinked")
console.log("left alone:", report.unresolved)
await writeFile("Song [fix].als", encodeAls(report.xml))
