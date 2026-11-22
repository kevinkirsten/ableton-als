import { describe, expect, it } from "vitest"
import {
  collectClips,
  decodeTimeSignatureId,
  detectVersion,
  downgradeToV10,
  findSceneRanges,
  fixPointeeIds,
  gridIsConsistent,
  hfsShortName,
  inspectFollowActions,
  inspectPointeeIds,
  inspectRewarp,
  majorVersionOf,
  mirrorTrackGeometry,
  parseAlsDocument,
  previewMirror,
  readSceneTempo,
  relinkFileRefs,
  rewarpClips,
  supportsTool,
  SYNTHETIC_CREATION_TIME,
  syncFollowActions,
  unescapeXml,
  v10ColorIndex,
  validateGeneratedSet,
  type AlsClip,
  type AlsDocument,
  type ToolOutcome,
} from "../../src/index.js"
import {
  buildDamagedSampleSet,
  buildSampleSet,
  DAMAGED_FILE_NAME,
  SAMPLE_FILE_NAME,
  SAMPLE_LIBRARY_ROOT,
  SAMPLE_MIRROR_BASE,
  SAMPLE_MIRROR_TARGET,
} from "../../site/src/sample.js"

// The sample is synthetic: it was written for the demo page and never saved by
// Live. These tests therefore prove one thing only, that the sample keeps
// giving every view of the demo something to do. They say nothing about what
// Live itself writes.

const sample = buildSampleSet()
const document = parseAlsDocument(sample)

const OUTSIDE_FILE = "/Volumes/Other Disk/Loose/extra.wav"
const LONG_FILE_NAME = "lead_vox_main_comp_tuned_and_edited_v3.wav"

function clipsOf(parsed: AlsDocument): readonly AlsClip[] {
  return parsed.tracks.flatMap((track) =>
    track.sessionClips.filter((clip): clip is AlsClip => clip !== null)
  )
}

function unwrap(outcome: ToolOutcome): string {
  if (!outcome.ok) throw new Error(outcome.error)
  return outcome.xml
}

/** Every `<Path>` of the v12 FileRefs, unescaped. */
function samplePaths(xml: string): readonly string[] {
  return [...xml.matchAll(/<Path Value="([^"]*)" \/>/g)].map((match) =>
    unescapeXml(match[1]!)
  )
}

function convert(xml: string) {
  const result = downgradeToV10(xml, {
    libraryRoot: SAMPLE_LIBRARY_ROOT,
    fileCreatedAt: () => SYNTHETIC_CREATION_TIME,
  })
  if (!result.ok) throw new Error(result.error)
  return result
}

describe("sample module", () => {
  it("names the two files and the library root", () => {
    expect(SAMPLE_FILE_NAME).toBe("Demo Set.als")
    expect(DAMAGED_FILE_NAME).toBe("Damaged Set.als")
    expect(SAMPLE_LIBRARY_ROOT).toBe("/Volumes/Demo SSD/Library")
  })

  it("is deterministic", () => {
    expect(buildSampleSet()).toBe(sample)
    expect(buildDamagedSampleSet()).toBe(buildDamagedSampleSet())
  })

  it("stays under 200 KB and is plain ASCII text", () => {
    expect(sample.length).toBeLessThan(200 * 1024)
    expect(/^[\t\n\x20-\x7e]*$/.test(sample)).toBe(true)
  })

  it("says in the document itself that it is synthetic", () => {
    expect(sample.slice(0, 300)).toContain("Synthetic sample")
    expect(sample.slice(0, 300)).toContain("never saved by Live")
  })
})

describe("healthy sample: header, tracks, scenes and clips", () => {
  it("has a Live 12 header every tool recognizes", () => {
    expect(majorVersionOf(sample)).toBe(12)
    expect(detectVersion(sample).major).toBe(12)
    expect(document.header?.minorVersion).toBe("12.0_12402")
    expect(document.sceneSchema).toBe("v12")
    for (const tool of [
      "pointeeIds",
      "rewarp",
      "mirrorTrack",
      "followActions",
    ] as const) {
      expect(supportsTool(tool, detectVersion(sample))).toBe(true)
    }
  })

  it("has eight tracks with invented generic names, one of them MIDI", () => {
    expect(document.tracks.map((track) => [track.name, track.type])).toEqual([
      ["CLICK", "AudioTrack"],
      ["DRUMS", "AudioTrack"],
      ["BASS", "AudioTrack"],
      ["KEYS", "AudioTrack"],
      ["GUITAR", "AudioTrack"],
      ["PAD", "AudioTrack"],
      ["LEAD VOX", "AudioTrack"],
      ["SYNTH", "MidiTrack"],
    ])
  })

  it("has twelve scenes and one slot per scene on every track", () => {
    expect(document.scenes).toHaveLength(12)
    for (const track of document.tracks) {
      expect(track.sessionClips).toHaveLength(12)
    }
  })

  it("has between 55 and 70 session clips, audio and MIDI, and empty slots", () => {
    const clips = clipsOf(document)
    expect(clips.length).toBeGreaterThanOrEqual(55)
    expect(clips.length).toBeLessThanOrEqual(70)
    expect(clips).toHaveLength(61)
    expect(clips.filter((clip) => clip.kind === "audio")).toHaveLength(55)
    expect(clips.filter((clip) => clip.kind === "midi")).toHaveLength(6)

    const slots = document.tracks.flatMap((track) => track.sessionClips)
    expect(slots.filter((slot) => slot === null).length).toBeGreaterThan(0)
    // The MIDI clips sit on the MIDI track and carry notes.
    const synth = document.tracks.find((track) => track.name === "SYNTH")
    expect(synth?.sessionClips.filter((clip) => clip?.kind === "midi")).toHaveLength(6)
    expect(sample).toContain("<MidiNoteEvent ")
  })

  it("gives every audio clip loop fields, two warp markers and a sample", () => {
    for (const clip of clipsOf(document)) {
      expect(clip.loopStart).not.toBeNull()
      expect(clip.loopEnd).not.toBeNull()
      expect(clip.loopEnd!).toBeGreaterThan(clip.loopStart!)
      expect(clip.timeSignature).not.toBeNull()
      if (clip.kind !== "audio") continue
      expect(clip.isWarped).toBe(true)
      expect(clip.warpMarkerCount).toBe(2)
      expect(clip.warpBpm).not.toBeNull()
      expect(clip.sample?.frames).toBeGreaterThan(0)
      expect([44_100, 48_000]).toContain(clip.sample?.sampleRate)
    }
  })

  it("reads the master tempo and time signature", () => {
    expect(document.masterTempo).toBe(120)
    expect(document.masterTimeSignatureId).toBe(201)
    expect(document.nextPointeeId).toBe(2200)
  })
})

describe("healthy sample: scenes", () => {
  const sceneBodies = findSceneRanges(sample).map((range) =>
    sample.slice(range.start, range.end)
  )

  it("carries structured tempo on some scenes and leaves it off on others", () => {
    const enabled = document.scenes.filter((scene) => scene.tempoEnabled)
    expect(enabled.map((scene) => scene.tempo)).toEqual([120, 90, 120, 96.5])
    expect(
      document.scenes.filter((scene) => scene.tempoEnabled === false).length
    ).toBeGreaterThan(0)
  })

  it("programs 4/4, 3/4 and 6/8 across scenes", () => {
    const programmed = sceneBodies
      .filter((body) => body.includes('<IsTimeSignatureEnabled Value="true" />'))
      .map((body) => {
        const id = Number(/<TimeSignatureId Value="(\d+)" \/>/.exec(body)?.[1])
        const meter = decodeTimeSignatureId(id)
        return meter === null ? null : `${meter.num}/${meter.den}`
      })
    expect(programmed).toContain("4/4")
    expect(programmed).toContain("3/4")
    expect(programmed).toContain("6/8")
  })

  it("stores the ampersand of a scene name escaped", () => {
    expect(sample).toContain('<Name Value="VERSE 2 &amp; BUILD" />')
    expect(document.scenes.map((scene) => scene.rawName)).toContain(
      "VERSE 2 & BUILD"
    )
  })

  it("single-quotes the scene name that holds a double quote", () => {
    expect(sample).toContain(`<Name Value='INTERLUDE "B"' />`)
    // The only single-quoted attribute in the document.
    expect(sample.match(/[\w.:-]+='[^']*'/g)).toHaveLength(1)
  })
})

describe("healthy sample: colours", () => {
  it("spreads track colours over the palette, one of them in 60..69", () => {
    const colours = document.tracks.map((track) => track.colorIndex)
    for (const colour of colours) {
      expect(colour).toBeGreaterThanOrEqual(0)
      expect(colour).toBeLessThanOrEqual(69)
    }
    expect(new Set(colours).size).toBe(colours.length)
    expect(colours.some((colour) => colour !== null && colour >= 60)).toBe(true)
  })

  it("keeps every clip colour a raw palette index, across all five rows", () => {
    const colours = collectClips(sample).map((clip) =>
      Number(/<Color Value="(-?\d+)" \/>/.exec(clip.body)?.[1])
    )
    expect(colours).toHaveLength(61)
    for (const colour of colours) {
      expect(colour).toBeGreaterThanOrEqual(0)
      expect(colour).toBeLessThanOrEqual(69)
    }
    expect(new Set(colours).size).toBeGreaterThanOrEqual(20)
    expect(new Set(colours.map((colour) => Math.floor(colour / 14))).size).toBe(5)
  })

  it("has elements with no colour (-1)", () => {
    const sceneColours = document.scenes.map((scene) => scene.colorIndex)
    expect(sceneColours).toContain(-1)
    expect(sceneColours.some((colour) => colour !== null && colour >= 60)).toBe(
      true
    )
  })
})

describe("healthy sample: audio references", () => {
  const paths = samplePaths(sample)

  it("has one v12 FileRef per audio clip, all pointing at wav files", () => {
    expect(paths).toHaveLength(55)
    for (const path of paths) expect(path).toMatch(/\.wav$/)
    // The v12 shape: no <Name> and no alias <Data> inside the FileRef.
    expect(sample).not.toContain("<Data>")
    expect(sample).not.toMatch(/<FileRef>\s*<HasRelativePath/)
  })

  it("keeps every file but one under <root>/<Folder>/<file>.wav", () => {
    const outside = paths.filter(
      (path) => !path.startsWith(`${SAMPLE_LIBRARY_ROOT}/`)
    )
    expect(outside).toEqual([OUTSIDE_FILE])
    for (const path of paths) {
      if (path === OUTSIDE_FILE) continue
      const inside = path.slice(SAMPLE_LIBRARY_ROOT.length + 1).split("/")
      expect(inside).toHaveLength(2)
    }
  })

  it("includes a file name longer than 31 characters", () => {
    expect(LONG_FILE_NAME.length).toBeGreaterThan(31)
    expect(paths.some((path) => path.endsWith(`/${LONG_FILE_NAME}`))).toBe(true)
  })

  it("stores the ampersand of a folder name escaped once", () => {
    expect(sample).toContain("Library/Keys &amp; Pads/keys_stem.wav")
    expect(sample).not.toContain("&amp;amp;")
  })
})

describe("healthy sample: integrity", () => {
  it("passes validateGeneratedSet with zero problems", () => {
    expect(validateGeneratedSet(sample)).toEqual([])
  })

  it("has a consistent grid", () => {
    expect(gridIsConsistent(document)).toBe(true)
  })
})

describe("planted problem a: duplicated target Ids", () => {
  it("reports duplicates that no clip envelope points at", () => {
    const report = inspectPointeeIds(sample)
    expect(report.targets).toBe(52)
    expect(report.duplicatedIds.length).toBeGreaterThanOrEqual(1)
    expect(report.duplicatedIds).toHaveLength(6)
    expect(report.extraOccurrences).toBe(6)
    expect(report.collidingReferences).toEqual([])
    // There ARE clip envelopes, so the empty list above means something.
    expect(sample.match(/<PointeeId Value="\d+" \/>/g)).toHaveLength(2)
  })

  it("is fixed by fixPointeeIds", () => {
    const outcome = fixPointeeIds(sample)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.changed).toBe(6)
    const after = inspectPointeeIds(outcome.xml)
    expect(after.duplicatedIds).toEqual([])
    expect(after.extraOccurrences).toBe(0)
    expect(after.targets).toBe(52)
    expect(validateGeneratedSet(outcome.xml)).toEqual([])
  })
})

describe("planted problem b: clips warped at another BPM", () => {
  it("reports a grid BPM different from the master BPM", () => {
    const report = inspectRewarp(sample)
    expect(report.masterBpm).toBe(120)
    expect(report.gridBpm).toBe(60)
    expect(report.gridBpm).not.toBe(report.masterBpm)
    expect(report.clips).toBe(55)
    expect(report.byBpm).toEqual([
      [60, 43],
      [120, 12],
    ])
  })

  it("is fixed by rewarpClips at the master BPM", () => {
    const masterBpm = inspectRewarp(sample).masterBpm
    expect(masterBpm).not.toBeNull()
    const outcome = rewarpClips(sample, masterBpm!)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.changed).toBe(55)
    const after = inspectRewarp(outcome.xml)
    expect(after.gridBpm).toBe(after.masterBpm)
    expect(after.byBpm).toEqual([[120, 55]])
    expect(validateGeneratedSet(outcome.xml)).toEqual([])
  })
})

describe("planted problem c: follow actions out of sync", () => {
  it("reports work to do and no conflicting scene", () => {
    const report = inspectFollowActions(sample)
    expect(report.clips).toBe(61)
    expect(report.conflicting).toEqual([])
    expect(
      report.needEnable + report.needUnlink + report.needRetime
    ).toBeGreaterThan(0)
    expect(report.needEnable).toBe(15)
    expect(report.needUnlink).toBe(15)
    expect(report.needRetime).toBe(20)
    expect(report.scenesWithDuration).toBe(11)
    expect(report.loopOnlyScenes).toBe(1)
  })

  it("is fixed by syncFollowActions", () => {
    const outcome = syncFollowActions(sample)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.changed).toBe(20)
    const after = inspectFollowActions(outcome.xml)
    expect(after.needEnable).toBe(0)
    expect(after.needUnlink).toBe(0)
    expect(after.needRetime).toBe(0)
    expect(after.conflicting).toEqual([])
  })
})

describe("planted problem d: two tracks with differing clip geometry", () => {
  it("exposes the track names the demo uses", () => {
    expect(SAMPLE_MIRROR_BASE).toBe("DRUMS")
    expect(SAMPLE_MIRROR_TARGET).toBe("GUITAR")
  })

  it("reports shared scenes, some of them differing", () => {
    const preview = previewMirror(
      sample,
      SAMPLE_MIRROR_BASE,
      SAMPLE_MIRROR_TARGET
    )
    expect(preview.shared).toBeGreaterThan(0)
    expect(preview.differing).toBeGreaterThan(0)
    expect(preview).toMatchObject({
      shared: 7,
      baseOnly: 2,
      targetOnly: 0,
      differing: 5,
    })
    expect(preview.tracks).toContain(SAMPLE_MIRROR_BASE)
    expect(preview.tracks).toContain(SAMPLE_MIRROR_TARGET)
  })

  it("is fixed by mirrorTrackGeometry, without creating a follow conflict", () => {
    const outcome = mirrorTrackGeometry(
      sample,
      SAMPLE_MIRROR_BASE,
      SAMPLE_MIRROR_TARGET
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.changed).toBe(5)
    const after = previewMirror(
      outcome.xml,
      SAMPLE_MIRROR_BASE,
      SAMPLE_MIRROR_TARGET
    )
    expect(after.shared).toBe(7)
    expect(after.differing).toBe(0)
    expect(inspectFollowActions(outcome.xml).conflicting).toEqual([])
  })
})

describe("planted problem e: one Jump follow action", () => {
  it("has exactly one enabled clip using Jump", () => {
    const jumping = collectClips(sample).filter(
      (clip) =>
        clip.body.includes('<FollowActionA Value="9" />') &&
        clip.body.includes('<FollowActionEnabled Value="true" />')
    )
    expect(jumping).toHaveLength(1)
    expect(sample.match(/<FollowActionA Value="9" \/>/g)).toHaveLength(1)
  })

  it("makes the downgrade warn once", () => {
    const jumps = convert(sample).warnings.filter(
      (warning) => warning.code === "jump_follow_action"
    )
    expect(jumps).toHaveLength(1)
  })
})

describe("conversion to Live 10", () => {
  const result = convert(sample)
  const converted = parseAlsDocument(result.xml)

  it("returns ok, as a Live 10 document that validates clean", () => {
    expect(majorVersionOf(result.xml)).toBe(10)
    expect(detectVersion(result.xml).major).toBe(10)
    expect(converted.sceneSchema).toBe("v10")
    expect(validateGeneratedSet(result.xml)).toEqual([])
    expect(gridIsConsistent(converted)).toBe(true)
    expect(result.scenesConverted).toBe(12)
  })

  it("keeps the number of tracks, scenes and clips", () => {
    expect(converted.tracks).toHaveLength(document.tracks.length)
    expect(converted.scenes).toHaveLength(document.scenes.length)
    expect(clipsOf(converted)).toHaveLength(clipsOf(document).length)
    expect(converted.tracks.map((track) => track.name)).toEqual(
      document.tracks.map((track) => track.name)
    )
    expect(
      converted.tracks.map((track) =>
        track.sessionClips.map((clip) => clip?.kind ?? null)
      )
    ).toEqual(
      document.tracks.map((track) =>
        track.sessionClips.map((clip) => clip?.kind ?? null)
      )
    )
  })

  it("puts tempo and time signature back into the scene names", () => {
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

    // And the tokens read back as what the source scenes programmed.
    const bodies = findSceneRanges(sample).map((range) =>
      sample.slice(range.start, range.end)
    )
    for (const [index, scene] of document.scenes.entries()) {
      const tokens = readSceneTempo(converted.scenes[index]!.rawName)
      expect(tokens.bpm).toBe(scene.tempoEnabled ? scene.tempo : null)
      const programmed = bodies[index]!.includes(
        '<IsTimeSignatureEnabled Value="true" />'
      )
      const meter = decodeTimeSignatureId(scene.timeSignatureId ?? -1)
      expect(tokens.timeSignatureLabel).toBe(
        programmed && meter !== null ? `${meter.num}/${meter.den}` : null
      )
    }
  })

  it("writes the quoted and the ampersand scene names the Live 10 way", () => {
    expect(result.xml).toContain(
      'Value="INTERLUDE &quot;B&quot; 120BPM 4/4">'
    )
    expect(result.xml).toContain('Value="VERSE 2 &amp; BUILD">')
    expect(result.xml).not.toContain("&amp;amp;")
  })

  it("warns about the Jump follow action and the sample outside the root", () => {
    expect(result.warnings.map((warning) => warning.code).sort()).toEqual([
      "jump_follow_action",
      "samples_outside_root",
    ])
    const outside = result.warnings.find(
      (warning) => warning.code === "samples_outside_root"
    )
    expect(outside?.values).toEqual({ count: 1, sample: OUTSIDE_FILE })
  })

  it("gives every FileRef under /Volumes/ a non-empty alias record", () => {
    const refs = [...result.xml.matchAll(/<FileRef>[\s\S]*?<\/FileRef>/g)].map(
      (match) => match[0]
    )
    expect(refs).toHaveLength(55)
    for (const ref of refs) {
      expect(ref).toContain('<RelativePathElement Id="0" Dir="Volumes" />')
      const data = /<Data>([\s\S]*?)<\/Data>/.exec(ref)?.[1] ?? ""
      expect(data.replace(/\s+/g, "")).toMatch(/^[0-9A-F]{200,}$/)
    }
    expect(result.xml).not.toContain("<Data />")
    expect(result.xml).not.toContain("<Path Value=")
  })

  it("shortens the long file name inside the alias, and only there", () => {
    const short = hfsShortName(LONG_FILE_NAME)
    expect(short).not.toBe(LONG_FILE_NAME)
    const hex = [...short]
      .map((character) =>
        character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")
      )
      .join("")
    const ref = [...result.xml.matchAll(/<FileRef>[\s\S]*?<\/FileRef>/g)]
      .map((match) => match[0])
      .find((candidate) => candidate.includes(LONG_FILE_NAME))
    expect(ref).toBeDefined()
    expect(ref).toContain(`<Name Value="${LONG_FILE_NAME}" />`)
    const data = /<Data>([\s\S]*?)<\/Data>/.exec(ref!)?.[1] ?? ""
    expect(data.replace(/\s+/g, "")).toContain(hex)
  })

  it("shifts track and scene colours and leaves clip colours raw", () => {
    expect(converted.tracks.map((track) => track.colorIndex)).toEqual(
      document.tracks.map((track) => v10ColorIndex(track.colorIndex ?? -1))
    )
    expect(converted.scenes.map((scene) => scene.colorIndex)).toEqual(
      document.scenes.map((scene) => v10ColorIndex(scene.colorIndex ?? -1))
    )
    const before = collectClips(sample).map(
      (clip) => /<Color Value="(-?\d+)" \/>/.exec(clip.body)?.[1]
    )
    const after = collectClips(result.xml).map(
      (clip) => /<ColorIndex Value="(-?\d+)" \/>/.exec(clip.body)?.[1]
    )
    expect(after).toEqual(before)
  })

  it("leaves nothing of the Live 12 shape behind", () => {
    for (const leftover of [
      "<FollowAction>",
      "<Color Value=",
      "<MainTrack",
      "AudioOut/Main",
      "<Scenes>",
      "TakeLanes",
      "ScaleInformation",
      "<IsInKey",
      "SelectedToolPanel",
      "<Name Value='",
    ]) {
      expect(result.xml).not.toContain(leftover)
    }
    // The master's freeze list goes out empty, as Live 10 writes it.
    const master = /<MasterTrack>[\s\S]*?<\/MasterTrack>/.exec(result.xml)?.[0]
    expect(master).toContain("<ClipSlotList />")
    expect(converted.masterTempo).toBe(120)
  })
})

describe("relinking the converted set", () => {
  const converted = convert(sample).xml

  it("re-roots the library files at a second disk", () => {
    const report = relinkFileRefs(converted, "/Volumes/Second Disk/Library")
    expect(report.relinked).toBeGreaterThan(0)
    expect(report.relinked).toBe(54)
    expect(report.unresolved).toEqual(["extra.wav"])
    expect(report.xml).toContain('Dir="Second Disk"')
    expect(report.xml).toContain('Dir="Keys &amp; Pads"')
    expect(validateGeneratedSet(report.xml)).toEqual([])
    expect(clipsOf(parseAlsDocument(report.xml))).toHaveLength(61)
  })
})

describe("all four repairs in sequence", () => {
  it("leaves nothing for any tool to do, and still converts clean", () => {
    let xml = unwrap(fixPointeeIds(sample))
    xml = unwrap(rewarpClips(xml, 120))
    xml = unwrap(
      mirrorTrackGeometry(xml, SAMPLE_MIRROR_BASE, SAMPLE_MIRROR_TARGET)
    )
    xml = unwrap(syncFollowActions(xml))

    expect(inspectPointeeIds(xml).duplicatedIds).toEqual([])
    const rewarp = inspectRewarp(xml)
    expect(rewarp.gridBpm).toBe(rewarp.masterBpm)
    expect(
      previewMirror(xml, SAMPLE_MIRROR_BASE, SAMPLE_MIRROR_TARGET).differing
    ).toBe(0)
    const follow = inspectFollowActions(xml)
    expect(follow.conflicting).toEqual([])
    expect(follow.needEnable + follow.needUnlink + follow.needRetime).toBe(0)

    expect(validateGeneratedSet(xml)).toEqual([])
    expect(gridIsConsistent(parseAlsDocument(xml))).toBe(true)
    expect(validateGeneratedSet(convert(xml).xml)).toEqual([])
  })
})

describe("damaged sample", () => {
  const damaged = buildDamagedSampleSet()
  const problems = validateGeneratedSet(damaged)

  it("is derived from the healthy one and differs from it", () => {
    expect(damaged).not.toBe(sample)
    expect(Math.abs(damaged.length - sample.length)).toBeLessThan(1024)
  })

  it("reports at least three problems across at least three rules", () => {
    expect(problems.length).toBeGreaterThanOrEqual(3)
    expect(
      new Set(problems.map((problem) => problem.rule)).size
    ).toBeGreaterThanOrEqual(3)
  })

  it("reports exactly the damage that was planted", () => {
    expect(
      problems.map((problem) => ({
        rule: problem.rule,
        code: problem.code,
        values: problem.values,
      }))
    ).toEqual([
      {
        rule: "grid",
        code: "grid_slot_count",
        values: { list: 4, track: "BASS", slots: 11, scenes: 12 },
      },
      {
        rule: "ids",
        code: "next_pointee_too_low",
        values: { declared: "900", max: 2104 },
      },
      {
        rule: "routing",
        code: "routing_orphan_tracks",
        values: { ids: "99" },
      },
      {
        rule: "xml",
        code: "xml_duplicate_singleton",
        values: {
          element: "NeedArrangerRefreeze",
          parent: "AudioTrack",
          offset: expect.any(Number) as number,
        },
      },
      {
        rule: "ids",
        code: "orphan_pointee",
        values: { ids: "4242" },
      },
    ])
  })

  it("still parses, as a Live 12 document", () => {
    expect(detectVersion(damaged).major).toBe(12)
    const parsed = parseAlsDocument(damaged)
    expect(parsed.header?.minorVersion).toBe("12.0_12402")
    expect(parsed.tracks).toHaveLength(8)
    expect(parsed.scenes).toHaveLength(12)
    expect(clipsOf(parsed)).toHaveLength(61)
    // The grid damage is visible to the parser too.
    expect(gridIsConsistent(parsed)).toBe(false)
  })
})
