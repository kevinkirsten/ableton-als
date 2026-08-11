import { gzipSync, gunzipSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import {
  applyAlsTools,
  convertAlsToV10,
  decodeAls,
  diagnoseAls,
  encodeAls,
} from "../../src/node.js"

// These tests exercise the Node edge: bytes in, bytes out. The algorithms
// themselves are covered by the core unit tests — here what matters is the
// gzip handling, the guards, the report shapes and the output naming.

function v12Document(body: string): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Ableton MajorVersion="5" MinorVersion="12.0_12402" Creator="Ableton Live 12.4.3">`,
    `<LiveSet>`,
    `<NextPointeeId Value="900" />`,
    `<Tracks>${body}</Tracks>`,
    `<MasterTrack><Tempo><Manual Value="120" /></Tempo><ClipSlotList /></MasterTrack>`,
    `<Scenes><Scene Id="1"><Name Value="A" /><Color Value="3" /><Tempo Value="120" /><IsTempoEnabled Value="false" /><TimeSignatureId Value="201" /><IsTimeSignatureEnabled Value="false" /></Scene></Scenes>`,
    `</LiveSet>`,
    `</Ableton>`,
  ].join("")
}

const TRACK = [
  `<AudioTrack Id="10">`,
  `<Name><EffectiveName Value="CUE" /></Name>`,
  `<DeviceChain>`,
  `<FreezeSequencer><ClipSlotList><ClipSlot Id="0"><ClipSlot><Value /></ClipSlot><HasStop Value="true" /></ClipSlot></ClipSlotList></FreezeSequencer>`,
  `<MainSequencer><ClipSlotList><ClipSlot Id="0"><ClipSlot><Value /></ClipSlot><HasStop Value="true" /></ClipSlot></ClipSlotList></MainSequencer>`,
  `</DeviceChain>`,
  `</AudioTrack>`,
].join("")

function gz(xml: string): Uint8Array {
  return new Uint8Array(gzipSync(Buffer.from(xml, "utf8")))
}

describe("decodeAls / encodeAls", () => {
  it("round-trips XML through gzip", () => {
    const xml = v12Document(TRACK)
    expect(decodeAls(encodeAls(xml))).toBe(xml)
  })
})

describe("diagnoseAls", () => {
  it("refuses bytes that are neither gzip nor XML", () => {
    const result = diagnoseAls({
      fileName: "x.als",
      bytes: new TextEncoder().encode("hello"),
    })
    expect(result).toEqual({ ok: false, error: "not_an_als" })
  })

  it("refuses an empty upload", () => {
    expect(diagnoseAls({ fileName: "x.als", bytes: new Uint8Array() })).toEqual(
      { ok: false, error: "empty_file" }
    )
  })

  it("diagnoses a gzipped v12 set: version, counts and the five tools", () => {
    const result = diagnoseAls({
      fileName: "song.als",
      bytes: gz(v12Document(TRACK)),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.version.major).toBe(12)
    expect(result.data.scenes).toBe(1)
    expect(result.data.tracks).toBe(1)
    expect(result.data.tools.map((tool) => tool.id)).toEqual([
      "pointeeIds",
      "rewarp",
      "mirrorTrack",
      "followActions",
      "relinkSamples",
    ])
    // relinkSamples is v10-only; on a v12 file it must come out blocked.
    const relink = result.data.tools.find(
      (tool) => tool.id === "relinkSamples"
    )!
    expect(relink.supported).toBe(false)
    expect(relink.blocked).toContain("Live 12")
  })

  it("also accepts an `.als` saved raw (not gzipped)", () => {
    const result = diagnoseAls({
      fileName: "raw.als",
      bytes: new TextEncoder().encode(v12Document(TRACK)),
    })
    expect(result.ok).toBe(true)
  })
})

describe("applyAlsTools", () => {
  const duplicated = v12Document(
    TRACK +
      `<ModulationTarget Id="7"><LockEnvelope Value="0" /></ModulationTarget>` +
      `<VolumeModulationTarget Id="7"><LockEnvelope Value="0" /></VolumeModulationTarget>`
  )

  it("fixes duplicated pointee Ids and returns the corrected bytes", () => {
    const result = applyAlsTools({
      fileName: "song.als",
      bytes: gz(duplicated),
      operations: [{ tool: "pointeeIds" }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.applied).toHaveLength(1)
    expect(result.data.failed).toHaveLength(0)
    expect(result.data.fileName).toBe("song [fix].als")
    const output = gunzipSync(result.data.bytes).toString("utf8")
    expect(output).toContain('<VolumeModulationTarget Id="900"')
    expect(output).toContain('<ModulationTarget Id="7"')
  })

  it("a forged operation on an unsupported version fails without touching the file", () => {
    const v10 = `<Ableton MajorVersion="5" MinorVersion="10.0_377" Creator="Ableton Live 10.1.43"><LiveSet><Tracks /><Scenes /></LiveSet></Ableton>`
    const result = applyAlsTools({
      fileName: "old.als",
      bytes: gz(v10),
      operations: [{ tool: "followActions" }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.applied).toHaveLength(0)
    expect(result.data.failed[0]!.error).toContain("Live 10")
  })

  it("refuses a request with no operations", () => {
    const result = applyAlsTools({
      fileName: "song.als",
      bytes: gz(duplicated),
      operations: [],
    })
    expect(result).toEqual({ ok: false, error: "no_operations" })
  })

  it("sanitizes the output name — it goes into a Content-Disposition header", () => {
    const result = applyAlsTools({
      fileName: 'we/sing: "holy".als',
      bytes: gz(duplicated),
      operations: [{ tool: "pointeeIds" }],
    })
    expect(result.ok && result.data.fileName).toBe(
      'we_sing_ _holy_ [fix].als'
    )
  })
})

describe("convertAlsToV10", () => {
  it("converts a v12 set and reports what happened", () => {
    const result = convertAlsToV10({
      fileName: "song.als",
      bytes: gz(v12Document(TRACK)),
      libraryRoot: "/library",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.fileName).toBe("song [v10].als")
    expect(result.data.sourceVersion).toBe(12)
    expect(result.data.alreadyV10).toBe(false)
    expect(result.data.scenesConverted).toBe(1)
    const output = gunzipSync(result.data.bytes).toString("utf8")
    expect(output).toContain('MinorVersion="10.0_377"')
    expect(output).not.toContain("12.0_12402")
  })

  it("refuses what is not a Live file", () => {
    expect(
      convertAlsToV10({
        fileName: "x.als",
        bytes: new TextEncoder().encode("<html></html>"),
        libraryRoot: "/library",
      })
    ).toEqual({ ok: false, error: "not_an_als" })
  })
})
