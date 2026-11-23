import {
  decodeAls,
  downgradeToV10,
  encodeAls,
  fileCreatedAt,
  PORTABLE_VOLUME_ATTRIBUTES,
  validateGeneratedSet,
} from "ableton-als/web"

export async function convert(
  file: File
): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const xml = await decodeAls(bytes)

  const result = downgradeToV10(xml, {
    libraryRoot: "/Volumes/Demo SSD/Library",
    // Builds the alias records Live 10 finds audio by,
    // in a form that resolves on exFAT, HFS+ and APFS.
    fileCreatedAt,
    volumeAttributes: PORTABLE_VOLUME_ATTRIBUTES,
  })
  if (!result.ok) throw new Error(result.error)

  for (const warning of result.warnings) {
    console.warn(warning.code, warning.values)
  }

  // Never hand over a set Live 10 would crash on.
  const problems = validateGeneratedSet(result.xml)
  if (problems.length > 0) {
    throw new Error(problems[0]!.detail)
  }

  // Save as "Song [v10].als" and keep the original.
  return encodeAls(result.xml)
}
