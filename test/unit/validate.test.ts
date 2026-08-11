import { describe, expect, it } from "vitest"
import { validateGeneratedSet } from "../../src/core/validate.js"

// This test file is NEW — the source module had only incidental coverage
// through the consumer's assembly tests. One case per rule, per the
// extraction plan. The fixtures keep the real-file anatomy: inner ClipSlot
// without an Id, freeze list before the session one, v10 scenes (name in the
// attribute).

function slot(id: number): string {
  return `<ClipSlot Id="${id}"><LomId Value="0" /><ClipSlot><Value /></ClipSlot><HasStop Value="true" /><NeedRefreeze Value="true" /></ClipSlot>`
}

function slots(count: number): string {
  return Array.from({ length: count }, (_, index) => slot(index)).join("")
}

function track(
  id: number,
  name: string,
  freezeCount: number,
  sessionCount: number
): string {
  return [
    `<AudioTrack Id="${id}">`,
    `<Name><EffectiveName Value="${name}" /></Name>`,
    `<DeviceChain>`,
    `<FreezeSequencer><ClipSlotList>${slots(freezeCount)}</ClipSlotList></FreezeSequencer>`,
    `<MainSequencer><ClipSlotList>${slots(sessionCount)}</ClipSlotList></MainSequencer>`,
    `<AudioOutputRouting><Target Value="AudioOut/Master" /></AudioOutputRouting>`,
    `</DeviceChain>`,
    `</AudioTrack>`,
  ].join("")
}

function buildDocument(options?: {
  readonly tracks?: string
  readonly sceneCount?: number
  readonly nextPointeeId?: number
  readonly extra?: string
}): string {
  const sceneCount = options?.sceneCount ?? 2
  const scenes = Array.from(
    { length: sceneCount },
    (_, index) => `<Scene Id="${index + 1}" Value="S${index + 1}" />`
  ).join("")
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Ableton MajorVersion="5" MinorVersion="10.0_377" Creator="Ableton Live 10.1.43">`,
    `<LiveSet>`,
    `<NextPointeeId Value="${options?.nextPointeeId ?? 900}" />`,
    `<Tracks>${options?.tracks ?? track(10, "CLICK", 2, 2) + track(11, "LEAD", 2, 2)}</Tracks>`,
    options?.extra ?? "",
    `<MasterTrack><Tempo><Manual Value="120" /></Tempo><ClipSlotList /></MasterTrack>`,
    `<Scenes>${scenes}</Scenes>`,
    `</LiveSet>`,
    `</Ableton>`,
  ].join("")
}

describe("validateGeneratedSet", () => {
  it("a clean generated set has no problems", () => {
    expect(validateGeneratedSet(buildDocument())).toEqual([])
  })

  it("a mismatched closing tag is caught — malformed XML loses the whole set", () => {
    const problems = validateGeneratedSet(
      `<LiveSet><Tracks></LiveSet></Tracks>`
    )
    expect(problems.map((problem) => problem.rule)).toContain("xml")
    expect(problems[0]!.detail).toContain("closes")
  })

  it("tags opened and never closed are caught", () => {
    const problems = validateGeneratedSet(`<LiveSet><Tracks><AudioTrack>`)
    expect(problems.map((problem) => problem.rule)).toContain("xml")
    expect(
      problems.find((problem) => problem.rule === "xml")!.detail
    ).toContain("LiveSet")
  })

  it("a ragged ClipSlotList fails the grid — one slot per scene is what keeps Live alive", () => {
    const ragged = buildDocument({
      tracks: track(10, "CLICK", 2, 2) + track(11, "LEAD", 2, 1),
    })
    const problems = validateGeneratedSet(ragged)
    const grid = problems.find((problem) => problem.rule === "grid")
    expect(grid).toBeDefined()
    expect(grid!.detail).toContain('"LEAD"')
    expect(grid!.detail).toContain("1 slots for 2 scenes")
  })

  it("carries the message taken apart, so a consumer can localize it", () => {
    // `detail` is English prose. A consumer that does not print English needs
    // the same message as a stable code plus its values — parsing the prose is
    // the only alternative, and it breaks on any wording change.
    const ragged = buildDocument({
      tracks: track(10, "CLICK", 2, 2) + track(11, "LEAD", 2, 1),
    })
    const grid = validateGeneratedSet(ragged).find(
      (problem) => problem.rule === "grid"
    )
    expect(grid!.code).toBe("grid_slot_count")
    expect(grid!.values).toEqual({
      list: 3,
      track: "LEAD",
      slots: 1,
      scenes: 2,
    })
  })

  it("every value it interpolates appears in values", () => {
    // The invariant that keeps a localized render from losing information: no
    // number or name may exist only inside the prose.
    const problems = validateGeneratedSet(buildDocument({ nextPointeeId: 5 }))
    const ids = problems.find((problem) => problem.code === "next_pointee_too_low")
    expect(ids).toBeDefined()
    for (const value of Object.values(ids!.values)) {
      expect(ids!.detail).toContain(String(value))
    }
  })

  it("NextPointeeId must be greater than the file's highest Id", () => {
    const problems = validateGeneratedSet(buildDocument({ nextPointeeId: 5 }))
    const ids = problems.find((problem) => problem.rule === "ids")
    expect(ids).toBeDefined()
    expect(ids!.detail).toContain("NextPointeeId 5")
  })

  it("a missing NextPointeeId is a problem of its own", () => {
    const missing = buildDocument().replace(/<NextPointeeId Value="\d+" \/>/, "")
    const problems = validateGeneratedSet(missing)
    expect(
      problems.find((problem) => problem.rule === "ids")!.detail
    ).toContain("missing")
  })

  it("an orphan PointeeId is caught — the reference crashes Live 10 at load", () => {
    const orphan = buildDocument({
      extra: `<EnvelopeTarget><PointeeId Value="777" /></EnvelopeTarget>`,
    })
    const problems = validateGeneratedSet(orphan)
    const ids = problems.find((problem) => problem.rule === "ids")
    expect(ids).toBeDefined()
    expect(ids!.detail).toContain("777")
  })

  it("a resolvable PointeeId is not flagged", () => {
    const resolvable = buildDocument({
      extra:
        `<VolumeModulationTarget Id="777"><LockEnvelope Value="0" /></VolumeModulationTarget>` +
        `<EnvelopeTarget><PointeeId Value="777" /></EnvelopeTarget>`,
    })
    expect(validateGeneratedSet(resolvable)).toEqual([])
  })

  it("routing to a nonexistent track is caught — it changes the audio without warning", () => {
    const orphanRoute = buildDocument({
      tracks:
        track(10, "CLICK", 2, 2) +
        track(11, "LEAD", 2, 2).replace(
          'Value="AudioOut/Master"',
          'Value="AudioOut/Track.99/TrackOut"'
        ),
    })
    const problems = validateGeneratedSet(orphanRoute)
    const routing = problems.find((problem) => problem.rule === "routing")
    expect(routing).toBeDefined()
    expect(routing!.detail).toContain("99")
  })

  it('a duplicated singleton member is caught — Live 10 refuses with "already has member"', () => {
    const duplicated = buildDocument({
      tracks: (track(10, "CLICK", 2, 2) + track(11, "LEAD", 2, 2)).replace(
        '<NeedRefreeze Value="true" /></ClipSlot>',
        '<NeedRefreeze Value="true" /><NeedRefreeze Value="true" /></ClipSlot>'
      ),
    })
    const problems = validateGeneratedSet(duplicated)
    const xml = problems.find((problem) => problem.rule === "xml")
    expect(xml).toBeDefined()
    expect(xml!.detail).toContain("<NeedRefreeze>")
    expect(xml!.detail).toContain("ClipSlot")
  })
})
