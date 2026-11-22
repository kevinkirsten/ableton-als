import {
  decodeAls,
  detectVersion,
  parseAlsDocument,
} from "ableton-als/web"

export async function inspect(file: File) {
  // `file` comes from a file input or a drop event.
  const bytes = new Uint8Array(await file.arrayBuffer())
  const xml = await decodeAls(bytes)
  const set = parseAlsDocument(xml)

  // "Ableton Live 12.4.3"
  console.log(detectVersion(xml).creator)
  console.log(set.tracks.length, "tracks")
  console.log(set.scenes.length, "scenes")

  for (const track of set.tracks) {
    const clips = track.sessionClips.filter(Boolean)
    console.log(track.type, track.name, clips.length)
  }
}
