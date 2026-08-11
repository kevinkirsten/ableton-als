import { describe, expect, it } from "vitest"
import { parseAlsDocument } from "../../src/core/document.js"
import {
  downgradeToV10,
  majorVersionOf,
  toV10Chance,
  v10SceneName,
} from "../../src/core/downgrade.js"

// A scene in the v12 shape: name in `<Name>`, tempo and time signature in
// structured fields.
function sceneV12(options: {
  readonly id: number
  readonly name: string
  readonly tempo?: number
  readonly timeSignatureId?: number
  readonly color?: number
}): string {
  return `<Scene Id="${options.id}">
        <KeyMidi><PersistentKeyString Value="" /></KeyMidi>
        <FollowAction>
          <FollowTime Value="4" />
          <IsLinked Value="true" />
          <FollowActionA Value="0" />
          <FollowActionEnabled Value="false" />
        </FollowAction>
        <Name Value="${options.name}" />
        <Annotation Value="" />
        <Color Value="${options.color ?? 13}" />
        <Tempo Value="${options.tempo ?? 120}" />
        <IsTempoEnabled Value="${options.tempo !== undefined}" />
        <TimeSignatureId Value="${options.timeSignatureId ?? 201}" />
        <IsTimeSignatureEnabled Value="${options.timeSignatureId !== undefined}" />
        <LomId Value="0" />
        <ClipSlotsListWrapper LomId="0" />
      </Scene>`
}

function documentV12(scenes: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12402" SchemaChangeCount="5" Creator="Ableton Live 12.4.3" Revision="abc">
  <LiveSet>
    <NextPointeeId Value="900" />
    <Tracks />
    <MasterTrack><Tempo><Manual Value="120" /></Tempo><ClipSlotList /></MasterTrack>
    <Scenes>${scenes.join("")}</Scenes>
  </LiveSet>
</Ableton>`
}

describe("majorVersionOf", () => {
  it("reads the version declared in the header", () => {
    expect(majorVersionOf(documentV12([]))).toBe(12)
    expect(
      majorVersionOf('<Ableton MajorVersion="5" MinorVersion="10.0_377" />')
    ).toBe(10)
    expect(majorVersionOf("<html />")).toBeNull()
  })
})

describe("v10SceneName", () => {
  it("puts tempo and time signature back into the text, where v10 reads them", () => {
    const body = `<Tempo Value="135" /><IsTempoEnabled Value="true" /><TimeSignatureId Value="201" /><IsTimeSignatureEnabled Value="true" />`
    expect(v10SceneName("CLICK - ", body)).toBe("CLICK - 135BPM 4/4")
  })

  it("time signature without tempo (the library click)", () => {
    const body = `<Tempo Value="120" /><IsTempoEnabled Value="false" /><TimeSignatureId Value="201" /><IsTimeSignatureEnabled Value="true" />`
    // Two spaces: v12 preserved them where the token was, and that is how
    // Ableton itself writes it back.
    expect(v10SceneName("CLICK  ", body)).toBe("CLICK  4/4")
  })

  it("3/4 and 6/8 come out right", () => {
    const threeFour = `<IsTempoEnabled Value="false" /><TimeSignatureId Value="200" /><IsTimeSignatureEnabled Value="true" />`
    expect(v10SceneName("CLICK", threeFour)).toBe("CLICK 3/4")
    const sixEight = `<IsTempoEnabled Value="false" /><TimeSignatureId Value="302" /><IsTimeSignatureEnabled Value="true" />`
    expect(v10SceneName("CLICK", sixEight)).toBe("CLICK 6/8")
  })

  it("a fractional tempo does not become a repeating decimal in the name", () => {
    const body = `<Tempo Value="135.5" /><IsTempoEnabled Value="true" />`
    expect(v10SceneName("X", body)).toBe("X 135.5BPM")
  })

  it("a scene with neither tempo nor time signature keeps just the name", () => {
    expect(v10SceneName("SETLIST ABOVE", "")).toBe("SETLIST ABOVE")
  })
})

describe("v10SceneName — real cases from the v10/v12 pair", () => {
  // Each row came from a real set saved in both Live versions: on the left
  // what v12 left in the <Name>, on the right what Ableton writes in v10. v12
  // erases the tokens but keeps the punctuation, and the punctuation is what
  // says where to put them back.
  const body = (tempo: number | null, timeSignatureId: number | null): string =>
    [
      `<Tempo Value="${tempo ?? 120}" />`,
      `<IsTempoEnabled Value="${tempo !== null}" />`,
      `<TimeSignatureId Value="${timeSignatureId ?? 201}" />`,
      `<IsTimeSignatureEnabled Value="${timeSignatureId !== null}" />`,
    ].join("")

  it.each([
    ["CLICK  ", null, 201, "CLICK  4/4"],
    ["CLICK  ", null, 302, "CLICK  6/8"],
    ["CLICK  (slow 3/4)", null, 203, "CLICK 6/4 (slow 3/4)"],
    ["CLICK  (DOUBLETIME)", null, 201, "CLICK 4/4 (DOUBLETIME)"],
    ["PREROLL CLICK  ;", 126, 201, "PREROLL CLICK  4/4;126 BPM"],
    ["CLICK ;", 131, 201, "CLICK 4/4;131 BPM"],
    [
      "WEIGHT UPON THE WAVES;; [2]",
      131,
      201,
      "WEIGHT UPON THE WAVES;4/4;131 BPM [2]",
    ],
    ["PTLHA;; [2]", 145, 201, "PTLHA;4/4;145 BPM [2]"],
    ["CLICK -  ", 136, 201, "CLICK - 136BPM 4/4"],
    ["SETLIST ABOVE", null, null, "SETLIST ABOVE"],
  ])("%s → %s", (name, tempo, signature, expected) => {
    expect(v10SceneName(name, body(tempo, signature))).toBe(expected)
  })

  it("never glues the token onto the name — Live would not read the time signature there", () => {
    // "WHAT A BEAUTIFUL NAME4/4" programs no time signature at all.
    const result = v10SceneName(
      "WHAT A BEAUTIFUL NAME; ; ;  [4]",
      body(136, 201)
    )
    expect(result).not.toMatch(/[A-Za-z]\d+\//)
    expect(result).toContain("4/4")
    expect(result).toContain("136")
  })
})

describe("downgradeToV10", () => {
  it("a file that is already v10 passes untouched", () => {
    const xml = '<Ableton MajorVersion="5" MinorVersion="10.0_377" />'
    const result = downgradeToV10(xml)
    expect(result).toEqual({
      ok: true,
      xml,
      scenesConverted: 0,
      warnings: [],
    })
  })

  it("the header becomes Live 10's", () => {
    const result = downgradeToV10(documentV12([sceneV12({ id: 1, name: "A" })]))
    if (!result.ok) throw new Error(result.error)
    expect(result.xml).toContain('MinorVersion="10.0_377"')
    expect(result.xml).toContain('Creator="Ableton Live 10.1.43"')
    expect(result.xml).not.toContain("12.0_12402")
  })

  it("the name goes back into the Scene attribute, with tempo and time signature", () => {
    const result = downgradeToV10(
      documentV12([
        sceneV12({ id: 1, name: "CLICK - ", tempo: 135, timeSignatureId: 201 }),
        sceneV12({ id: 2, name: "SETLIST ABOVE" }),
      ])
    )
    if (!result.ok) throw new Error(result.error)

    const document = parseAlsDocument(result.xml)
    expect(document.sceneSchema).toBe("v10")
    expect(document.scenes.map((scene) => scene.rawName)).toEqual([
      "CLICK - 135BPM 4/4",
      "SETLIST ABOVE",
    ])
    expect(result.scenesConverted).toBe(2)
  })

  it("the v12-only fields disappear from the Scene", () => {
    const result = downgradeToV10(
      documentV12([sceneV12({ id: 1, name: "A", tempo: 135 })])
    )
    if (!result.ok) throw new Error(result.error)
    const scene = result.xml.slice(
      result.xml.indexOf("<Scene "),
      result.xml.indexOf("</Scene>")
    )
    expect(scene).not.toContain("<FollowAction>")
    expect(scene).not.toContain("<Tempo ")
    expect(scene).not.toContain("<IsTempoEnabled")
    expect(scene).not.toContain("<TimeSignatureId")
    expect(scene).not.toContain("<Name Value=")
  })

  it("a scene's Color becomes ColorIndex with the +140 shift", () => {
    // Measured on the calibration pair: v12's Color 13 = v10's ColorIndex 153.
    const result = downgradeToV10(
      documentV12([sceneV12({ id: 1, name: "A", color: 42 })])
    )
    if (!result.ok) throw new Error(result.error)
    expect(result.xml).toContain('<ColorIndex Value="182" />')
    expect(result.xml).not.toContain("<Color Value=")
  })

  it("XML without a Live header is refused", () => {
    expect(downgradeToV10("<html></html>")).toEqual({
      ok: false,
      error: "not a Live file",
    })
  })
})

describe("toV10Chance", () => {
  it("100% becomes the 1:0 ratio — that is how the calibration pair matched", () => {
    expect(toV10Chance(100, 0)).toEqual({ a: 1, b: 0 })
  })

  it("fifty-fifty becomes 1:1", () => {
    expect(toV10Chance(50, 50)).toEqual({ a: 1, b: 1 })
  })

  it("75% becomes 3:1", () => {
    expect(toV10Chance(75, 25)).toEqual({ a: 3, b: 1 })
  })

  it("with no chance B declared, completes to 100", () => {
    expect(toV10Chance(80, 0)).toEqual({ a: 4, b: 1 })
  })
})

describe("convertFollowActions", () => {
  function clipWith(follow: string): string {
    return `<Ableton MajorVersion="5" MinorVersion="12.0_12402" Creator="Ableton Live 12.4.3"><LiveSet><Tracks><AudioClip Id="1">${follow}</AudioClip></Tracks><Scenes /></LiveSet></Ableton>`
  }
  const block = (options: {
    readonly action: number
    readonly enabled: boolean
    readonly chance?: number
  }): string =>
    `<FollowAction><FollowTime Value="8" /><IsLinked Value="false" /><LoopIterations Value="1" /><FollowActionA Value="${options.action}" /><FollowActionB Value="0" /><FollowChanceA Value="${options.chance ?? 100}" /><FollowChanceB Value="0" /><JumpIndexA Value="1" /><JumpIndexB Value="1" /><FollowActionEnabled Value="${options.enabled}" /></FollowAction>`

  it("disabled becomes v10's code 0, not the value that was there", () => {
    // v12 leaves 4/Next in the field even when disabled; copying that would
    // make the scene advance on its own in the middle of a performance.
    const result = downgradeToV10(
      clipWith(block({ action: 4, enabled: false }))
    )
    if (!result.ok) throw new Error(result.error)
    expect(result.xml).toContain('<FollowActionA Value="0" />')
    expect(result.xml).not.toContain("<FollowAction>")
  })

  it("codes 1 through 8 pass unchanged", () => {
    for (const action of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const result = downgradeToV10(clipWith(block({ action, enabled: true })))
      if (!result.ok) throw new Error(result.error)
      expect(result.xml).toContain(`<FollowActionA Value="${action}" />`)
    }
  })

  it("the block becomes flat fields, with the time preserved", () => {
    const result = downgradeToV10(clipWith(block({ action: 2, enabled: true })))
    if (!result.ok) throw new Error(result.error)
    expect(result.xml).toContain('<FollowTime Value="8" />')
    expect(result.xml).toContain('<FollowChanceA Value="1" />')
    expect(result.xml).not.toContain("<FollowActionEnabled")
    expect(result.xml).not.toContain("<JumpIndexA")
  })

  it('"Jump" does not exist in v10: it becomes No Action AND warns', () => {
    const result = downgradeToV10(clipWith(block({ action: 9, enabled: true })))
    if (!result.ok) throw new Error(result.error)
    expect(result.xml).toContain('<FollowActionA Value="0" />')
    expect(result.warnings.map((item) => item.kind)).toContain("follow_action")
  })
})

describe("convertFileRefs", () => {
  const ROOT = "/Volumes/Samples/TRACKS Project"
  function documentWithSample(path: string): string {
    return `<Ableton MajorVersion="5" MinorVersion="12.0_12402" Creator="Ableton Live 12.4.3"><LiveSet><Tracks><SampleRef><FileRef><RelativePathType Value="1" /><RelativePath Value="../x.wav" /><Path Value="${path}" /><Type Value="2" /><LivePackName Value="" /><LivePackId Value="" /><OriginalFileSize Value="4102590" /><OriginalCrc Value="51450" /><SourceHint Value="" /></FileRef><DefaultDuration Value="480000" /></SampleRef></Tracks><Scenes /></LiveSet></Ableton>`
  }

  it("writes no relative path — the PathHint is what resolves", () => {
    const result = downgradeToV10(
      documentWithSample(`${ROOT}/STEMS/DRUMS/piano.wav`),
      { libraryRoot: ROOT }
    )
    if (!result.ok) throw new Error(result.error)
    // MEASURED: all 392 FileRefs of the small v10 reference set — written by
    // Live 10 itself and one that always opened — are ALL `false`/`0`/empty
    // list. The file is located by the absolute `PathHint`, and only by it.
    //
    // Two attempts to write a relative path were tested in real Live 10 and
    // both opened with all clips greyed out: `RelativePathType=3` with the
    // list from the library root, and `1` with the up-level elements. The
    // relative path Live writes AFTER you locate the samples by hand is no
    // reference for whoever writes the file from scratch — that was the false
    // lead that cost two tests.
    expect(result.xml).toContain('<HasRelativePath Value="false" />')
    expect(result.xml).toContain('<RelativePathType Value="0" />')
    expect(result.xml).toContain("<RelativePath />")
    expect(result.xml).not.toContain('<RelativePathType Value="3" />')
    expect(result.xml).toContain('<Name Value="piano.wav" />')
    expect(result.xml).not.toContain("<Path Value=")
  })

  it("the PathHint keeps the whole absolute path, folder by folder", () => {
    const result = downgradeToV10(
      documentWithSample(`${ROOT}/STEMS/DRUMS/piano.wav`),
      { libraryRoot: ROOT }
    )
    if (!result.ok) throw new Error(result.error)
    expect(result.xml).toContain('<RelativePathElement Id="0" Dir="Volumes" />')
    expect(result.xml).toContain(
      '<RelativePathElement Id="2" Dir="TRACKS Project" />'
    )
    expect(result.xml).toContain(
      '<RelativePathElement Id="4" Dir="DRUMS" />'
    )
  })

  it("v12's size and CRC become v10's SearchHint", () => {
    const result = downgradeToV10(
      documentWithSample(`${ROOT}/STEMS/piano.wav`),
      { libraryRoot: ROOT }
    )
    if (!result.ok) throw new Error(result.error)
    expect(result.xml).toContain('<FileSize Value="4102590" />')
    expect(result.xml).toContain('<Crc Value="51450" />')
  })

  it("audio outside the library root becomes a warning", () => {
    const result = downgradeToV10(documentWithSample("/other/place/x.wav"), {
      libraryRoot: ROOT,
    })
    if (!result.ok) throw new Error(result.error)
    expect(result.warnings.map((item) => item.kind)).toContain("sample_ref")
  })

  it("without the library root the SampleRef stays untouched", () => {
    const xml = documentWithSample(`${ROOT}/STEMS/piano.wav`)
    const result = downgradeToV10(xml)
    if (!result.ok) throw new Error(result.error)
    expect(result.xml).toContain("<Path Value=")
  })
})

describe("regressions found by opening in real Live 10", () => {
  it('strips the attributes Live 10 refuses ("Unknown attribute")', () => {
    const xml = `<Ableton MajorVersion="5" MinorVersion="12.0_12402" Creator="Ableton Live 12.4.3"><LiveSet><Tracks><AudioTrack Id="8" SelectedToolPanel="7" SelectedTransformationName="" SelectedGeneratorName=""><Name><EffectiveName Value="X" /></Name></AudioTrack></Tracks><Scenes /></LiveSet></Ableton>`
    const result = downgradeToV10(xml)
    if (!result.ok) throw new Error(result.error)
    expect(result.xml).toContain('<AudioTrack Id="8">')
    expect(result.xml).not.toContain("SelectedToolPanel")
    expect(result.xml).not.toContain("SelectedTransformationName")
  })

  it("a nameless scene converts too — in v12 the <Name> is gone, not empty", () => {
    const nameless = `<Scene Id="7"><KeyMidi /><FollowAction><FollowTime Value="4" /></FollowAction><Annotation Value="" /><Color Value="-1" /><Tempo Value="120" /><IsTempoEnabled Value="false" /><TimeSignatureId Value="201" /><IsTimeSignatureEnabled Value="false" /><LomId Value="0" /></Scene>`
    const result = downgradeToV10(documentV12([nameless]))
    if (!result.ok) throw new Error(result.error)
    expect(result.scenesConverted).toBe(1)
    expect(result.xml).toContain('<Scene Id="7" Value="">')
    expect(result.xml).not.toContain("<Tempo ")
  })

  it("a preset's FileRef comes WITH an attribute and needs converting too", () => {
    const xml = `<Ableton MajorVersion="5" MinorVersion="12.0_12402" Creator="Ableton Live 12.4.3"><LiveSet><Tracks><FilePresetRef Id="4"><FileRef Id="4"><RelativePathType Value="1" /><RelativePath Value="../x.adv" /><Path Value="/Applications/Live/x.adv" /><Type Value="1" /></FileRef></FilePresetRef></Tracks><Scenes /></LiveSet></Ableton>`
    const result = downgradeToV10(xml, { libraryRoot: "/library" })
    if (!result.ok) throw new Error(result.error)
    expect(result.xml).not.toContain("<RelativePath Value=")
    // The Id stays: the FileRef is a list member and v10 demands an Id on all.
    expect(result.xml).toContain('<FileRef Id="4">')
    // a factory preset lives outside the library and that is normal — no warning
    expect(result.warnings).toEqual([])
  })

  it("a Path already relative to the library root is not treated as a lost file", () => {
    const xml = `<Ableton MajorVersion="5" MinorVersion="12.0_12402" Creator="Ableton Live 12.4.3"><LiveSet><Tracks><SampleRef><FileRef><RelativePathType Value="1" /><RelativePath Value="../x.mp3" /><Path Value="WORKING FILES/AMB/aura.mp3" /><Type Value="2" /></FileRef></SampleRef></Tracks><Scenes /></LiveSet></Ableton>`
    const result = downgradeToV10(xml, { libraryRoot: "/library" })
    if (!result.ok) throw new Error(result.error)
    expect(result.warnings).toEqual([])
    // v12's relative path is discarded; what matters is the absolute PathHint,
    // built from the library root.
    expect(result.xml).toContain('<HasRelativePath Value="false" />')
    expect(result.xml).toContain('<RelativePathElement Id="0" Dir="library" />')
    expect(result.xml).toContain(
      '<RelativePathElement Id="1" Dir="WORKING FILES" />'
    )
    expect(result.xml).toContain('<Name Value="aura.mp3" />')
  })

  it("NoteAlgorithms goes out whole — it is where thousands of <Pitch> come from", () => {
    const xml = `<Ableton MajorVersion="5" MinorVersion="12.0_12402" Creator="Ableton Live 12.4.3"><LiveSet><Tracks><NoteAlgorithms><RhythmAlgorithm><Density Value="1" /><Pitch Value="36" /><Velocity Value="100" /></RhythmAlgorithm></NoteAlgorithms></Tracks><Scenes /></LiveSet></Ableton>`
    const result = downgradeToV10(xml)
    if (!result.ok) throw new Error(result.error)
    expect(result.xml).not.toContain("NoteAlgorithms")
    expect(result.xml).not.toContain("<Pitch ")
  })

  it("the FileRef's Id survives — without it Live 10 refuses the list", () => {
    // A device's `<OriginalFileRef>` holds a FileRef WITH an Id; removing it
    // gives "Not all list members have Ids".
    const xml = `<Ableton MajorVersion="5" MinorVersion="12.0_12402" Creator="Ableton Live 12.4.3"><LiveSet><Tracks><OriginalFileRef><FileRef Id="132"><RelativePathType Value="1" /><RelativePath Value="../x.adv" /><Path Value="/x/y/Dotted.adv" /><Type Value="2" /></FileRef></OriginalFileRef></Tracks><Scenes /></LiveSet></Ableton>`
    const result = downgradeToV10(xml, { libraryRoot: "/library" })
    if (!result.ok) throw new Error(result.error)
    expect(result.xml).toContain('<FileRef Id="132">')
  })

  it("an empty folder list comes out self-closed, as Live 10 writes it", () => {
    const xml = `<Ableton MajorVersion="5" MinorVersion="12.0_12402" Creator="Ableton Live 12.4.3"><LiveSet><Tracks><SampleRef><FileRef><RelativePathType Value="1" /><RelativePath Value="x.wav" /><Path Value="/x.wav" /><Type Value="2" /></FileRef></SampleRef></Tracks><Scenes /></LiveSet></Ableton>`
    const result = downgradeToV10(xml, { libraryRoot: "/library" })
    if (!result.ok) throw new Error(result.error)
    expect(result.xml).toContain("<RelativePath />")
    expect(result.xml).not.toContain("<RelativePath></RelativePath>")
  })
})

describe("document skeleton — bisected with 5 variants in real Live 10", () => {
  // Every case here was MEASURED on the calibration pair and confirmed by
  // opening the variants in Live 10: every variant with the master's
  // ClipSlots crashed (same stack, EXC_BAD_ACCESS at 0x8 in SetSongUnit); the
  // ones without them opened.
  const buildDocument = (liveSet: string): string =>
    `<Ableton MajorVersion="5" MinorVersion="12.0_12402" SchemaChangeCount="5" Creator="Ableton Live 12.4.3" Revision="abc"><LiveSet>${liveSet}<Scenes /></LiveSet></Ableton>`

  const convert = (liveSet: string): string => {
    const result = downgradeToV10(buildDocument(liveSet))
    if (!result.ok) throw new Error(result.error)
    return result.xml
  }

  it("empties the master's FreezeSequencer ClipSlots — the cause of the segfault", () => {
    const xml = convert(
      `<Tracks /><MainTrack><DeviceChain><FreezeSequencer><ClipSlotList><ClipSlot Id="0"><LomId Value="0" /><ClipSlot><Value /></ClipSlot><HasStop Value="true" /></ClipSlot></ClipSlotList></FreezeSequencer></DeviceChain></MainTrack>`
    )
    expect(xml).toContain("<ClipSlotList />")
    expect(xml).not.toContain('<ClipSlot Id="0">')
  })

  it("also empties the GroupTracks' FreezeSequencer ClipSlots", () => {
    // The master's disease, on the group: v12 writes one slot per scene and
    // v10 writes the list empty (same crash stack as the master's, seen on a
    // second real set).
    const xml = convert(
      `<Tracks><GroupTrack Id="9"><DeviceChain><FreezeSequencer><ClipSlotList><ClipSlot Id="0"><HasStop Value="true" /></ClipSlot></ClipSlotList></FreezeSequencer></DeviceChain></GroupTrack><AudioTrack Id="1"><DeviceChain><MainSequencer><ClipSlotList><ClipSlot Id="0"><HasStop Value="true" /></ClipSlot></ClipSlotList></MainSequencer></DeviceChain></AudioTrack></Tracks><MainTrack><ClipSlotList /></MainTrack>`
    )
    const group = /<GroupTrack[\s\S]*?<\/GroupTrack>/.exec(xml)?.[0] ?? ""
    expect(group).toContain("<ClipSlotList />")
    expect(group).not.toContain('<ClipSlot Id="0">')
    const audio = /<AudioTrack[\s\S]*?<\/AudioTrack>/.exec(xml)?.[0] ?? ""
    expect(audio).toContain('<ClipSlot Id="0">')
  })

  it("does not touch ordinary tracks' ClipSlots", () => {
    const xml = convert(
      `<Tracks><AudioTrack Id="1"><DeviceChain><MainSequencer><ClipSlotList><ClipSlot Id="0"><HasStop Value="true" /></ClipSlot></ClipSlotList></MainSequencer></DeviceChain></AudioTrack></Tracks><MainTrack><ClipSlotList /></MainTrack>`
    )
    expect(xml).toContain('<ClipSlot Id="0">')
  })

  it('"AudioOut/Main" routing goes back to "AudioOut/Master"', () => {
    const xml = convert(
      `<Tracks><AudioTrack Id="1"><DeviceChain><AudioOutputRouting><Target Value="AudioOut/Main" /><UpperDisplayString Value="Master" /></AudioOutputRouting></DeviceChain></AudioTrack></Tracks><MainTrack><ClipSlotList /></MainTrack>`
    )
    expect(xml).toContain('<Target Value="AudioOut/Master" />')
    expect(xml).not.toContain("AudioOut/Main")
  })

  it("OverwriteProtectionNumber goes back to 2561 (0x0A01 = Live 10.1)", () => {
    // v12 leaves 3076 = 0x0C04 (12.4) in the LiveSet and in every device.
    const xml = convert(
      `<OverwriteProtectionNumber Value="3076" /><Tracks /><MainTrack><ClipSlotList /></MainTrack>`
    )
    expect(xml).toContain('<OverwriteProtectionNumber Value="2561" />')
  })

  it("a track's Color takes +140; a clip's stays raw; -1 (no color) becomes 0", () => {
    const xml = convert(
      `<Tracks><AudioTrack Id="1"><Color Value="22" /><DeviceChain><MainSequencer><Sample><AudioClip Id="0"><Color Value="22" /></AudioClip></Sample></MainSequencer></DeviceChain></AudioTrack></Tracks><MainTrack><ClipSlotList /></MainTrack><PreHearTrack><Color Value="-1" /></PreHearTrack>`
    )
    // Track 22 → 162; the same-colored clip stays 22 (measured on the pair).
    expect(xml).toContain('<ColorIndex Value="162" />')
    expect(xml).toContain('<ColorIndex Value="22" />')
    expect(xml).toContain('<ColorIndex Value="0" />')
    expect(xml).not.toContain("<Color Value=")
  })

  it("a scene name with double quotes (SINGLE-quoted attribute in v12) survives", () => {
    // Ableton switches to `Value='…'` when the value contains double quotes.
    // Those names were reported as "erased by v12" — they were 11 golden-pair
    // scenes the double-quote regexes could not see.
    const xml = convert(
      `<Tracks /><MainTrack><ClipSlotList /></MainTrack><Scenes><Scene Id="7"><FollowAction><FollowTime Value="4" /></FollowAction><Name Value='BR1 ^ [8] "death could not"' /><Annotation Value="" /><Color Value="-1" /><Tempo Value="120" /><IsTempoEnabled Value="false" /><TimeSignatureId Value="201" /><IsTimeSignatureEnabled Value="false" /><LomId Value="0" /><ClipSlotsListWrapper LomId="0" /></Scene></Scenes>`
    ).replace("<Scenes />", "")
    expect(xml).toContain(
      '<Scene Id="7" Value="BR1 ^ [8] &quot;death could not&quot;">'
    )
    expect(xml).not.toContain("<Name Value=")
  })

  it("a MIDI note gets back the IsEnabled v12 stopped writing", () => {
    const xml = convert(
      `<Tracks><MidiTrack Id="1"><Notes><MidiNoteEvent Time="0" Duration="0.5" Velocity="100" OffVelocity="64" NoteId="1" /><MidiNoteEvent Time="1" Duration="1" Velocity="90" OffVelocity="64" IsEnabled="false" NoteId="2" /></Notes></MidiTrack></Tracks><MainTrack><ClipSlotList /></MainTrack>`
    )
    expect(xml).toContain(
      '<MidiNoteEvent Time="0" Duration="0.5" Velocity="100" OffVelocity="64" IsEnabled="true" NoteId="1" />'
    )
    // A note genuinely disabled must not be re-enabled.
    expect(xml).toContain('IsEnabled="false" NoteId="2"')
  })

  it("ScaleInformation inside a MidiClip goes — v10 does not have it there", () => {
    // 1,353 occurrences on the golden pair; the small (audio-only) pair never
    // exercised it.
    const xml = convert(
      `<Tracks><MidiTrack Id="1"><MidiClip Id="0"><ScaleInformation><RootNote Value="0" /><Name Value="Major" /></ScaleInformation><Notes /></MidiClip></MidiTrack></Tracks><MainTrack><ClipSlotList /></MainTrack>`
    )
    expect(xml).not.toContain("ScaleInformation")
  })

  it("colors from the palette's upper range use the +218 step", () => {
    // Measured on the color reference files and checked in real Live 10: a
    // track at `69` comes out `287` (+218) and ones at `1..13` come out
    // `141..153` (+140) — the step changes at 60.
    //
    // The reference file is NOT kept (the archive keeps no loose .als). To
    // rebuild it in 5 minutes, in Live 12: 14 MIDI tracks × 5 scenes, paint
    // the 70 clips with the palette's 70 colors in order (palette row 1 on
    // scene 1, etc.), paint each TRACK a different color including at least
    // one from the last row (indices 60-69), save and convert with
    // `downgradeToV10`. Check in Live 10: on scene 1 each clip has its
    // track's color, so track and clip must appear the SAME color — the file
    // verifies itself.
    const xml = convert(
      `<Tracks><AudioTrack Id="1"><Color Value="69" /></AudioTrack><AudioTrack Id="2"><Color Value="59" /></AudioTrack></Tracks><MainTrack><ClipSlotList /></MainTrack>`
    )
    expect(xml).toContain('<ColorIndex Value="287" />')
    expect(xml).toContain('<ColorIndex Value="199" />')
  })

  it("all 70 palette colors convert with no collision and no gap", () => {
    // The reference covered the 70 indices in CLIP (identity) and the 59/60
    // boundary in TRACK. This test sweeps the whole range: every v12 index
    // becomes a unique v10 ColorIndex, and none falls outside the two ranges
    // v10 uses (140..199 and 278..287).
    const produced = Array.from({ length: 70 }, (_, index) => {
      const xml = convert(
        `<Tracks><AudioTrack Id="1"><Color Value="${index}" /></AudioTrack></Tracks><MainTrack><ClipSlotList /></MainTrack>`
      )
      return Number(/<ColorIndex Value="(\d+)"/.exec(xml)?.[1])
    })

    expect(new Set(produced).size).toBe(70)
    expect(
      produced.filter((value) => value >= 140 && value <= 199)
    ).toHaveLength(60)
    expect(
      produced.filter((value) => value >= 278 && value <= 287)
    ).toHaveLength(10)
  })

  it("the GroupTrack comes out without Freeze/VelocityDetail/NeedArrangerRefreeze — v10 does not have them there", () => {
    // Measured on a native v10 set with groups (Live 10.1.3): the v10
    // GroupTrack does not freeze. v12 writes Freeze and NeedArrangerRefreeze
    // on it, and the restore used to duplicate the NeedArrangerRefreeze on
    // top (seen on a second real set).
    const xml = convert(
      `<Tracks><GroupTrack Id="9"><Name><EffectiveName Value="STEMS" /></Name><Slots><GroupTrackSlot Id="0"><LomId Value="0" /></GroupTrackSlot></Slots><Freeze Value="false" /><NeedArrangerRefreeze Value="true" /><DeviceChain /></GroupTrack><AudioTrack Id="1"><Freeze Value="false" /></AudioTrack></Tracks><MainTrack><ClipSlotList /></MainTrack>`
    )
    const group = /<GroupTrack[\s\S]*?<\/GroupTrack>/.exec(xml)?.[0] ?? ""
    expect(group).not.toContain("<Freeze")
    expect(group).not.toContain("NeedArrangerRefreeze")
    expect(group).not.toContain("VelocityDetail")
    // An ordinary track still gains the pair after the Freeze.
    const audio = /<AudioTrack[\s\S]*?<\/AudioTrack>/.exec(xml)?.[0] ?? ""
    expect(audio).toContain('<VelocityDetail Value="0" />')
  })

  it("a v12 track that ALREADY writes NeedArrangerRefreeze gains only the VelocityDetail", () => {
    // Some v12 sets write NeedArrangerRefreeze on the AudioTracks (the golden
    // pair did not). Restoring the full pair duplicated the member and Live
    // 10 refused with "Class AudioTrack already has member
    // NeedArrangerRefreeze".
    const xml = convert(
      `<Tracks><AudioTrack Id="1"><Freeze Value="false" />
				<NeedArrangerRefreeze Value="true" /><DeviceChain /></AudioTrack></Tracks><MainTrack><ClipSlotList /></MainTrack>`
    )
    expect(xml.match(/<NeedArrangerRefreeze /g)?.length).toBe(1)
    expect(xml).toContain('<VelocityDetail Value="0" />')
  })

  it("NESTED TakeLanes goes out whole — a non-greedy regex left the closing tag orphaned", () => {
    // v12 writes <TakeLanes> containing another <TakeLanes>; stopping at the
    // first </TakeLanes> produced "mismatched tag" on two songs in the
    // archive.
    const xml = convert(
      `<Tracks><AudioTrack Id="1"><TakeLanes><TakeLanes><TakeLane Id="0"><LaneHeight Value="68" /></TakeLane></TakeLanes><AreTakeLanesFolded Value="true" /></TakeLanes><DeviceChain /></AudioTrack></Tracks><MainTrack><ClipSlotList /></MainTrack>`
    )
    expect(xml).not.toContain("TakeLanes")
    expect(xml).not.toContain("TakeLane")
  })

  it('EffectiveName "Main"/"0-Main" becomes "Master" — but only on the master/prehear', () => {
    const xml = convert(
      `<Tracks><AudioTrack Id="1"><Name><EffectiveName Value="Main" /></Name></AudioTrack></Tracks><MainTrack><Name><EffectiveName Value="Main" /></Name><ClipSlotList /></MainTrack><PreHearTrack><Name><EffectiveName Value="0-Main" /></Name></PreHearTrack>`
    )
    // A user track called "Main" must not be renamed.
    const insideTracks = /<Tracks>[\s\S]*?<\/Tracks>/.exec(xml)?.[0] ?? ""
    expect(insideTracks).toContain('<EffectiveName Value="Main" />')
    const master = /<MasterTrack>[\s\S]*?<\/MasterTrack>/.exec(xml)?.[0] ?? ""
    expect(master).toContain('<EffectiveName Value="Master" />')
    expect(xml).not.toContain('<EffectiveName Value="0-Main" />')
  })
})
