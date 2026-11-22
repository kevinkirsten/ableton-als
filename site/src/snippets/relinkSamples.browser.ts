import {
  decodeAls,
  encodeAls,
  fileCreatedAt,
  relinkFileRefs,
} from "ableton-als/web"

export async function repair(
  file: File
): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const xml = await decodeAls(bytes)

  // Re-roots every Live 10 sample reference at this
  // machine's copy of the library, keeping each file's
  // place inside it, and rebuilds the alias record Live
  // 10 finds audio by.
  const report = relinkFileRefs(
    xml,
    "/Volumes/Demo SSD/Library",
    { fileCreatedAt }
  )

  console.log(report.relinked, "relinked")
  console.log("left alone:", report.unresolved)
  return encodeAls(report.xml)
}
