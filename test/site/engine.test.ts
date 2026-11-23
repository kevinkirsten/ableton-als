import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { validateGeneratedSet } from "../../src/index.js"
import { decodeAls } from "../../src/node.js"
import {
  checkDocument,
  guessLibraryRoot,
  inspect,
  looksGzipped,
  outputName,
  prettyXml,
  Session,
  type FileRefView,
  type PrettyLine,
} from "../../site/src/engine.js"
import {
  buildDamagedSampleSet,
  DAMAGED_FILE_NAME,
  SAMPLE_FILE_NAME,
  SAMPLE_LIBRARY_ROOT,
  SAMPLE_MIRROR_BASE,
  SAMPLE_MIRROR_TARGET,
} from "../../site/src/sample-set.js"

// The sample the page opens: a set saved by Live 12.4.3 (site/sample/).
const SAMPLE = decodeAls(
  readFileSync(new URL("../../site/sample/Demo Set.als", import.meta.url))
)

const open = (xml = SAMPLE): Session =>
  new Session(SAMPLE_FILE_NAME, xml, 1234, "sample")

const asText = (line: PrettyLine): string =>
  typeof line === "string" ? line : `${line.indent}${line.head}`

describe("opening a file", () => {
  it("recognizes gzip by its magic number, not by a file name", () => {
    expect(looksGzipped(new Uint8Array([0x1f, 0x8b, 0x08]))).toBe(true)
    expect(looksGzipped(new Uint8Array([0x3c, 0x3f, 0x78]))).toBe(false)
    expect(looksGzipped(new Uint8Array([]))).toBe(false)
  })

  it("accepts a Live document and names what is wrong with anything else", () => {
    expect(checkDocument(SAMPLE)).toBeNull()
    expect(checkDocument("<html><body>not a set</body></html>")).toBe(
      "not_a_live_set"
    )
  })
})

describe("inspect", () => {
  const inspection = inspect(SAMPLE, {
    fileName: SAMPLE_FILE_NAME,
    sizeBytes: 1234,
  })

  it("reports what the library parsed", () => {
    expect(inspection.version.major).toBe(12)
    expect(inspection.tracks).toHaveLength(11)
    expect(inspection.scenes).toHaveLength(12)
    expect(inspection.audioClips + inspection.midiClips).toBe(64)
    expect(inspection.gridConsistent).toBe(true)
    expect(inspection.problems).toEqual([])
    expect(inspection.convert).toEqual({ state: "ready" })
  })

  it("gives every clip a palette colour and every audio clip its file", () => {
    const clips = inspection.tracks.flatMap((track) =>
      track.clips.filter((clip) => clip !== null)
    )
    expect(
      clips.every((clip) => /^#[0-9A-F]{6}$/i.test(clip.color ?? ""))
    ).toBe(true)
    const audio = clips.filter((clip) => clip.kind === "audio")
    expect(audio).toHaveLength(56)
    expect(audio.every((clip) => clip.sample?.endsWith(".wav"))).toBe(true)
  })

  it("reads scene tempo and time signature only where they are enabled", () => {
    expect(inspection.scenes[0]).toMatchObject({ bpm: 120, signature: "4/4" })
    expect(inspection.scenes[1]).toMatchObject({ bpm: null, signature: null })
    expect(inspection.scenes[7]).toMatchObject({ bpm: 90, signature: "6/8" })
  })

  it("shows a scene name Live wrote with single quotes", () => {
    expect(inspection.scenes.map((scene) => scene.name)).toContain(
      'INTERLUDE "B"'
    )
  })

  it("lists each referenced audio file once, with how often it is used", () => {
    const audio = inspection.files.filter((file) => file.audio)
    expect(audio).toHaveLength(10)
    expect(audio.reduce((sum, file) => sum + file.refs, 0)).toBe(56)
    expect(audio.every((file) => file.external)).toBe(true)
  })

  it("guesses the library folder despite a stray file elsewhere on the disk", () => {
    expect(inspection.libraryRootGuess).toBe(SAMPLE_LIBRARY_ROOT)
  })

  it("diagnoses each repair from the library's own inspection", () => {
    const byId = new Map(inspection.tools.map((tool) => [tool.id, tool]))
    expect(byId.get("pointeeIds")).toMatchObject({ pending: 0, blocked: null })
    expect(byId.get("rewarp")).toMatchObject({ pending: 56, blocked: null })
    // GUITAR and DRUMS disagree on length until the mirror runs.
    expect(byId.get("followActions")?.blocked).toEqual({
      code: "mixed_clip_durations",
      values: { count: 5 },
    })
    // Relinking rewrites Live 10 references, and this is a Live 12 set.
    expect(byId.get("relinkSamples")?.blocked?.code).toBe("unsupported_version")
  })

  it("states facts as data, never as English", () => {
    const rewarp = inspection.tools.find((tool) => tool.id === "rewarp")!
    expect(rewarp.facts).toContainEqual({
      label: { key: "clipsWarpedAt" },
      value: { byBpm: [[60, 54], [160, 2]] },
    })
    expect(rewarp.facts).toContainEqual({
      label: { key: "gridBpm" },
      value: 60,
    })
  })
})

describe("guessLibraryRoot", () => {
  const file = (path: string): FileRefView => ({
    name: path.split("/").pop()!,
    folder: path.slice(0, path.lastIndexOf("/")),
    path,
    refs: 1,
    audio: true,
    external: path.startsWith("/Volumes/"),
    hasAlias: false,
  })

  it("is empty when the set states no absolute audio path", () => {
    expect(guessLibraryRoot([])).toBe("")
  })

  it("picks the deepest folder holding four fifths of the audio", () => {
    const files = [
      "/Volumes/Disk/Lib/A/1.wav",
      "/Volumes/Disk/Lib/A/2.wav",
      "/Volumes/Disk/Lib/B/3.wav",
      "/Volumes/Disk/Lib/B/4.wav",
      "/Volumes/Elsewhere/5.wav",
    ].map(file)
    expect(guessLibraryRoot(files)).toBe("/Volumes/Disk/Lib")
  })
})

describe("Session", () => {
  it("offers nothing for download until something changed", () => {
    expect(open().state().output.blocked).toEqual({ reason: "unchanged" })
  })

  it("applies a repair as a step, with before and after, and undoes it", () => {
    const session = open()
    expect(session.applyTool({ tool: "rewarp", bpm: 120 })).toEqual({ ok: true })

    const state = session.state()
    expect(state.steps).toHaveLength(1)
    const step = state.steps[0]!
    if (step.kind !== "tool") throw new Error("expected a tool step")
    expect(step).toMatchObject({ tool: "rewarp", changed: 56 })
    expect(step.changes).toContainEqual({
      label: { key: "gridBpm" },
      before: 60,
      after: 120,
    })
    // The sample Live saved is a file like any other: it downloads.
    expect(state.output).toEqual({ name: "Demo Set [fix].als", blocked: null })

    session.undo()
    expect(session.state().steps).toHaveLength(0)
    expect(session.xml).toBe(SAMPLE)
  })

  it("refuses a repair that has nothing to do, leaving the document alone", () => {
    const session = open()
    const result = session.applyTool({ tool: "pointeeIds" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.refusal.code).toBe("nothing_to_change")
    expect(session.xml).toBe(SAMPLE)
    expect(session.state().steps).toHaveLength(0)
  })

  it("mirrors the pair of tracks the sample sets up to differ", () => {
    const session = open()
    expect(
      session.previewMirror(SAMPLE_MIRROR_BASE, SAMPLE_MIRROR_TARGET).differing
    ).toBe(5)
    // The page seeds its two selects with these names.
    expect([SAMPLE_MIRROR_BASE, SAMPLE_MIRROR_TARGET]).toEqual([
      "DRUMS",
      "GUITAR",
    ])
    expect(
      session.applyTool({
        tool: "mirrorTrack",
        base: SAMPLE_MIRROR_BASE,
        target: SAMPLE_MIRROR_TARGET,
      })
    ).toEqual({ ok: true })
    expect(
      session.previewMirror(SAMPLE_MIRROR_BASE, SAMPLE_MIRROR_TARGET).differing
    ).toBe(0)
  })

  it("runs every repair the sample needs, in order, and stays valid", () => {
    const session = open()
    expect(session.applyTool({ tool: "rewarp", bpm: 120 }).ok).toBe(true)
    expect(
      session.applyTool({
        tool: "mirrorTrack",
        base: SAMPLE_MIRROR_BASE,
        target: SAMPLE_MIRROR_TARGET,
      }).ok
    ).toBe(true)
    expect(session.applyTool({ tool: "followActions" }).ok).toBe(true)
    const state = session.state()
    expect(state.inspection.problems).toEqual([])
    expect(
      state.inspection.tools.every(
        (tool) => tool.blocked !== null || tool.pending === 0
      )
    ).toBe(true)
  })

  it("converts to Live 10 and reports what it measured on the result", () => {
    const session = open()
    expect(session.convert(SAMPLE_LIBRARY_ROOT)).toEqual({ ok: true })

    const state = session.state()
    expect(state.inspection.version.major).toBe(10)
    expect(state.inspection.convert).toEqual({ state: "already_v10" })
    expect(state.output).toEqual({ name: "Demo Set [v10].als", blocked: null })
    expect(validateGeneratedSet(session.xml)).toEqual([])

    const step = state.steps[0]!
    if (step.kind !== "convert") throw new Error("expected a conversion step")
    const report = step.report
    expect(report.scenesConverted).toBe(12)
    expect(report.problems).toEqual([])
    expect(report.warnings.map((warning) => warning.code).sort()).toEqual([
      "jump_follow_action",
      "samples_outside_root",
    ])
    expect(report.aliases).toEqual({ withRecord: 56, audioRefs: 56, offVolume: 0 })
    expect(report.changes).toContainEqual({
      label: { key: "sceneName", scene: 1 },
      before: "COUNT IN",
      after: "COUNT IN 120BPM 4/4",
    })
    expect(report.tagDeltas.some((delta) => delta.tag === "NeedRefreeze")).toBe(
      true
    )
    expect(report.excerpts.map((excerpt) => excerpt.title)).toEqual([
      { key: "header" },
      { key: "scene", scene: 1 },
      { key: "firstAudioRef" },
    ])
    expect(state.inspection.audioClips + state.inspection.midiClips).toBe(64)
  })

  it("writes alias records that resolve on any Mac volume format", () => {
    // MEASURED: the default volume attributes resolve on exFAT only; this
    // value resolved on exFAT, HFS+ and APFS in Live 10.1.43. A browser
    // cannot tell which one the visitor's disk is, so the page uses it.
    const session = open()
    session.convert(SAMPLE_LIBRARY_ROOT)
    const records = [...session.xml.matchAll(/<Data>([\s\S]*?)<\/Data>/g)]
      .map((match) => match[1]!.replace(/\s+/g, ""))
      .filter((hex) => hex !== "")
    expect(records).toHaveLength(56)
    expect(records.every((hex) => hex.slice(268, 276) === "00000D02")).toBe(true)
  })

  it("relinks samples once the set is in the Live 10 format", () => {
    const session = open()
    const early = session.applyTool({
      tool: "relinkSamples",
      libraryRoot: "/Volumes/B/Library",
    })
    expect(early.ok).toBe(false)
    session.convert(SAMPLE_LIBRARY_ROOT)
    expect(
      session.applyTool({
        tool: "relinkSamples",
        libraryRoot: "/Volumes/Second Disk/Library",
      })
    ).toEqual({ ok: true })
    const audio = session
      .state()
      .inspection.files.filter((file) => file.audio)
      .map((file) => file.path ?? "")
    expect(
      audio.filter((path) => path.startsWith("/Volumes/Second Disk/Library/"))
    ).toHaveLength(9)
  })

  it("refuses to convert twice, and refuses a relative relink folder", () => {
    const session = open()
    session.convert(SAMPLE_LIBRARY_ROOT)
    const again = session.convert(SAMPLE_LIBRARY_ROOT)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.refusal.code).toBe("already_v10")
    const relative = session.applyTool({
      tool: "relinkSamples",
      libraryRoot: "Library",
    })
    expect(relative.ok).toBe(false)
    if (!relative.ok) expect(relative.refusal.code).toBe("relative_library_root")
  })

  it("never offers a file made from the damaged sample", () => {
    const session = new Session(
      DAMAGED_FILE_NAME,
      buildDamagedSampleSet(SAMPLE),
      1,
      "damaged"
    )
    expect(session.state().inspection.problems.length).toBe(6)
    session.applyTool({ tool: "pointeeIds" })
    expect(session.state().output.blocked).toEqual({ reason: "damaged" })
  })

  it("does not offer a converted set that fails validation", () => {
    const session = new Session("Broken.als", buildDamagedSampleSet(SAMPLE), 1)
    session.convert(SAMPLE_LIBRARY_ROOT)
    expect(session.state().output.blocked?.reason).toBe("invalid")
  })

  it("goes back to the original in one move", () => {
    const session = open()
    session.applyTool({ tool: "rewarp", bpm: 120 })
    session.convert(SAMPLE_LIBRARY_ROOT)
    session.reset()
    expect(session.xml).toBe(SAMPLE)
    expect(session.state().steps).toEqual([])
    expect(session.state().canUndo).toBe(false)
  })
})

describe("outputName", () => {
  it("never reuses the name of the file that was opened", () => {
    expect(outputName("Song.als", true)).toBe("Song [v10].als")
    expect(outputName("Song.als", false)).toBe("Song [fix].als")
    expect(outputName("a/b:c.als", false)).toBe("a_b_c [fix].als")
    expect(outputName(".als", true)).toBe("converted [v10].als")
  })
})

describe("prettyXml", () => {
  it("indents nested elements and shortens long hex payloads", () => {
    const pretty = prettyXml(
      `<FileRef><Name Value="a.wav" /><Data>${"AB".repeat(60)}</Data></FileRef>`
    )
    expect(pretty.hiddenLines).toBe(0)
    expect(pretty.lines).toEqual([
      "<FileRef>",
      '  <Name Value="a.wav" />',
      "  <Data>",
      { indent: "    ", head: "AB".repeat(24), hexChars: 120 },
      "  </Data>",
      "</FileRef>",
    ])
  })

  it("says how many lines it left out", () => {
    const many = `<A>${"<B />".repeat(40)}</A>`
    const pretty = prettyXml(many, 10)
    expect(pretty.lines).toHaveLength(9)
    expect(pretty.hiddenLines).toBe(33)
    expect(pretty.lines.map(asText)[0]).toBe("<A>")
  })
})
