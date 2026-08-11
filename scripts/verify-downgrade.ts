import { existsSync, readFileSync } from "node:fs"
import { basename } from "node:path"
import { gunzipSync } from "node:zlib"
import { downgradeToV10 } from "../src/core/downgrade.js"
import {
  parseAlsDocument,
  readSceneTempo,
  type AlsClip,
} from "../src/core/document.js"

// ---------------------------------------------------------------------------
// Checks the porter against the TRUTH: a pair of the same set saved in both
// Live versions. What Ableton writes in v10 is the reference; every
// difference in what we produce is our defect.
//
//   pnpm tsx scripts/verify-downgrade.ts --library-root <path> <pair-v12.als> <pair-v10.als>
//
// Finding out here costs seconds. Finding out by opening Ableton costs a
// round trip per defect — and some would only surface mid-show.
// ---------------------------------------------------------------------------

type Vocabulary = {
  readonly tags: ReadonlySet<string>
  readonly attributes: ReadonlySet<string>
  readonly withId: ReadonlySet<string>
  readonly withoutId: ReadonlySet<string>
}

function vocabularyOf(xml: string): Vocabulary {
  const tags = new Set<string>()
  const attributes = new Set<string>()
  const withId = new Set<string>()
  const withoutId = new Set<string>()
  for (const element of xml.matchAll(
    /<([A-Za-z_][\w.-]*)((?:\s+[\w.:-]+="[^"]*")*)\s*\/?>/g
  )) {
    const [, tag, raw = ""] = element
    tags.add(tag!)
    for (const attribute of raw.matchAll(/\s+([\w.:-]+)=/g)) {
      attributes.add(`${tag}@${attribute[1]}`)
    }
    ;(/\sId="/.test(raw) ? withId : withoutId).add(tag!)
  }
  return { tags, attributes, withId, withoutId }
}

function read(path: string): string {
  const buffer = readFileSync(path)
  try {
    return gunzipSync(buffer).toString("utf8")
  } catch {
    return buffer.toString("utf8")
  }
}

/**
 * The fields whose divergence changes what actually plays.
 *
 * `relativeDirs` is deliberately NOT here (measured 2026-08-11): Live 10
 * writes `<RelativePath>` or leaves it empty depending on WHERE the `.als`
 * was saved — two Live-authored files of the same content differ on it and
 * both open fine. Audio is located by the `<Data>` alias and the `PathHint`;
 * a save-location-dependent field cannot be a fidelity criterion.
 */
function fingerprint(clip: AlsClip): string {
  return [
    clip.rawName,
    clip.loopStart,
    clip.loopEnd,
    clip.loopOn,
    clip.isWarped,
    clip.followTime,
    clip.followActionA,
    clip.pitchCoarse,
    clip.warpBpm,
    clip.warpMarkerCount,
    clip.sample?.fileName ?? null,
  ].join(" | ")
}

function main() {
  const args = process.argv.slice(2)
  const rootFlag = args.indexOf("--library-root")
  const libraryRoot = rootFlag === -1 ? null : (args[rootFlag + 1] ?? null)
  if (rootFlag !== -1) args.splice(rootFlag, 2)
  const [sourcePath, truthPath] = args

  if (
    !libraryRoot ||
    !sourcePath ||
    !truthPath ||
    !existsSync(sourcePath) ||
    !existsSync(truthPath)
  ) {
    console.error(
      "✗ usage: pnpm tsx scripts/verify-downgrade.ts --library-root <path> <pair-v12.als> <pair-v10.als>"
    )
    process.exit(1)
  }

  const truthXml = read(truthPath)
  const result = downgradeToV10(read(sourcePath), { libraryRoot })
  if (!result.ok) {
    console.error(`✗ conversion failed: ${result.error}`)
    process.exit(1)
  }

  const truth = parseAlsDocument(truthXml)
  const ported = parseAlsDocument(result.xml)
  console.log(
    `reference ${basename(truthPath)}: ${truth.scenes.length} scenes · ${truth.tracks.length} tracks`
  )
  console.log(
    `ported:   ${ported.scenes.length} scenes · ${ported.tracks.length} tracks · ${result.scenesConverted} scenes converted`
  )
  for (const warning of result.warnings) {
    console.log(`  warning [${warning.kind}] ${warning.detail.slice(0, 120)}`)
  }

  let failures = 0

  // --- 1. vocabulary: Live 10 refuses the file over an unknown attribute ----
  const known = vocabularyOf(truthXml)
  const produced = vocabularyOf(result.xml)

  const riskyAttributes = [...produced.attributes]
    .filter((pair) => {
      const [tag] = pair.split("@")
      return known.tags.has(tag!) && !known.attributes.has(pair)
    })
    .sort()
  console.log(
    `\nnew attributes on known elements: ${riskyAttributes.length}${riskyAttributes.length ? " ✗" : " ✓"}`
  )
  for (const pair of riskyAttributes) console.log(`    ${pair}`)
  failures += riskyAttributes.length

  const needsId = [...known.withId].filter((tag) => !known.withoutId.has(tag))
  const missingId = needsId.filter((tag) => produced.withoutId.has(tag)).sort()
  console.log(
    `elements that lost their Id: ${missingId.length}${missingId.length ? " ✗" : " ✓"}`
  )
  for (const tag of missingId) console.log(`    ${tag}`)
  failures += missingId.length

  // The check that was missing, and the one that hurts most: an element v10
  // REQUIRES that v12 stopped writing. Without it the file opens and Live 10
  // dies with a message-less segfault — that is how `NeedRefreeze` surfaced.
  const missingTags = [...known.tags]
    .filter((tag) => !produced.tags.has(tag))
    .sort()
  console.log(
    `reference elements ABSENT from ours: ${missingTags.length}${missingTags.length ? " ✗ (candidates for a message-less crash)" : " ✓"}`
  )
  for (const tag of missingTags) console.log(`    ${tag}`)
  failures += missingTags.length

  const unknownTags = [...produced.tags].filter((tag) => !known.tags.has(tag))
  console.log(
    `elements the reference does not have: ${unknownTags.length}${unknownTags.length ? " (worth a look)" : " ✓"}`
  )
  for (const tag of unknownTags.slice(0, 20)) console.log(`    ${tag}`)

  // --- 2. semantics: scene names --------------------------------------------
  const sceneDiff = truth.scenes.flatMap((scene, index) => {
    const other = ported.scenes[index]?.rawName ?? "(absent)"
    return scene.rawName === other
      ? []
      : [
          `  ${index}: reference ${JSON.stringify(scene.rawName)} ≠ ${JSON.stringify(other)}`,
        ]
  })
  console.log(
    `\nscene names with different text: ${sceneDiff.length} of ${truth.scenes.length}`
  )
  for (const line of sceneDiff.slice(0, 8)) console.log(line)

  // The name text is what PROGRAMS tempo and time signature in v10.
  // Reproducing it byte for byte is impossible — v12 erases the tokens and
  // real archives use two conventions for the same case. What must match is
  // the READ.
  const semanticDiff = truth.scenes.flatMap((scene, index) => {
    const mine = readSceneTempo(ported.scenes[index]?.rawName ?? "")
    const theirs = readSceneTempo(scene.rawName)
    const same =
      theirs.bpm === mine.bpm &&
      theirs.timeSignatureLabel === mine.timeSignatureLabel
    return same
      ? []
      : [
          `  ${index}: reference ${theirs.bpm ?? "—"} BPM ${theirs.timeSignatureLabel ?? "—"} ≠ ${mine.bpm ?? "—"} BPM ${mine.timeSignatureLabel ?? "—"}  (${JSON.stringify(scene.rawName.slice(0, 44))})`,
        ]
  })
  console.log(
    `tempo/time signature Live 10 will READ: ${semanticDiff.length} divergent${semanticDiff.length ? " ✗" : " ✓"}`
  )
  for (const line of semanticDiff.slice(0, 12)) console.log(line)
  failures += semanticDiff.length

  // --- 3. semantics: clip by clip -------------------------------------------
  let compared = 0
  const clipDiff: string[] = []
  for (const [index, track] of truth.tracks.entries()) {
    const other = ported.tracks[index]
    for (const [slot, clip] of track.sessionClips.entries()) {
      const mirror = other?.sessionClips[slot] ?? null
      if (clip === null && mirror === null) continue
      if (clip === null || mirror === null) {
        clipDiff.push(
          `  ${track.name} slot ${slot}: ${clip === null ? "clip invented from nothing" : "clip lost"}`
        )
        continue
      }
      compared += 1
      if (fingerprint(clip) !== fingerprint(mirror)) {
        clipDiff.push(
          `  ${track.name} slot ${slot}:\n      reference ${fingerprint(clip)}\n      ported    ${fingerprint(mirror)}`
        )
      }
    }
  }
  console.log(
    `\ndivergent clips: ${clipDiff.length} of ${compared} compared${clipDiff.length ? "" : " ✓"}`
  )
  for (const line of clipDiff.slice(0, 12)) console.log(line)
  failures += clipDiff.length

  console.log(
    failures === 0
      ? "\n✓ the porter reproduces what Ableton itself writes in v10"
      : `\n✗ ${failures} divergence(s) — each one is a porter defect`
  )
  process.exit(failures === 0 ? 0 : 1)
}

main()
