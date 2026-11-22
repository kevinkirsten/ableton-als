import {
  decodeAls,
  encodeAls,
  inspectRewarp,
  rewarpClips,
} from "ableton-als/web"

export async function repair(
  file: File
): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const xml = await decodeAls(bytes)

  const report = inspectRewarp(xml)
  console.log("clips warped at", report.gridBpm)

  // Rescales every beat value of every audio clip, not
  // just the warp marker. Touching only the warp makes
  // clips drift.
  const fixed = rewarpClips(xml, 120)
  if (!fixed.ok) throw new Error(fixed.error)

  console.log(fixed.summary)
  return encodeAls(fixed.xml)
}
