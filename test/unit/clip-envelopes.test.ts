import { describe, expect, it } from "vitest"
import {
  collectPointeeRoles,
  collectRoleIds,
  remapClipEnvelopes,
  trackSegment,
} from "../../src/core/clip-envelopes.js"

// A minimal v10 track: the MainSequencer's volume target (the archive's case —
// 58 songs) and a device target, which cannot be translated.
function track(id: number, volumeTargetId: number, deviceTargetId: number) {
  return `<AudioTrack Id="${id}">
    <DeviceChain>
      <MainSequencer>
        <VolumeModulationTarget Id="${volumeTargetId}">
          <LockEnvelope Value="0" />
        </VolumeModulationTarget>
      </MainSequencer>
      <Devices>
        <Reverb Id="0">
          <DryWet><AutomationTarget Id="${deviceTargetId}"><LockEnvelope Value="0" /></AutomationTarget></DryWet>
        </Reverb>
      </Devices>
    </DeviceChain>
  </AudioTrack>`
}

const DOCUMENT = `<Tracks>${track(1, 100, 101)}${track(2, 200, 201)}</Tracks>`

function envelope(pointeeId: number): string {
  return `<ClipEnvelope Id="0">
      <EnvelopeTarget>
        <PointeeId Value="${pointeeId}" />
      </EnvelopeTarget>
      <Automation><Events><FloatEvent Id="1" Time="0" Value="0.5" /></Events></Automation>
    </ClipEnvelope>`
}

describe("trackSegment", () => {
  it("slices the track by index in document order", () => {
    expect(trackSegment(DOCUMENT, 0)).toContain('Id="100"')
    expect(trackSegment(DOCUMENT, 1)).toContain('Id="200"')
    expect(trackSegment(DOCUMENT, 0)).not.toContain('Id="200"')
    expect(trackSegment(DOCUMENT, 7)).toBeNull()
  })
})

describe("collectPointeeRoles / collectRoleIds", () => {
  it("maps the sequencer target by path and ignores device targets", () => {
    const roles = collectPointeeRoles(trackSegment(DOCUMENT, 0)!)
    expect(roles.get(100)).toBe(
      "DeviceChain/MainSequencer/VolumeModulationTarget"
    )
    // a target inside <Devices> is not translatable — it stays out of the map
    expect(roles.has(101)).toBe(false)

    const ids = collectRoleIds(trackSegment(DOCUMENT, 1)!)
    expect(ids.get("DeviceChain/MainSequencer/VolumeModulationTarget")).toBe(
      200
    )
  })
})

describe("remapClipEnvelopes", () => {
  const sourceRoles = collectPointeeRoles(trackSegment(DOCUMENT, 0)!)
  const destinationIds = collectRoleIds(trackSegment(DOCUMENT, 1)!)

  it("translates the PointeeId to the destination's equivalent target", () => {
    const slot = `<ClipSlot Id="0"><Value><AudioClip Id="0" Time="0"><Envelopes><Envelopes>${envelope(100)}</Envelopes></Envelopes></AudioClip></Value></ClipSlot>`
    const result = remapClipEnvelopes(slot, sourceRoles, destinationIds)
    expect(result.xml).toContain('<PointeeId Value="200" />')
    expect(result.xml).not.toContain('<PointeeId Value="100" />')
    expect(result.dropped).toEqual([])
  })

  it("drops the envelope with no equivalent — an orphan used to take Live 10 down at load", () => {
    // target 101 is a device's: it does not travel in the transplant
    const slot = `<ClipSlot Id="0"><Value><AudioClip Id="0" Time="0"><Envelopes><Envelopes>${envelope(101)}</Envelopes></Envelopes></AudioClip></Value></ClipSlot>`
    const result = remapClipEnvelopes(slot, sourceRoles, destinationIds)
    expect(result.xml).not.toContain("ClipEnvelope")
    expect(result.xml).not.toContain("PointeeId")
    // the empty inner list comes out self-closed, as Live writes it
    expect(result.xml).toContain("<Envelopes />")
    expect(result.dropped).toHaveLength(1)
  })

  it("a slot with no envelope passes through untouched", () => {
    const slot = `<ClipSlot Id="0"><Value><AudioClip Id="0" Time="0"><Envelopes><Envelopes /></Envelopes></AudioClip></Value></ClipSlot>`
    const result = remapClipEnvelopes(slot, sourceRoles, destinationIds)
    expect(result.xml).toBe(slot)
  })
})
