import { readFile, writeFile } from "node:fs/promises"
import {
  decodeAls,
  encodeAls,
  inspectFollowActions,
  syncFollowActions,
} from "ableton-als/node"

const xml = decodeAls(await readFile("Song.als"))

const report = inspectFollowActions(xml)
console.log(report.needEnable, "to enable")
console.log(report.needRetime, "to retime")

// Enables each clip's follow action and sets its time
// to the real length of its scene. Refuses when a
// scene's clips disagree on length.
const fixed = syncFollowActions(xml)
if (!fixed.ok) throw new Error(fixed.error)

console.log(fixed.summary)
await writeFile("Song [fix].als", encodeAls(fixed.xml))
