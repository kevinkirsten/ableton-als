import {
  decodeAls,
  encodeAls,
  mirrorTrackGeometry,
  previewMirror,
} from "ableton-als/web"

export async function repair(
  file: File
): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const xml = await decodeAls(bytes)

  const preview = previewMirror(xml, "DRUMS", "BASS")
  console.log(preview.differing, "scenes differ")

  // Copies loop windows, warp markers and follow times
  // from the first track onto the second, scene by
  // scene. The audio each track plays is left alone.
  const fixed = mirrorTrackGeometry(xml, "DRUMS", "BASS")
  if (!fixed.ok) throw new Error(fixed.error)

  console.log(fixed.summary)
  return encodeAls(fixed.xml)
}
