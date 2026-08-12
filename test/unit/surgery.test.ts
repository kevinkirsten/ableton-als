import { describe, expect, it } from "vitest"
import { gridIsConsistent, parseAlsDocument } from "../../src/core/document.js"
import {
  applyEdits,
  clipColorIndex,
  findClipSlotLists,
  findSceneRanges,
  removeScenes,
  withClipColorIndex,
} from "../../src/core/surgery.js"
import { paletteIndexFromFileColor } from "../../src/core/live-palette.js"

/**
 * The only way to get a `PaletteIndex`, and deliberately so: the converter is
 * the step that stops a track-shaped index being written into a clip. A test
 * that reached for `as PaletteIndex` would be testing something else.
 */
function palette(value: number) {
  return paletteIndexFromFileColor(value)!
}

// A fixture with the same anatomy as the real files: inner ClipSlot without an
// Id, freeze list BEFORE the session one, and scenes in the v10 schema (name
// in the attribute).
function slot(id: number, withClip: boolean): string {
  const clip = withClip
    ? `<AudioClip Id="${id}" Time="0"><Name Value="c${id}" /></AudioClip>`
    : ""
  return `
      <ClipSlot Id="${id}">
        <LomId Value="0" />
        <ClipSlot><Value>${clip}</Value></ClipSlot>
        <HasStop Value="true" />
      </ClipSlot>`
}

function track(id: number, name: string, sceneCount: number): string {
  const slots = (withClip: boolean) =>
    Array.from({ length: sceneCount }, (_, index) =>
      slot(index, withClip)
    ).join("")
  return `
    <AudioTrack Id="${id}">
      <Name><EffectiveName Value="${name}" /><UserName Value="${name}" /></Name>
      <DeviceChain>
        <FreezeSequencer><ClipSlotList>${slots(false)}</ClipSlotList></FreezeSequencer>
        <MainSequencer>
          <ClipSlotList>${slots(true)}</ClipSlotList>
          <Sample><ArrangerAutomation><Events /></ArrangerAutomation></Sample>
        </MainSequencer>
        <AudioOutputRouting><Target Value="AudioOut/Master" /></AudioOutputRouting>
      </DeviceChain>
    </AudioTrack>`
}

function document(sceneNames: readonly string[]): string {
  const scenes = sceneNames
    .map((name, index) => `<Scene Id="${index + 1}" Value="${name}" />`)
    .join("\n      ")
  return `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="10.0_377" Creator="Ableton Live 10.1.43">
  <LiveSet>
    <Tracks>
      ${track(10, "CLICK", sceneNames.length)}
      ${track(11, "LEAD 1", sceneNames.length)}
    </Tracks>
    <MasterTrack>
      <Tempo><Manual Value="120" /></Tempo>
      <ClipSlotList />
    </MasterTrack>
    <Scenes>
      ${scenes}
    </Scenes>
  </LiveSet>
</Ableton>`
}

// The real order of a v10 clip: `ColorIndex` comes right after `Name` and
// `Annotation`, and the outer slot only has `LomId` before it.
const COLORED_SLOT = `<ClipSlot Id="7"><LomId Value="0" /><ClipSlot><Value><AudioClip Id="1" Time="0"><LomId Value="0" /><CurrentStart Value="0" /><CurrentEnd Value="4" /><Name Value="Every Little Thing_(Y&amp;F)" /><Annotation Value="" /><ColorIndex Value="5" /><LaunchMode Value="0" /></AudioClip></Value></ClipSlot><HasStop Value="true" /></ClipSlot>`

describe("clip color", () => {
  it("reads the clip's ColorIndex, not the slot's", () => {
    expect(clipColorIndex(COLORED_SLOT)).toBe(5)
  })

  it("an empty slot has no color and gains none", () => {
    const empty = `<ClipSlot Id="7"><LomId Value="0" /><ClipSlot><Value /></ClipSlot><HasStop Value="true" /></ClipSlot>`
    expect(clipColorIndex(empty)).toBeNull()
    expect(withClipColorIndex(empty, palette(8))).toBe(empty)
  })

  it("rewrites only the segment's first ColorIndex", () => {
    const doubled = `${COLORED_SLOT}${COLORED_SLOT}`
    const painted = withClipColorIndex(doubled, palette(8))
    expect(
      [...painted.matchAll(/<ColorIndex Value="(\d+)"/g)].map(
        (match) => match[1]
      )
    ).toEqual(["8", "5"])
  })

  it("does not re-escape what already came escaped from the file", () => {
    // The name's `&amp;` passes through untouched — re-escaping would turn it
    // into `&amp;amp;`, the bug that hit 1,998 clips in the porter.
    expect(withClipColorIndex(COLORED_SLOT, palette(8))).toContain(
      'Value="Every Little Thing_(Y&amp;F)"'
    )
  })
})

describe("applyEdits", () => {
  it("with no edits returns the text identical", () => {
    expect(applyEdits("abcdef", [])).toBe("abcdef")
  })

  it("applies out of order without scrambling the result", () => {
    const result = applyEdits("0123456789", [
      { start: 6, end: 8, replacement: "X" },
      { start: 1, end: 3, replacement: "Y" },
    ])
    expect(result).toBe("0Y345X89")
  })

  it("refuses overlapping edits — a caller bug, not bad data", () => {
    expect(() =>
      applyEdits("0123456789", [
        { start: 1, end: 5, replacement: "" },
        { start: 3, end: 7, replacement: "" },
      ])
    ).toThrow(/overlapping/)
  })
})

describe("findSceneRanges", () => {
  it("finds one range per scene, in document order", () => {
    const xml = document(["A", "B", "C"])
    const ranges = findSceneRanges(xml)
    expect(ranges).toHaveLength(3)
    expect(xml.slice(ranges[1]!.start, ranges[1]!.end)).toContain('Value="B"')
  })

  it("also covers scenes with a body (v12 schema)", () => {
    const xml = `<Scenes>
      <Scene Id="1"><Name Value="A" /></Scene>
      <Scene Id="2" />
    </Scenes>`
    const ranges = findSceneRanges(xml)
    expect(ranges).toHaveLength(2)
    expect(xml.slice(ranges[0]!.start, ranges[0]!.end)).toContain("</Scene>")
  })
})

describe("findClipSlotLists", () => {
  it("ignores the inner ClipSlot without an Id", () => {
    const lists = findClipSlotLists(document(["A", "B", "C"]))
    // two tracks × (freeze + session) + the master's empty list
    const populated = lists.filter((list) => list.length > 0)
    expect(populated).toHaveLength(4)
    expect(populated.every((list) => list.length === 3)).toBe(true)
  })
})

describe("removeScenes", () => {
  it("keeps the grid: one slot per scene in every list", () => {
    const result = removeScenes(document(["A", "B", "C", "D"]), [1, 2])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const after = parseAlsDocument(result.xml)
    expect(after.scenes.map((scene) => scene.rawName)).toEqual(["A", "D"])
    expect(gridIsConsistent(after)).toBe(true)
    for (const trackAfter of after.tracks) {
      expect(trackAfter.sessionClips).toHaveLength(2)
    }
  })

  it("takes along the removed scene's clip, not the neighbor's", () => {
    const result = removeScenes(document(["A", "B", "C"]), [0])
    if (!result.ok) throw new Error(result.error)
    const after = parseAlsDocument(result.xml)
    const clipNames = after.tracks[0]!.sessionClips.map(
      (clip) => clip?.rawName ?? null
    )
    expect(clipNames).toEqual(["c1", "c2"])
  })

  it("an out-of-range index is an error, not a silent removal", () => {
    const result = removeScenes(document(["A", "B"]), [5])
    expect(result).toEqual({ ok: false, error: "scene 5 does not exist" })
  })

  it("an empty list returns the original XML byte for byte", () => {
    const xml = document(["A", "B"])
    const result = removeScenes(xml, [])
    expect(result.ok && result.xml).toBe(xml)
  })

  it("repeated indices count only once", () => {
    const result = removeScenes(document(["A", "B", "C"]), [1, 1, 1])
    if (!result.ok) throw new Error(result.error)
    expect(result.removed).toBe(1)
    expect(parseAlsDocument(result.xml).scenes).toHaveLength(2)
  })

  it("emptying everything still leaves a consistent file", () => {
    const result = removeScenes(document(["A", "B", "C"]), [0, 1, 2])
    if (!result.ok) throw new Error(result.error)
    const after = parseAlsDocument(result.xml)
    expect(after.scenes).toHaveLength(0)
    expect(after.tracks.every((item) => item.sessionClips.length === 0)).toBe(
      true
    )
  })
})
