// From the engine's codes and data to sentences in the active language.
//
// The engine and the worker never return prose: they do not know which
// language the visitor reads. Everything they report arrives as a code, a key
// or a plain value, and this file is where it meets a catalog. Each function
// is a `switch` over a typed union, so a code the engine adds stops the build
// here until it is worded. No DOM, so the tests run every one in each language.

import type {
  Blocked,
  ExcerptTitle,
  FactValue,
  Label,
  OutputBlocked,
  PrettyXml,
  Refusal,
  StepView,
} from "../engine.js"
import { catalog, type Catalog } from "../i18n/index.js"

/** Why a repair cannot run on this set. */
export function blockedText(blocked: Blocked, words: Catalog = catalog()): string {
  switch (blocked.code) {
    case "unsupported_version":
      return blocked.untested
        ? words.blocked.untested_version(blocked.values.version)
        : words.blocked.unsupported_version(blocked.values.version)
    case "colliding_pointee_ids":
      return words.blocked.colliding_pointee_ids(blocked.values.ids)
    case "mixed_clip_durations":
      return words.blocked.mixed_clip_durations(blocked.values.count)
    case "needs_two_tracks":
      return words.blocked.needs_two_tracks
  }
}

/** Why the result is not offered as a file. */
export function outputText(
  blocked: OutputBlocked,
  words: Catalog = catalog()
): string {
  switch (blocked.reason) {
    case "unchanged":
      return words.output.unchanged
    case "damaged":
      return words.output.damaged
    case "invalid":
      return words.output.invalid(blocked.problems)
  }
}

/** Why an action was refused. */
export function refusalText(refusal: Refusal, words: Catalog = catalog()): string {
  switch (refusal.code) {
    case "unsupported_version":
    case "colliding_pointee_ids":
    case "mixed_clip_durations":
    case "needs_two_tracks":
      return blockedText(refusal, words)
    case "nothing_to_change":
      return words.refusals.nothing_to_change
    case "already_v10":
      return words.refusals.already_v10
    case "unverified_version":
      return words.refusals.unverified_version(refusal.values.version)
    case "invalid_bpm":
      return words.refusals.invalid_bpm
    case "no_warped_clips":
      return words.refusals.no_warped_clips
    case "same_track":
      return words.refusals.same_track
    case "track_without_clips":
      return words.refusals.track_without_clips(refusal.values.track)
    case "relative_library_root":
      return words.refusals.relative_library_root
    case "relink_unresolved":
      return words.refusals.relink_unresolved(
        refusal.values.count,
        refusal.values.folder
      )
    case "relink_already_there":
      return words.refusals.relink_already_there
    case "output_unchanged":
      return words.output.unchanged
    case "output_damaged":
      return words.output.damaged
    case "output_invalid":
      return words.output.invalid(refusal.values.problems)
    case "library_error":
      return words.refusals.library_error(refusal.values.detail)
  }
}

/** The label of a fact or of a row in a before and after table. */
export function labelText(label: Label, words: Catalog = catalog()): string {
  switch (label.key) {
    case "sceneName":
      return words.labels.sceneName(label.scene)
    case "trackColor":
      return words.labels.trackColor(label.track)
    default:
      return words.labels[label.key]
  }
}

/** How many warp tempos a fact lists before it says "and more". */
const BPM_SHOWN = 4

/** A fact's value. Text from the file is shown as it is. */
export function valueText(value: FactValue, words: Catalog = catalog()): string {
  if (value === null) return words.common.none
  if (typeof value === "string") return value
  if (typeof value === "number") return words.common.number(value)
  if ("part" in value) {
    return words.common.partOfTotal(value.part, value.total)
  }
  if (value.byBpm.length === 0) return words.common.none
  const shown = value.byBpm
    .slice(0, BPM_SHOWN)
    .map(
      ([bpm, clips]) =>
        `${words.common.number(bpm)} (${words.common.number(clips)})`
    )
    .join(", ")
  return value.byBpm.length > BPM_SHOWN
    ? `${shown}, ${words.repair.moreBpms(value.byBpm.length - BPM_SHOWN)}`
    : shown
}

export function excerptTitle(
  title: ExcerptTitle,
  words: Catalog = catalog()
): string {
  switch (title.key) {
    case "header":
      return words.convert.excerpts.header
    case "scene":
      return words.convert.excerpts.scene(title.scene)
    case "firstAudioRef":
      return words.convert.excerpts.firstAudioRef
  }
}

/** An excerpt as text, with what it leaves out said in words. */
export function excerptText(pretty: PrettyXml, words: Catalog = catalog()): string {
  const lines = pretty.lines.map((line) =>
    typeof line === "string"
      ? line
      : `${line.indent}${line.head}… ${words.convert.excerpts.hexChars(line.hexChars)}`
  )
  if (pretty.hiddenLines > 0) {
    lines.push(`… ${words.convert.excerpts.moreLines(pretty.hiddenLines)}`)
  }
  return lines.join("\n")
}

/**
 * What an applied repair changed. Built from the count the library returns:
 * its own summary is English prose with no code behind it, so it is not shown.
 */
export function doneText(
  step: Extract<StepView, { readonly kind: "tool" }>,
  words: Catalog = catalog()
): string {
  const done = words.repair.done[step.tool](step.changed)
  return step.skipped > 0
    ? `${done} ${words.repair.done.leftAlone(step.skipped)}`
    : done
}
