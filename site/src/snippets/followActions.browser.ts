import {
  decodeAls,
  encodeAls,
  inspectFollowActions,
  syncFollowActions,
} from "ableton-als/web"

export async function repair(
  file: File
): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const xml = await decodeAls(bytes)

  const report = inspectFollowActions(xml)
  console.log(report.needEnable, "to enable")
  console.log(report.needRetime, "to retime")

  // Enables each clip's follow action and sets its time
  // to the real length of its scene. Refuses when a
  // scene's clips disagree on length.
  const fixed = syncFollowActions(xml)
  if (!fixed.ok) throw new Error(fixed.error)

  console.log(fixed.summary)
  return encodeAls(fixed.xml)
}
