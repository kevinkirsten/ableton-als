import { describe, expect, it } from "vitest"
import { validateGeneratedSet } from "../../src/index.js"
import {
  checkDocument,
  guessLibraryRoot,
  inspect,
  looksGzipped,
  outputName,
  prettyXml,
  Session,
  type FileRefView,
} from "../../site/src/engine.js"
import { describe as describeMessage, WORDED_CODES } from "../../site/src/messages.js"
import {
  buildDamagedSampleSet,
  buildSampleSet,
  DAMAGED_FILE_NAME,
  SAMPLE_FILE_NAME,
  SAMPLE_LIBRARY_ROOT,
  SAMPLE_MIRROR_BASE,
  SAMPLE_MIRROR_TARGET,
} from "../../site/src/sample.js"

const open = (xml = buildSampleSet(), synthetic = false): Session =>
  new Session(SAMPLE_FILE_NAME, xml, 1234, synthetic)

describe("opening a file", () => {
  it("recognizes gzip by its magic number, not by a file name", () => {
    expect(looksGzipped(new Uint8Array([0x1f, 0x8b, 0x08]))).toBe(true)
    expect(looksGzipped(new Uint8Array([0x3c, 0x3f, 0x78]))).toBe(false)
    expect(looksGzipped(new Uint8Array([]))).toBe(false)
  })

  it("accepts a Live document and names what is wrong with anything else", () => {
    expect(checkDocument(buildSampleSet())).toBeNull()
    expect(checkDocument("<html><body>not a set</body></html>")).toBe(
      "not_a_live_set"
    )
  })
})

describe("inspect", () => {
  const inspection = inspect(buildSampleSet(), {
    fileName: SAMPLE_FILE_NAME,
    sizeBytes: 1234,
  })

  it("reports what the library parsed", () => {
    expect(inspection.version.major).toBe(12)
    expect(inspection.tracks).toHaveLength(8)
    expect(inspection.scenes).toHaveLength(12)
    expect(inspection.audioClips + inspection.midiClips).toBe(61)
    expect(inspection.gridConsistent).toBe(true)
    expect(inspection.problems).toEqual([])
    expect(inspection.convert).toEqual({ state: "ready" })
  })

  it("gives every clip a palette colour and audio clips their file", () => {
    const clips = inspection.tracks.flatMap((track) =>
      track.clips.filter((clip) => clip !== null)
    )
    expect(clips.every((clip) => /^#[0-9A-F]{6}$/i.test(clip.color ?? ""))).toBe(
      true
    )
    const audio = clips.filter((clip) => clip.kind === "audio")
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

  it("lists each referenced file once, with how often it is used", () => {
    const uses = inspection.files.reduce((sum, file) => sum + file.refs, 0)
    expect(uses).toBe(inspection.audioClips)
    expect(inspection.files.every((file) => file.external)).toBe(true)
    expect(new Set(inspection.files.map((file) => file.path)).size).toBe(
      inspection.files.length
    )
  })

  it("guesses the library folder despite a stray file on another disk", () => {
    expect(inspection.libraryRootGuess).toBe(SAMPLE_LIBRARY_ROOT)
  })

  it("diagnoses each repair from the library's own inspection", () => {
    const byId = new Map(inspection.tools.map((tool) => [tool.id, tool]))
    expect(byId.get("pointeeIds")).toMatchObject({ pending: 6, blocked: null })
    expect(byId.get("rewarp")).toMatchObject({ pending: 55, blocked: null })
    expect(byId.get("followActions")?.pending).toBeGreaterThan(0)
    // Relinking rewrites Live 10 references, and this is a Live 12 set.
    expect(byId.get("relinkSamples")?.blocked?.code).toBe("unsupported_version")
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
    expect(open().state().output.blocked?.reason).toBe("unchanged")
  })

  it("applies a repair as a step, with before and after, and undoes it", () => {
    const session = open()
    expect(session.applyTool({ tool: "pointeeIds" })).toEqual({ ok: true })

    const state = session.state()
    expect(state.steps).toHaveLength(1)
    expect(state.steps[0]).toMatchObject({ kind: "tool", tool: "pointeeIds" })
    const step = state.steps[0]!
    if (step.kind !== "tool") throw new Error("expected a tool step")
    expect(step.changes).toContainEqual({
      label: "Duplicated Ids",
      before: "6",
      after: "0",
    })
    expect(state.output).toEqual({ name: "Demo Set [fix].als", blocked: null })

    session.undo()
    expect(session.state().steps).toHaveLength(0)
    expect(session.xml).toBe(buildSampleSet())
  })

  it("refuses a repair that has nothing to do, leaving the document alone", () => {
    const session = open()
    session.applyTool({ tool: "pointeeIds" })
    const before = session.xml
    expect(session.applyTool({ tool: "pointeeIds" }).ok).toBe(false)
    expect(session.xml).toBe(before)
    expect(session.state().steps).toHaveLength(1)
  })

  it("mirrors the pair of tracks the sample plants a difference between", () => {
    const session = open()
    const preview = session.previewMirror(
      SAMPLE_MIRROR_BASE,
      SAMPLE_MIRROR_TARGET
    )
    expect(preview.differing).toBeGreaterThan(0)
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
    expect(report.aliases).toEqual({ withRecord: 55, audioRefs: 55, offVolume: 0 })
    expect(report.changes).toContainEqual({
      label: "Scene 1 name",
      before: "COUNT IN",
      after: "COUNT IN 120BPM 4/4",
    })
    expect(report.tagDeltas.some((delta) => delta.tag === "NeedRefreeze")).toBe(
      true
    )
    expect(report.excerpts.map((excerpt) => excerpt.title)).toEqual([
      "Document header",
      "Scene 1",
      "First audio reference",
    ])
    // The converted set keeps its clips, colours and file names.
    expect(state.inspection.audioClips + state.inspection.midiClips).toBe(61)
    expect(state.inspection.files.every((file) => file.hasAlias)).toBe(true)
  })

  it("relinks samples once the set is in the Live 10 format", () => {
    const session = open()
    expect(
      session.applyTool({ tool: "relinkSamples", libraryRoot: "/Volumes/B/Library" })
        .ok
    ).toBe(false)
    session.convert(SAMPLE_LIBRARY_ROOT)
    expect(
      session.applyTool({
        tool: "relinkSamples",
        libraryRoot: "/Volumes/Second Disk/Library",
      })
    ).toEqual({ ok: true })
    const paths = session.state().inspection.files.map((file) => file.path ?? "")
    expect(
      paths.filter((path) => path.startsWith("/Volumes/Second Disk/Library/"))
    ).toHaveLength(paths.length - 1)
  })

  it("refuses to convert twice, and refuses a relative relink folder", () => {
    const session = open()
    session.convert(SAMPLE_LIBRARY_ROOT)
    expect(session.convert(SAMPLE_LIBRARY_ROOT).ok).toBe(false)
    expect(
      session.applyTool({ tool: "relinkSamples", libraryRoot: "Library" }).ok
    ).toBe(false)
  })

  it("does not offer a converted set that fails validation", () => {
    const session = new Session(DAMAGED_FILE_NAME, buildDamagedSampleSet(), 1)
    expect(session.state().inspection.problems.length).toBeGreaterThanOrEqual(3)
    session.convert(SAMPLE_LIBRARY_ROOT)
    expect(session.state().output.blocked?.reason).toBe("invalid")
  })

  it("never offers the synthetic sample's result as a file", () => {
    const session = open(buildSampleSet(), true)
    session.convert(SAMPLE_LIBRARY_ROOT)
    expect(session.state().output.blocked?.reason).toBe("synthetic")
  })

  it("goes back to the original in one move", () => {
    const session = open()
    session.applyTool({ tool: "pointeeIds" })
    session.applyTool({ tool: "rewarp", bpm: 120 })
    session.reset()
    expect(session.xml).toBe(buildSampleSet())
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
    expect(pretty.split("\n")).toEqual([
      "<FileRef>",
      '  <Name Value="a.wav" />',
      "  <Data>",
      `    ${"AB".repeat(24)}… (120 hex chars)`,
      "  </Data>",
      "</FileRef>",
    ])
  })

  it("says how many lines it left out", () => {
    const many = `<A>${"<B />".repeat(40)}</A>`
    const lines = prettyXml(many, 10).split("\n")
    expect(lines).toHaveLength(10)
    expect(lines[9]).toBe("… 33 more lines")
  })
})

describe("the page's wording", () => {
  it("covers every code the damaged sample and the conversion produce", () => {
    const session = new Session(DAMAGED_FILE_NAME, buildDamagedSampleSet(), 1)
    const codes = session.state().inspection.problems.map((p) => p.code)
    expect(codes.length).toBeGreaterThan(0)
    for (const code of codes) expect(WORDED_CODES).toContain(code)
  })

  it("puts the values into the sentence, with no dash left over", () => {
    const sentences = validateGeneratedSet(buildDamagedSampleSet()).map(
      describeMessage
    )
    expect(sentences.some((text) => text.includes("BASS"))).toBe(true)
    for (const text of sentences) {
      expect(text).not.toMatch(/\u2014|\u2013|undefined/)
    }
  })

  it("falls back to the library's prose for a code it does not know", () => {
    expect(
      describeMessage({ code: "from_the_future", values: {}, detail: "something new" })
    ).toBe("Something new.")
  })
})
