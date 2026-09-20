import { describe, expect, it } from "vitest"
import { setSceneMidiMappings } from "../../src/core/scene-midi.js"

// Live keeps the launch binding inside the scene. A set is assembled by cloning
// one of the template's rows, so a binding on that row lands on every row of
// every song, which is how one archive template put CC 37 on 135 scenes.

const unbound = (id: number, nome: string) =>
  `<Scene Id="${id}" Value="${nome}"><Annotation Value="" /><ColorIndex Value="153" /></Scene>`

const bound = (id: number, nome: string, cc: number) =>
  `<Scene Id="${id}" Value="${nome}"><KeyMidi><PersistentKeyString Value="" />` +
  `<IsNote Value="false" /><Channel Value="0" /><NoteOrController Value="${cc}" />` +
  `<LowerRangeNote Value="-1" /><UpperRangeNote Value="-1" />` +
  `<ControllerMapMode Value="0" /></KeyMidi><Annotation Value="" /></Scene>`

const doc = (...scenes: string[]) => `<Scenes>${scenes.join("")}</Scenes>`

describe("setSceneMidiMappings", () => {
  it("writes a binding onto a scene that had none", () => {
    const r = setSceneMidiMappings(
      doc(unbound(1, "CLICK"), unbound(2, "GOOD NEWS")),
      new Map([[0, { channel: 0, controller: 32 }]])
    )
    expect(r.changed).toBe(1)
    expect(r.xml).toContain('<NoteOrController Value="32" />')
    // The second one stays clean.
    expect(r.xml.match(/<KeyMidi>/g)).toHaveLength(1)
  })

  it("replaces the binding of a scene that already had one", () => {
    const r = setSceneMidiMappings(
      doc(bound(1, "CLICK", 37)),
      new Map([[0, { channel: 0, controller: 32 }]])
    )
    expect(r.xml).toContain('<NoteOrController Value="32" />')
    expect(r.xml).not.toContain('<NoteOrController Value="37" />')
    expect(r.xml.match(/<KeyMidi>/g)).toHaveLength(1)
  })

  it("null clears the binding and the block is gone", () => {
    const r = setSceneMidiMappings(
      doc(bound(1, "CLICK", 37)),
      new Map([[0, null]])
    )
    expect(r.changed).toBe(1)
    expect(r.xml).not.toContain("<KeyMidi>")
    expect(r.xml).toContain('Value="CLICK"')
  })

  it("a scene left out is NOT touched, so the template keeps its own", () => {
    // The template's vocal check and groove click carry their own bindings
    // and have to survive a set being assembled around them.
    const entrada = doc(bound(1, "VOCAL CHECK", 39), unbound(2, "CLICK"))
    const r = setSceneMidiMappings(entrada, new Map([[1, { channel: 0, controller: 32 }]]))
    expect(r.xml).toContain('<NoteOrController Value="39" />')
    expect(r.xml).toContain('<NoteOrController Value="32" />')
  })

  it("an index that does not exist is ignored, not a crash", () => {
    const entrada = doc(unbound(1, "CLICK"))
    const r = setSceneMidiMappings(entrada, new Map([[9, { channel: 0, controller: 32 }]]))
    expect(r.changed).toBe(0)
    expect(r.xml).toBe(entrada)
  })

  it("writing the same binding again changes nothing", () => {
    const entrada = doc(bound(1, "CLICK", 32))
    const r = setSceneMidiMappings(entrada, new Map([[0, { channel: 0, controller: 32 }]]))
    expect(r.changed).toBe(0)
    expect(r.xml).toBe(entrada)
  })

  it("a note instead of a CC", () => {
    const r = setSceneMidiMappings(
      doc(unbound(1, "CLICK")),
      new Map([[0, { channel: 2, controller: 60, isNote: true }]])
    )
    expect(r.xml).toContain('<IsNote Value="true" />')
    expect(r.xml).toContain('<Channel Value="2" />')
  })

  it("a self-closing scene has nowhere to put it and is left alone", () => {
    const entrada = `<Scenes><Scene Id="1" Value="X" /></Scenes>`
    const r = setSceneMidiMappings(entrada, new Map([[0, { channel: 0, controller: 32 }]]))
    expect(r.changed).toBe(0)
    expect(r.xml).toBe(entrada)
  })
})
