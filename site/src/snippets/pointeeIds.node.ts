import { readFile, writeFile } from "node:fs/promises"
import {
  decodeAls,
  encodeAls,
  fixPointeeIds,
  inspectPointeeIds,
} from "ableton-als/node"

const xml = decodeAls(await readFile("Song.als"))

const report = inspectPointeeIds(xml)
console.log(report.duplicatedIds.length, "duplicates")

// Refuses on its own when automation already points at
// a duplicated Id: renumbering would attach it to the
// wrong target.
const fixed = fixPointeeIds(xml)
if (!fixed.ok) throw new Error(fixed.error)

console.log(fixed.summary)
await writeFile("Song [fix].als", encodeAls(fixed.xml))
