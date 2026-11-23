import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  detectVersion,
  downgradeToV10,
  fixPointeeIds,
  gridIsConsistent,
  inspectFollowActions,
  inspectPointeeIds,
  inspectRewarp,
  majorVersionOf,
  mirrorTrackGeometry,
  parseAlsDocument,
  PORTABLE_VOLUME_ATTRIBUTES,
  previewMirror,
  relinkFileRefs,
  rewarpClips,
  syncFollowActions,
  SYNTHETIC_CREATION_TIME,
  validateGeneratedSet,
} from "../../src/index.js"
import { decodeAls } from "../../src/node.js"
import {
  buildDamagedSampleSet,
  SAMPLE_LIBRARY_ROOT,
  SAMPLE_MIRROR_BASE,
  SAMPLE_MIRROR_TARGET,
} from "../../site/src/sample-set.js"

// ANCHOR: `site/sample/Demo Set.als` was SAVED BY LIVE 12.4.3. Nothing below
// is asserted about a document this project generated. `site/sample/README.md`
// says how the set was authored, and `docs/specs/HANDOFF.md` records that the
// page's conversion of it opened in Live 10.1.43 with every clip loaded.
const sample = decodeAls(
  readFileSync(new URL("../../site/sample/Demo Set.als", import.meta.url))
)
const document = parseAlsDocument(sample)
const clips = document.tracks.flatMap((track) =>
  track.sessionClips.filter((clip) => clip !== null)
)

const convert = (xml: string) => {
  const result = downgradeToV10(xml, {
    libraryRoot: SAMPLE_LIBRARY_ROOT,
    fileCreatedAt: () => SYNTHETIC_CREATION_TIME,
    volumeAttributes: PORTABLE_VOLUME_ATTRIBUTES,
  })
  if (!result.ok) throw new Error(result.error)
  return result
}

describe("the sample set, as Live 12 saved it", () => {
  it("is a Live 12.4.3 document", () => {
    expect(detectVersion(sample)).toMatchObject({
      major: 12,
      creator: "Ableton Live 12.4.3",
    })
  })

  it("has nine tracks plus Live's two default returns, and twelve scenes", () => {
    expect(document.tracks.map((track) => `${track.type}:${track.name}`)).toEqual([
      "MidiTrack:SYNTH",
      "MidiTrack:BELLS",
      "AudioTrack:DRUMS",
      "AudioTrack:BASS",
      "AudioTrack:KEYS",
      "AudioTrack:PAD",
      "AudioTrack:GUITAR",
      "AudioTrack:LEAD VOX",
      "AudioTrack:CLICK",
      "ReturnTrack:A-Reverb",
      "ReturnTrack:B-Delay",
    ])
    expect(document.scenes).toHaveLength(12)
    expect(gridIsConsistent(document)).toBe(true)
  })

  it("has 64 session clips, 56 audio and 8 MIDI", () => {
    expect(clips).toHaveLength(64)
    expect(clips.filter((clip) => clip.kind === "audio")).toHaveLength(56)
  })

  it("passes validation with no problem", () => {
    expect(validateGeneratedSet(sample)).toEqual([])
  })

  it("holds a scene name Live wrote in single quotes, and the library reads it", () => {
    // Live's own bytes: the attribute is single-quoted because of the quotes.
    expect(sample).toContain(`<Name Value='INTERLUDE "B"' />`)
    expect(document.scenes.map((scene) => scene.rawName)).toEqual([
      "COUNT IN",
      "INTRO",
      "VERSE 1",
      "PRE CHORUS",
      "CHORUS",
      "VERSE 2 & BUILD",
      "CHORUS 2",
      "BRIDGE",
      'INTERLUDE "B"',
      "BREAKDOWN",
      "LAST CHORUS",
      "OUTRO",
    ])
  })

  it("programs tempo and time signature on some scenes", () => {
    expect(document.scenes[0]).toMatchObject({ tempo: 120, tempoEnabled: true })
    expect(document.scenes[7]).toMatchObject({
      tempo: 90,
      tempoEnabled: true,
      timeSignatureId: 302,
    })
    expect(document.scenes[1]!.tempoEnabled).toBe(false)
  })

  it("names every audio clip's file, all of them the synthesized tones", () => {
    const names = new Set(
      clips
        .filter((clip) => clip.kind === "audio")
        .map((clip) => clip.sample?.fileName)
    )
    expect([...names].sort()).toEqual([
      "bass_stem.wav",
      "click_3-4_one_bar.wav",
      "click_4-4_one_bar.wav",
      "click_6-8_one_bar.wav",
      "drums_stem.wav",
      "extra.wav",
      "guitar_stem.wav",
      "keys_stem.wav",
      "lead_vox_main_comp_tuned_and_edited_v3.wav",
      "pad_stem.wav",
    ])
  })

  it("carries no path of the machine it was authored on", () => {
    expect(sample).not.toMatch(/\/Users\/(?!nsh\/)/)
    expect(sample).not.toMatch(/Desktop/)
  })
})

describe("the repairs the sample is left needing", () => {
  it("has its stems warped at half the set's tempo", () => {
    const report = inspectRewarp(sample)
    expect(report).toMatchObject({ masterBpm: 120, gridBpm: 60, clips: 56 })
  })

  it("has GUITAR looping differently from DRUMS in five of seven shared scenes", () => {
    expect(
      previewMirror(sample, SAMPLE_MIRROR_BASE, SAMPLE_MIRROR_TARGET)
    ).toMatchObject({ shared: 7, differing: 5 })
  })

  it("blocks the follow action repair until the two tracks agree", () => {
    expect(inspectFollowActions(sample).conflicting).toEqual([3, 5, 8, 10, 11])
    expect(syncFollowActions(sample).ok).toBe(false)
  })

  it("has no duplicated automation Id: Live would not have saved one", () => {
    expect(inspectPointeeIds(sample).duplicatedIds).toEqual([])
  })

  it("comes out clean after rewarp, mirror and follow actions, in that order", () => {
    const warped = rewarpClips(sample, 120)
    if (!warped.ok) throw new Error(warped.error)
    const mirrored = mirrorTrackGeometry(
      warped.xml,
      SAMPLE_MIRROR_BASE,
      SAMPLE_MIRROR_TARGET
    )
    if (!mirrored.ok) throw new Error(mirrored.error)
    const synced = syncFollowActions(mirrored.xml)
    if (!synced.ok) throw new Error(synced.error)

    expect(inspectRewarp(synced.xml).gridBpm).toBe(120)
    expect(
      previewMirror(synced.xml, SAMPLE_MIRROR_BASE, SAMPLE_MIRROR_TARGET)
        .differing
    ).toBe(0)
    expect(inspectFollowActions(synced.xml)).toMatchObject({
      needEnable: 0,
      needUnlink: 0,
      needRetime: 0,
      conflicting: [],
    })
    expect(validateGeneratedSet(synced.xml)).toEqual([])
    expect(validateGeneratedSet(convert(synced.xml).xml)).toEqual([])
  })
})

describe("converting the sample to Live 10", () => {
  const result = convert(sample)
  const converted = parseAlsDocument(result.xml)

  it("produces a Live 10 document that validates", () => {
    expect(majorVersionOf(result.xml)).toBe(10)
    expect(validateGeneratedSet(result.xml)).toEqual([])
  })

  it("keeps every track, scene and clip", () => {
    expect(converted.tracks).toHaveLength(document.tracks.length)
    expect(converted.scenes).toHaveLength(12)
    expect(
      converted.tracks.flatMap((track) => track.sessionClips).filter(Boolean)
    ).toHaveLength(64)
  })

  it("moves tempo and time signature into the scene names", () => {
    expect(converted.scenes.map((scene) => scene.rawName)).toEqual([
      "COUNT IN 120BPM 4/4",
      "INTRO",
      "VERSE 1",
      "PRE CHORUS",
      "CHORUS",
      "VERSE 2 & BUILD",
      "CHORUS 2",
      "BRIDGE 90BPM 6/8",
      'INTERLUDE "B" 120BPM 4/4',
      "BREAKDOWN 3/4",
      "LAST CHORUS 4/4",
      "OUTRO 96.5BPM",
    ])
  })

  it("warns about the Jump follow action and the file outside the library", () => {
    expect(
      result.warnings.map(({ code, values }) => ({ code, values }))
    ).toEqual([
      { code: "jump_follow_action", values: {} },
      {
        code: "samples_outside_root",
        values: { count: 1, sample: "/Volumes/Demo SSD/Loose/extra.wav" },
      },
    ])
  })

  it("writes an alias record, with the portable volume attributes, on all 56 audio references", () => {
    const records = [...result.xml.matchAll(/<Data>([\s\S]*?)<\/Data>/g)]
      .map((match) => match[1]!.replace(/\s+/g, ""))
      .filter((hex) => hex !== "")
    expect(records).toHaveLength(56)
    expect(
      records.every((hex) => hex.slice(268, 276) === "00000D02")
    ).toBe(true)
  })

  it("can then be re-rooted at another copy of the library", () => {
    const report = relinkFileRefs(result.xml, "/Volumes/Second Disk/Library", {
      fileCreatedAt: () => SYNTHETIC_CREATION_TIME,
      volumeAttributes: PORTABLE_VOLUME_ATTRIBUTES,
    })
    // 55 audio references, plus two device presets from Live's own default
    // set whose path happens to contain a folder named "Library" too. The
    // relinker goes by the folder's name, so it takes those along.
    expect(report.relinked).toBe(57)
    expect(report.unresolved).toEqual(["extra.wav"])
  })
})

describe("the damaged variant", () => {
  const damaged = buildDamagedSampleSet(sample)

  it("reports exactly the damage that was planted, across all four rules", () => {
    expect(
      validateGeneratedSet(damaged).map(({ rule, code }) => `${rule}/${code}`)
    ).toEqual([
      "grid/grid_slot_count",
      "ids/next_pointee_too_low",
      "ids/duplicate_pointee_ids",
      "routing/routing_orphan_tracks",
      "xml/xml_duplicate_singleton",
      "ids/orphan_pointee",
    ])
  })

  it("names the track and the counts in the grid problem", () => {
    const grid = validateGeneratedSet(damaged).find(
      (problem) => problem.code === "grid_slot_count"
    )
    expect(grid?.values).toMatchObject({ track: "BASS", slots: 11, scenes: 12 })
  })

  it("is still a set the page can read", () => {
    const parsed = parseAlsDocument(damaged)
    expect(parsed.tracks).toHaveLength(11)
    expect(parsed.scenes).toHaveLength(12)
    expect(gridIsConsistent(parsed)).toBe(false)
  })

  it("has three duplicated Ids that the repair renumbers", () => {
    expect(inspectPointeeIds(damaged)).toMatchObject({
      extraOccurrences: 3,
      collidingReferences: [],
    })
    const fixed = fixPointeeIds(damaged)
    if (!fixed.ok) throw new Error(fixed.error)
    expect(
      validateGeneratedSet(fixed.xml).map((problem) => problem.code)
    ).not.toContain("duplicate_pointee_ids")
  })

  it("leaves the healthy sample untouched", () => {
    expect(validateGeneratedSet(sample)).toEqual([])
  })
})
