// The page's own wording for every message the library can produce.
//
// The library hands each message over twice: as English prose (`detail`) and
// taken apart into a stable `code` plus the `values` that belong to it. The
// second form exists so an application can say it in its own words or its own
// language, and this file is that mechanism in use. The value shapes are
// determined by the code, so a placeholder that does not exist is a type
// error here, not a blank on someone's screen.

import type { DowngradeWarning, ValidationProblem } from "../../src/index.js"

type Message = ValidationProblem | DowngradeWarning

type Wording = {
  readonly [Code in Message["code"]]: (
    values: Extract<Message, { readonly code: Code }>["values"]
  ) => string
}

const plural = (count: number, one: string, other: string): string =>
  count === 1 ? one : other

const WORDING: Wording = {
  orphan_pointee: ({ ids }) =>
    `Clip automation points at target Id ${ids}, which does not exist in this set. Live crashes resolving it while the set loads.`,
  grid_slot_count: ({ list, track, slots, scenes }) =>
    `Clip slot list ${list}, on ${track === "" ? "the master track" : `track ${track}`}, has ${slots} ${plural(slots, "slot", "slots")} for ${scenes} ${plural(scenes, "scene", "scenes")}. Every list needs exactly one slot per scene.`,
  grid_group_slot_count: ({ group, slots, scenes }) =>
    `Group track ${group} has ${slots} ${plural(slots, "slot", "slots")} of its own for ${scenes} ${plural(scenes, "scene", "scenes")}. Live crashes opening a set like this.`,
  xml_mismatched_close: ({ closing, open, offset }) =>
    `The closing tag ${closing} at character ${offset} does not match the open tag ${open}.`,
  xml_unclosed: ({ tags }) =>
    `These tags are still open at the end of the document: ${tags}.`,
  xml_duplicate_singleton: ({ element, parent, offset }) =>
    `${element} appears twice inside one ${parent}, at character ${offset}. Live refuses a set that writes the same member twice.`,
  next_pointee_missing: () =>
    "The set has no NextPointeeId, the counter every new Id is taken from.",
  next_pointee_too_low: ({ declared, max }) =>
    `NextPointeeId is ${declared}, but the highest Id already in use is ${max}. Live would hand out an Id that is taken.`,
  routing_orphan_tracks: ({ ids }) =>
    `A track sends its output into track Id ${ids}, which does not exist in this set.`,
  jump_follow_action: () =>
    "A clip uses the follow action Jump, which Live 10 does not have. It was set to no action and has to be redone by hand.",
  samples_outside_root: ({ count, sample }) =>
    `${count} audio ${plural(count, "file sits", "files sit")} outside the library folder: ${sample}. ${plural(count, "It was", "They were")} converted with ${plural(count, "its", "their")} full path.`,
}

/**
 * The message in this page's words. A code this page has no wording for yet
 * (a newer library) falls back to the library's own English prose.
 */
export function describe(message: {
  readonly code: string
  readonly values: Readonly<Record<string, string | number>>
  readonly detail: string
}): string {
  const wording = (
    WORDING as Readonly<
      Record<string, ((values: never) => string) | undefined>
    >
  )[message.code]
  if (wording) return wording(message.values as never)
  const text = message.detail.trim()
  const capital = text.charAt(0).toUpperCase() + text.slice(1)
  return /[.!?]$/.test(capital) ? capital : `${capital}.`
}

/** Every code this page words itself. Used by the tests. */
export const WORDED_CODES: readonly string[] = Object.keys(WORDING)
