// ---------------------------------------------------------------------------
// The MIDI note or CC that launches a scene.
//
// Live stores the binding INSIDE the scene, as a `<KeyMidi>` right after the
// opening tag; a scene with no binding simply has no such element. That is why
// this is surgery and not a field: writing one means inserting a block,
// clearing one means deleting it.
//
// It matters for generated sets. A set is assembled by cloning one of the
// template's scene rows, so whatever binding that row carries is copied onto
// every row of every song — one archive template had CC 37 on its first scene
// and the generated set came out with the same CC on 135 scenes, all of them
// firing at once.
// ---------------------------------------------------------------------------

import { applyEdits, findSceneRanges, type Edit } from "./surgery.js"

export type SceneMidiMapping = {
  /** MIDI channel as the FILE stores it: 0-based, so Live's "1" is 0 here. */
  readonly channel: number
  /** The CC number, or the note number when `isNote`. */
  readonly controller: number
  readonly isNote?: boolean | undefined
}

const KEY_MIDI = /<KeyMidi>[\s\S]*?<\/KeyMidi>/

/** Written the way Live writes it, indented to sit inside the scene. */
function block(mapping: SceneMidiMapping): string {
  return [
    `<KeyMidi>`,
    `<PersistentKeyString Value="" />`,
    `<IsNote Value="${mapping.isNote ? "true" : "false"}" />`,
    `<Channel Value="${mapping.channel}" />`,
    `<NoteOrController Value="${mapping.controller}" />`,
    `<LowerRangeNote Value="-1" />`,
    `<UpperRangeNote Value="-1" />`,
    `<ControllerMapMode Value="0" />`,
    `</KeyMidi>`,
  ].join("")
}

export type SceneMidiResult = {
  readonly xml: string
  /** Scenes whose binding actually changed. */
  readonly changed: number
}

/**
 * Sets or clears the launch binding of the listed scenes, BY INDEX.
 *
 * Only the scenes named in `mappings` are touched — `null` clears one, and a
 * scene left out keeps whatever it has. That is deliberate: a template's own
 * bindings (a vocal-check click, a groove click) must survive a set being
 * assembled around them.
 */
export function setSceneMidiMappings(
  xml: string,
  mappings: ReadonlyMap<number, SceneMidiMapping | null>
): SceneMidiResult {
  const ranges = findSceneRanges(xml)
  const edits: Edit[] = []

  for (const [index, mapping] of mappings) {
    const range = ranges[index]
    if (!range) continue
    const body = xml.slice(range.start, range.end)
    const existing = KEY_MIDI.exec(body)

    if (mapping === null) {
      if (!existing) continue
      edits.push({
        start: range.start + existing.index,
        end: range.start + existing.index + existing[0].length,
        replacement: "",
      })
      continue
    }

    const next = block(mapping)
    if (existing) {
      if (existing[0] === next) continue
      edits.push({
        start: range.start + existing.index,
        end: range.start + existing.index + existing[0].length,
        replacement: next,
      })
      continue
    }
    // No binding yet: it goes right after the opening tag. A self-closing
    // scene (`<Scene … />`) has nowhere to put it, and is left alone.
    const open = /<Scene Id="\d+"[^>]*?(\/?)>/.exec(body)
    if (!open || open[1] === "/") continue
    const at = range.start + open.index + open[0].length
    edits.push({ start: at, end: at, replacement: next })
  }

  return { xml: applyEdits(xml, edits), changed: edits.length }
}
