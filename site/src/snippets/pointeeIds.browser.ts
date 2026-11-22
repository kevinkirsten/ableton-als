import {
  decodeAls,
  encodeAls,
  fixPointeeIds,
  inspectPointeeIds,
} from "ableton-als/web"

export async function repair(
  file: File
): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const xml = await decodeAls(bytes)

  const report = inspectPointeeIds(xml)
  console.log(report.duplicatedIds.length, "duplicates")

  // Refuses on its own when automation already points
  // at a duplicated Id: renumbering would attach it to
  // the wrong target.
  const fixed = fixPointeeIds(xml)
  if (!fixed.ok) throw new Error(fixed.error)

  console.log(fixed.summary)
  return encodeAls(fixed.xml)
}
