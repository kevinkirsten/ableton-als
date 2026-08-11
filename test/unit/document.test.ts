import { describe, expect, it } from "vitest"
import {
  decodeTimeSignatureId,
  gridIsConsistent,
  parseAlsDocument,
  parseHeader,
  parseScenes,
  readSceneTempo,
  unescapeXml,
} from "../../src/core/document.js"

// An audio clip with the same anatomy as the real files: the clip's `<Name>`
// comes BEFORE the SampleRef (which has another `<Name>`, the file's), and the
// project's `<RelativePath>` coexists with the source machine's `<PathHint>`.
function audioClip(options: {
  readonly label: string
  readonly loopStart: number
  readonly loopEnd: number
  readonly wav: string
  readonly warpSeconds?: number
  readonly isWarped?: boolean
}): string {
  const warpSeconds = options.warpSeconds ?? 0.0128424654823765874
  return `
    <AudioClip Id="1" Time="0">
      <CurrentStart Value="0" />
      <CurrentEnd Value="${options.loopEnd - options.loopStart}" />
      <Loop>
        <LoopStart Value="${options.loopStart}" />
        <LoopEnd Value="${options.loopEnd}" />
        <StartRelative Value="0" />
        <LoopOn Value="false" />
      </Loop>
      <Name Value="${options.label}" />
      <TimeSignature>
        <TimeSignatures>
          <RemoteableTimeSignature Id="0">
            <Numerator Value="4" />
            <Denominator Value="4" />
          </RemoteableTimeSignature>
        </TimeSignatures>
      </TimeSignature>
      <FollowTime Value="4" />
      <FollowActionA Value="4" />
      <FollowChanceA Value="1" />
      <IsWarped Value="${options.isWarped ?? true}" />
      <SampleRef>
        <FileRef>
          <RelativePathType Value="3" />
          <RelativePath>
            <RelativePathElement Id="20" Dir="STEMS" />
            <RelativePathElement Id="21" Dir="SET LIST" />
          </RelativePath>
          <Name Value="${options.wav}" />
          <SearchHint>
            <PathHint>
              <RelativePathElement Id="0" Dir="Users" />
              <RelativePathElement Id="1" Dir="jane.doe" />
            </PathHint>
          </SearchHint>
        </FileRef>
        <DefaultDuration Value="480000" />
        <DefaultSampleRate Value="48000" />
      </SampleRef>
      <WarpMarkers>
        <WarpMarker Id="2" SecTime="0" BeatTime="0" />
        <WarpMarker Id="3" SecTime="${warpSeconds}" BeatTime="0.03125" />
      </WarpMarkers>
    </AudioClip>`
}

// Every outer ClipSlot carries an INNER ClipSlot without an Id — the trap that
// fells a naive parser.
function slot(inner: string | null, id: number): string {
  return `
    <ClipSlot Id="${id}">
      <LomId Value="0" />
      <ClipSlot>
        <Value>${inner ?? ""}</Value>
      </ClipSlot>
      <HasStop Value="true" />
      <NeedRefreeze Value="true" />
    </ClipSlot>`
}

function audioTrack(options: {
  readonly id: number
  readonly name: string
  readonly color: number
  readonly target: string
  readonly clips: ReadonlyArray<string | null>
}): string {
  const sessionSlots = options.clips
    .map((clip, index) => slot(clip, index))
    .join("")
  // The FREEZE list comes first on purpose: if the parser picks by order
  // instead of by wrapper, the test breaks.
  const freezeSlots = options.clips
    .map((_, index) => slot(null, index))
    .join("")
  return `
    <AudioTrack Id="${options.id}">
      <Name>
        <EffectiveName Value="${options.name}" />
        <UserName Value="${options.name}" />
      </Name>
      <ColorIndex Value="${options.color}" />
      <DeviceChain>
        <FreezeSequencer>
          <ClipSlotList>${freezeSlots}</ClipSlotList>
        </FreezeSequencer>
        <MainSequencer>
          <ClipSlotList>${sessionSlots}</ClipSlotList>
          <Sample>
            <ArrangerAutomation>
              <Events />
            </ArrangerAutomation>
          </Sample>
        </MainSequencer>
        <AudioOutputRouting>
          <Target Value="${options.target}" />
          <UpperDisplayString Value="Ext. Out" />
          <LowerDisplayString Value="1/2" />
        </AudioOutputRouting>
      </DeviceChain>
    </AudioTrack>`
}

const V10_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="10.0_377" SchemaChangeCount="6" Creator="Ableton Live 10.1.43" Revision="abc">
  <LiveSet>
    <NextPointeeId Value="154220" />
    <Tracks>
      ${audioTrack({
        id: 30,
        name: "CUE",
        color: 153,
        target: "AudioOut/External/M10",
        clips: [
          null,
          audioClip({
            label: "CUE",
            loopStart: 0,
            loopEnd: 4,
            wav: "Song_CUE.wav",
          }),
          audioClip({
            label: "CUE",
            loopStart: 4,
            loopEnd: 36,
            wav: "Song_CUE.wav",
          }),
          null,
        ],
      })}
      ${audioTrack({
        id: 31,
        name: "PERC / FX",
        color: 170,
        target: "AudioOut/External/S2",
        clips: [null, null, null, null],
      })}
    </Tracks>
    <MasterTrack>
      <Tempo>
        <Manual Value="146" />
      </Tempo>
      <TimeSignature>
        <Manual Value="201" />
      </TimeSignature>
      <ClipSlotList />
    </MasterTrack>
    <Scenes>
      <Scene Id="1" Value="" />
      <Scene Id="2" Value="CLICK 4/4;146 BPM" />
      <Scene Id="3" Value="SONG &amp; FRIENDS  4/4;146 BPM [1]" />
      <Scene Id="4" Value="INTRO   [8]" />
    </Scenes>
  </LiveSet>
</Ableton>`

describe("unescapeXml", () => {
  it("resolves the entities that appear in real names", () => {
    expect(unescapeXml("STARTS &amp; ENDS")).toBe("STARTS & ENDS")
    expect(unescapeXml("V1 &quot;Silent Night&quot;")).toBe('V1 "Silent Night"')
    expect(unescapeXml("TRIG =&gt; 2X")).toBe("TRIG => 2X")
  })
})

describe("parseHeader", () => {
  it("reads the Live 10 version", () => {
    const header = parseHeader(V10_XML)
    expect(header?.creator).toBe("Ableton Live 10.1.43")
    expect(header?.minorVersion).toBe("10.0_377")
    expect(header?.schemaChangeCount).toBe("6")
  })

  it("accepts Live 9, which has no SchemaChangeCount", () => {
    const header = parseHeader(
      '<Ableton MajorVersion="4" MinorVersion="9.5_327" Creator="Ableton Live 9.7" Revision="x">'
    )
    expect(header?.creator).toBe("Ableton Live 9.7")
    expect(header?.schemaChangeCount).toBeNull()
  })
})

describe("parseScenes", () => {
  it("reads the name from the ATTRIBUTE in the v10 schema", () => {
    const { schema, scenes } = parseScenes(V10_XML)
    expect(schema).toBe("v10")
    expect(scenes).toHaveLength(4)
    expect(scenes[0]!.rawName).toBe("")
    expect(scenes[2]!.rawName).toBe("SONG & FRIENDS  4/4;146 BPM [1]")
  })

  it("reads the name from the CHILD in the v12 schema, with structured tempo and time signature", () => {
    const v12 = `<Scenes>
      <Scene Id="10">
        <Name Value="CLICK - 132BPM 4/4" />
        <Color Value="13" />
        <Tempo Value="132" />
        <IsTempoEnabled Value="true" />
        <TimeSignatureId Value="201" />
      </Scene>
      <Scene Id="11">
        <Name Value="V1" />
        <Color Value="8" />
        <IsTempoEnabled Value="false" />
        <TimeSignatureId Value="200" />
      </Scene>
    </Scenes>`
    const { schema, scenes } = parseScenes(v12)
    expect(schema).toBe("v12")
    expect(scenes[0]!.rawName).toBe("CLICK - 132BPM 4/4")
    expect(scenes[0]!.tempo).toBe(132)
    expect(scenes[1]!.timeSignatureId).toBe(200)
  })
})

describe("parseAlsDocument", () => {
  const document = parseAlsDocument(V10_XML)

  it("reads tracks with name, color and routing", () => {
    expect(document.tracks).toHaveLength(2)
    expect(document.tracks[0]!.name).toBe("CUE")
    expect(document.tracks[0]!.colorIndex).toBe(153)
    expect(document.tracks[0]!.audioOutTarget).toBe("AudioOut/External/M10")
  })

  it("picks the SESSION list, not the freeze one (which comes first in the file)", () => {
    const cue = document.tracks[0]!
    expect(cue.sessionClips).toHaveLength(4)
    expect(cue.sessionClips.filter(Boolean)).toHaveLength(2)
  })

  it("maps slot → scene by POSITION", () => {
    const cue = document.tracks[0]!
    expect(cue.sessionClips[0]).toBeNull()
    expect(cue.sessionClips[1]?.loopStart).toBe(0)
    expect(cue.sessionClips[1]?.loopEnd).toBe(4)
    expect(cue.sessionClips[2]?.loopEnd).toBe(36)
    expect(cue.sessionClips[3]).toBeNull()
  })

  it("extracts the clip's geometry and warp", () => {
    const clip = document.tracks[0]!.sessionClips[1]!
    expect(clip.kind).toBe("audio")
    expect(clip.rawName).toBe("CUE")
    expect(clip.loopOn).toBe(false)
    expect(clip.isWarped).toBe(true)
    expect(clip.timeSignature).toEqual({ num: 4, den: 4 })
    expect(clip.followActionA).toBe(4)
    expect(clip.warpBpm).toBeCloseTo(146, 1)
    expect(clip.warpMarkerCount).toBe(2)
  })

  it("separates the WAV name from the clip label and ignores the source machine's PathHint", () => {
    const clip = document.tracks[0]!.sessionClips[1]!
    expect(clip.sample?.fileName).toBe("Song_CUE.wav")
    expect(clip.sample?.relativeDirs).toEqual(["STEMS", "SET LIST"])
    expect(clip.sample?.frames).toBe(480000)
    expect(clip.sample?.sampleRate).toBe(48000)
  })

  it("reads the master tempo, time signature and the Id allocator", () => {
    expect(document.masterTempo).toBe(146)
    expect(document.masterTimeSignatureId).toBe(201)
    expect(document.nextPointeeId).toBe(154220)
  })

  it("validates the grid invariant (one slot per scene in every list)", () => {
    expect(gridIsConsistent(document)).toBe(true)
  })

  it("flags an inconsistent grid when a slot is missing", () => {
    const broken = parseAlsDocument(
      V10_XML.replace('<Scene Id="4" Value="INTRO   [8]" />', "")
    )
    expect(gridIsConsistent(broken)).toBe(false)
  })
})

describe("decodeTimeSignatureId", () => {
  it("decodes the ids measured in the archive", () => {
    expect(decodeTimeSignatureId(201)).toEqual({ num: 4, den: 4 })
    expect(decodeTimeSignatureId(200)).toEqual({ num: 3, den: 4 })
    expect(decodeTimeSignatureId(203)).toEqual({ num: 6, den: 4 })
    expect(decodeTimeSignatureId(302)).toEqual({ num: 6, den: 8 })
    expect(decodeTimeSignatureId(198)).toEqual({ num: 1, den: 4 })
  })
})

describe("readSceneTempo", () => {
  it("reads the tokens the downgrade porter writes — both archive conventions", () => {
    expect(readSceneTempo("PREROLL CLICK  4/4;126 BPM")).toEqual({
      bpm: 126,
      timeSignatureLabel: "4/4",
    })
    expect(readSceneTempo("CLICK - 136BPM 4/4")).toEqual({
      bpm: 136,
      timeSignatureLabel: "4/4",
    })
  })

  it("accepts a comma as the decimal separator", () => {
    expect(readSceneTempo("X 135,5 BPM").bpm).toBe(135.5)
  })

  it("a name with no tokens reads as nothing programmed", () => {
    expect(readSceneTempo("SETLIST ABOVE")).toEqual({
      bpm: null,
      timeSignatureLabel: null,
    })
  })
})
