import { readFile, writeFile } from "node:fs/promises"
import {
  convertAlsToV10,
  PORTABLE_VOLUME_ATTRIBUTES,
} from "ableton-als/node"

const result = convertAlsToV10({
  fileName: "Song.als",
  bytes: await readFile("Song.als"),
  libraryRoot: "/Volumes/Demo SSD/Library",
  // Alias records that resolve on exFAT, HFS+ and APFS.
  volumeAttributes: PORTABLE_VOLUME_ATTRIBUTES,
})
if (!result.ok) throw new Error(result.error)

const { fileName, bytes } = result.data
const { warnings, problems } = result.data
for (const warning of warnings) {
  console.warn(warning.code, warning.values)
}

// Never keep a set Live 10 would crash on.
if (problems.length > 0) {
  throw new Error(problems[0]!.detail)
}

// "Song [v10].als", never over the original.
await writeFile(fileName, bytes)
