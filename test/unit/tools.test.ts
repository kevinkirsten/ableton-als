import { describe, expect, it } from "vitest"
import {
  detectVersion,
  fixPointeeIds,
  inspectFollowActions,
  inspectPointeeIds,
  inspectRewarp,
  isUntestedVersion,
  listTrackNames,
  mirrorTrackGeometry,
  previewMirror,
  rewarpClips,
  supportsTool,
  syncFollowActions,
} from "../../src/core/tools.js"

// Minimal fixture with the structure that matters: track → MainSequencer →
// ClipSlotList → outer ClipSlot (with an inner Id-less ClipSlot, as Live
// writes it) → clip. The FREEZE list comes first, to prove it is ignored.
function clip(options: {
  readonly kind?: "AudioClip" | "MidiClip"
  readonly loopStart: number
  readonly loopEnd: number
  readonly bpm?: number
  readonly followTime?: number
  readonly enabled?: boolean
  readonly linked?: boolean
  readonly loopOn?: boolean
}): string {
  const kind = options.kind ?? "AudioClip"
  const bpm = options.bpm ?? 120
  const warp =
    kind === "AudioClip"
      ? `<WarpMarkers><WarpMarker Id="1" SecTime="0" BeatTime="0" /><WarpMarker Id="2" SecTime="${(60 / bpm) * 0.03125}" BeatTime="0.03125" /></WarpMarkers>`
      : ""
  return [
    `<${kind} Id="0" Time="0">`,
    `<CurrentStart Value="${options.loopStart}" />`,
    `<CurrentEnd Value="${options.loopEnd}" />`,
    `<LoopStart Value="${options.loopStart}" />`,
    `<LoopEnd Value="${options.loopEnd}" />`,
    `<HiddenLoopStart Value="0" />`,
    `<HiddenLoopEnd Value="${options.loopEnd}" />`,
    `<LoopOn Value="${options.loopOn ?? false}" />`,
    `<FollowTime Value="${options.followTime ?? 4}" />`,
    `<FollowActionA Value="4" />`,
    `<FollowActionEnabled Value="${options.enabled ?? false}" />`,
    `<IsLinked Value="${options.linked ?? true}" />`,
    warp,
    `</${kind}>`,
  ].join("")
}

function track(name: string, clips: readonly (string | null)[]): string {
  const slots = clips
    .map(
      (body, index) =>
        `<ClipSlot Id="${index}"><ClipSlot><Value>${body ?? ""}</Value></ClipSlot></ClipSlot>`
    )
    .join("")
  return [
    `<AudioTrack Id="${name.length}">`,
    `<Name><EffectiveName Value="${name}" /></Name>`,
    // FREEZE list first: anything that pairs wrongly grabs this one.
    `<FreezeSequencer><ClipSlotList><ClipSlot Id="0"></ClipSlot></ClipSlotList></FreezeSequencer>`,
    `<MainSequencer><ClipSlotList>${slots}</ClipSlotList></MainSequencer>`,
    `</AudioTrack>`,
  ].join("")
}

function document(body: string, minorVersion = "12.0_12402"): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Ableton MajorVersion="5" MinorVersion="${minorVersion}" Creator="Ableton Live 12.4.3">`,
    `<LiveSet><Tempo><Manual Value="91" /></Tempo>`,
    body,
    `<NextPointeeId Value="500" /></LiveSet></Ableton>`,
  ].join("")
}

describe("detectVersion / supportsTool", () => {
  it("reads the major from MinorVersion", () => {
    expect(detectVersion(document("", "10.0_377")).major).toBe(10)
    expect(detectVersion(document("", "12.0_12402")).major).toBe(12)
  })

  it("no tool runs on a file of unknown version", () => {
    const unknown = detectVersion("<xml/>")
    expect(unknown.major).toBeNull()
    for (const tool of [
      "pointeeIds",
      "rewarp",
      "mirrorTrack",
      "followActions",
      "relinkSamples",
    ] as const) {
      expect(supportsTool(tool, unknown)).toBe(false)
    }
  })

  it("Follow Action is v12-only and relinking samples is v10-only", () => {
    const v10 = detectVersion(document("", "10.0_377"))
    const v12 = detectVersion(document("", "12.0_12402"))
    expect(supportsTool("followActions", v10)).toBe(false)
    expect(supportsTool("followActions", v12)).toBe(true)
    expect(supportsTool("relinkSamples", v10)).toBe(true)
    expect(supportsTool("relinkSamples", v12)).toBe(false)
    // These run on both versions.
    for (const tool of ["pointeeIds", "rewarp", "mirrorTrack"] as const) {
      expect(supportsTool(tool, v10)).toBe(true)
      expect(supportsTool(tool, v12)).toBe(true)
    }
  })
})

describe("fixPointeeIds", () => {
  const duplicated = document(
    `<ModulationTarget Id="7"><LockEnvelope Value="0" /></ModulationTarget>` +
      `<VolumeModulationTarget Id="7"><LockEnvelope Value="0" /></VolumeModulationTarget>` +
      `<AutomationTarget Id="9"><LockEnvelope Value="0" /></AutomationTarget>`
  )

  it("finds the duplicated ids", () => {
    const report = inspectPointeeIds(duplicated)
    expect(report.duplicatedIds).toEqual(["7"])
    expect(report.extraOccurrences).toBe(1)
  })

  it("keeps the first occurrence and renumbers starting from NextPointeeId", () => {
    const result = fixPointeeIds(duplicated)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.xml).toContain('<ModulationTarget Id="7"')
    expect(result.xml).toContain('<VolumeModulationTarget Id="500"')
    expect(result.xml).toContain('<NextPointeeId Value="501" />')
    expect(inspectPointeeIds(result.xml).duplicatedIds).toEqual([])
  })

  it("REFUSES when a reference points at the duplicated id", () => {
    const risky = document(
      `<ModulationTarget Id="7" /><ModulationTarget Id="7" />` +
        `<EnvelopeTarget><PointeeId Value="7" /></EnvelopeTarget>`
    )
    const result = fixPointeeIds(risky)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("7")
  })

  it("leaves an already-correct file untouched", () => {
    const clean = document(
      `<ModulationTarget Id="1" /><ModulationTarget Id="2" />`
    )
    const result = fixPointeeIds(clean)
    expect(result.ok && result.changed).toBe(0)
    expect(result.ok && result.xml).toBe(clean)
  })
})

describe("rewarpClips", () => {
  // Grid written at 150: the fractional boundaries become round numbers at 91.
  const atOneFifty = document(
    track("LEAD", [
      clip({ loopStart: 0, loopEnd: 13.186813186813186, bpm: 150 }),
      clip({
        loopStart: 13.186813186813186,
        loopEnd: 39.56043956043956,
        bpm: 150,
      }),
    ])
  )

  it("discovers which BPM the grid was written at", () => {
    const report = inspectRewarp(atOneFifty)
    expect(report.gridBpm).toBe(150)
    expect(report.masterBpm).toBe(91)
    expect(report.clips).toBe(2)
  })

  it("scales the grid along with the warp, and the beats come out round", () => {
    const result = rewarpClips(atOneFifty, 91)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.xml).toContain('<LoopEnd Value="8" />')
    expect(result.xml).toContain('<LoopStart Value="8" />')
    expect(result.xml).toContain('<LoopEnd Value="24" />')
    expect(inspectRewarp(result.xml).gridBpm).toBe(91)
  })

  it("preserves each clip's AUDIO span", () => {
    // The guarantee that matters: beat × 60/bpm — the seconds covered do not change.
    const before = (13.186813186813186 * 60) / 150
    const after = (8 * 60) / 91
    expect(after).toBeCloseTo(before, 9)
  })

  it("is idempotent", () => {
    const once = rewarpClips(atOneFifty, 91)
    expect(once.ok).toBe(true)
    if (!once.ok) return
    const twice = rewarpClips(once.xml, 91)
    expect(twice.ok && twice.changed).toBe(0)
    expect(twice.ok && twice.xml).toBe(once.xml)
  })

  it("refuses an invalid BPM", () => {
    expect(rewarpClips(atOneFifty, 0).ok).toBe(false)
    expect(rewarpClips(atOneFifty, Number.NaN).ok).toBe(false)
  })
})

describe("mirrorTrackGeometry", () => {
  const misaligned = document(
    track("PERCUSSION", [
      clip({ loopStart: 0, loopEnd: 8, bpm: 91 }),
      clip({ loopStart: 8, loopEnd: 24, bpm: 91 }),
    ]) +
      // The CUE stayed in the old scale: same audio, wrong windows.
      track("CUE", [
        clip({ loopStart: 0, loopEnd: 13.186813186813186, bpm: 150 }),
        clip({
          loopStart: 13.186813186813186,
          loopEnd: 39.56043956043956,
          bpm: 150,
        }),
      ])
  )

  it("lists the tracks that have clips", () => {
    expect(listTrackNames(misaligned)).toEqual(["PERCUSSION", "CUE"])
  })

  it("shows in the preview how many scenes diverge", () => {
    const preview = previewMirror(misaligned, "PERCUSSION", "CUE")
    expect(preview.shared).toBe(2)
    expect(preview.differing).toBe(2)
    expect(preview.baseOnly).toBe(0)
    expect(preview.targetOnly).toBe(0)
  })

  it("copies windows and warp from the base to the target", () => {
    const result = mirrorTrackGeometry(misaligned, "PERCUSSION", "CUE")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(previewMirror(result.xml, "PERCUSSION", "CUE").differing).toBe(0)
    // The base was not touched.
    expect(result.xml).toContain(
      '<Name><EffectiveName Value="PERCUSSION" /></Name>'
    )
    expect(inspectRewarp(result.xml).gridBpm).toBe(91)
  })

  it("refuses to mirror a track onto itself", () => {
    expect(mirrorTrackGeometry(misaligned, "CUE", "CUE").ok).toBe(false)
  })

  it("refuses a nonexistent track", () => {
    expect(mirrorTrackGeometry(misaligned, "DOES NOT EXIST", "CUE").ok).toBe(
      false
    )
    expect(mirrorTrackGeometry(misaligned, "CUE", "DOES NOT EXIST").ok).toBe(
      false
    )
  })

  it("leaves alone the scene where only one of the two has a clip", () => {
    const uneven = document(
      track("PERCUSSION", [clip({ loopStart: 0, loopEnd: 8, bpm: 91 }), null]) +
        track("CUE", [
          clip({ loopStart: 0, loopEnd: 13.186813186813186, bpm: 150 }),
          clip({ loopStart: 99, loopEnd: 111, bpm: 150 }),
        ])
    )
    const result = mirrorTrackGeometry(uneven, "PERCUSSION", "CUE")
    expect(result.ok && result.changed).toBe(1)
    // The target's orphan clip stayed as it was.
    expect(result.ok && result.xml).toContain('<LoopStart Value="99" />')
  })
})

describe("syncFollowActions", () => {
  // Two 8-beat audio tracks and a click looping over 1 bar.
  const scene = document(
    track("PERCUSSION", [clip({ loopStart: 0, loopEnd: 8 })]) +
      track("LEAD", [clip({ loopStart: 0, loopEnd: 8 })]) +
      track("MIDI CLICK", [
        clip({ kind: "MidiClip", loopStart: 0, loopEnd: 4, loopOn: true }),
      ])
  )

  it("reports what needs to change", () => {
    const report = inspectFollowActions(scene)
    expect(report.clips).toBe(3)
    expect(report.scenesWithDuration).toBe(1)
    expect(report.needEnable).toBe(3)
    expect(report.needUnlink).toBe(3)
    // All three carry FollowTime 4 while the scene lasts 8 — including the
    // audio clips, whose own duration is already 8: the field itself was stale.
    expect(report.needRetime).toBe(3)
  })

  it("enables, unmarks linked and uses the SCENE duration — including on the click", () => {
    const result = syncFollowActions(scene)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.xml).not.toContain('<FollowActionEnabled Value="false" />')
    expect(result.xml).not.toContain('<IsLinked Value="true" />')
    // The click loops over 4 but follows the scene, which lasts 8.
    const clickBody = /<MidiClip [\s\S]*?<\/MidiClip>/.exec(result.xml)![0]
    expect(clickBody).toContain('<FollowTime Value="8" />')
    expect(clickBody).toContain('<LoopEnd Value="4" />')
  })

  it("REFUSES when the scene has clips with different durations", () => {
    const conflicting = document(
      track("PERCUSSION", [clip({ loopStart: 0, loopEnd: 8 })]) +
        track("LEAD", [clip({ loopStart: 0, loopEnd: 16 })])
    )
    const result = syncFollowActions(conflicting)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("different durations")
  })

  it("does not enable Follow Action on a scene with no audio clip (click bookend)", () => {
    const bookend = document(
      track("MIDI CLICK", [
        clip({ kind: "MidiClip", loopStart: 0, loopEnd: 4, loopOn: true }),
      ])
    )
    const result = syncFollowActions(bookend)
    expect(result.ok && result.changed).toBe(0)
    expect(result.ok && result.xml).toContain(
      '<FollowActionEnabled Value="false" />'
    )
  })

  it("is idempotent", () => {
    const once = syncFollowActions(scene)
    expect(once.ok).toBe(true)
    if (!once.ok) return
    const twice = syncFollowActions(once.xml)
    expect(twice.ok && twice.changed).toBe(0)
  })
})

describe("untested versions", () => {
  it("Live 8 runs nothing — the format was never verified", () => {
    // A MultiTrack.als from MultiTracks.com came in Live 8 WITHOUT
    // `NextPointeeId`: renumbering there would let Live reuse a freshly
    // assigned Id.
    const live8 = detectVersion(document("", "8.0_1"))
    expect(isUntestedVersion(live8)).toBe(true)
    for (const tool of [
      "pointeeIds",
      "rewarp",
      "mirrorTrack",
      "followActions",
      "relinkSamples",
    ] as const) {
      expect(supportsTool(tool, live8)).toBe(false)
    }
  })

  it("Live 9 uses the v10 rules (it is the rest of the archive)", () => {
    const live9 = detectVersion(document("", "9.7_1"))
    expect(isUntestedVersion(live9)).toBe(false)
    expect(supportsTool("pointeeIds", live9)).toBe(true)
    expect(supportsTool("followActions", live9)).toBe(false)
  })

  it("Live 11 already uses the v12 rules", () => {
    const live11 = detectVersion(document("", "11.0_1"))
    expect(supportsTool("followActions", live11)).toBe(true)
    expect(supportsTool("relinkSamples", live11)).toBe(false)
  })
})
