// The four working views. Each one is a function from the worker's state to
// DOM nodes; nothing here holds the document or touches the library.

import type {
  MirrorPreview,
  ToolId,
  ValidationProblem,
} from "../../../src/index.js"
import type {
  Change,
  ClipView,
  ConversionReport,
  Inspection,
  Operation,
  SessionState,
  StepView,
  ToolView,
} from "../engine.js"
import { describe } from "../messages.js"
import { codeBlock, type Runtime, type SnippetId } from "./code.js"
import {
  badge,
  count,
  formatBytes,
  formatNumber,
  h,
  icon,
  valuesList,
  withColor,
  type Child,
} from "./dom.js"

export type Tab = "inspect" | "validate" | "convert" | "repair"

/** What the visitor has typed or picked. Survives every re-render. */
export type Ui = {
  tab: Tab
  runtime: Runtime
  repairFocus: ToolId
  libraryRoot: string
  libraryRootEdited: boolean
  relinkRoot: string
  bpm: string
  base: string
  target: string
  mirrorPreview: MirrorPreview | null
  selected: { readonly track: number; readonly scene: number } | null
  showAllScenes: boolean
  showAllFiles: boolean
  busy: boolean
}

export type Actions = {
  convert(): void
  apply(operation: Operation): void
  download(): void
  requestMirrorPreview(): void
  /** A typed value changed: refresh the code panel, leave the form alone. */
  refreshCode(): void
  focusTool(tool: ToolId): void
  rerender(): void
}

export function snippetFor(ui: Ui): SnippetId {
  return ui.tab === "repair" ? ui.repairFocus : ui.tab
}

function block(title: string | null, ...children: readonly Child[]): HTMLElement {
  return h(
    "section",
    { class: "block" },
    title === null ? null : h("h3", null, title),
    ...children
  )
}

function fact(label: string, value: Child, note?: string): HTMLElement {
  return h(
    "div",
    null,
    h("dt", null, label),
    h("dd", null, value, note ? h("small", null, note) : null)
  )
}

function changesTable(
  changes: readonly Change[],
  beforeLabel: string,
  afterLabel: string
): HTMLElement {
  return h(
    "div",
    { class: "table-scroll" },
    h(
      "table",
      { class: "table" },
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          h("th", { scope: "col" }, "What"),
          h("th", { scope: "col" }, beforeLabel),
          h("th", { scope: "col" }, afterLabel)
        )
      ),
      h(
        "tbody",
        null,
        changes.map((change) =>
          h(
            "tr",
            null,
            h("th", { scope: "row" }, change.label),
            h("td", { class: "mono", translate: "no" }, change.before),
            h("td", { class: "mono", translate: "no" }, change.after)
          )
        )
      )
    )
  )
}

// ---------------------------------------------------------------------------
// Inspect
// ---------------------------------------------------------------------------

const SCENE_CAP = 150
const FILE_CAP = 40

const TRACK_KIND = {
  AudioTrack: "Audio",
  MidiTrack: "MIDI",
  ReturnTrack: "Return",
  GroupTrack: "Group",
} as const

function clipDetail(
  inspection: Inspection,
  selected: Ui["selected"]
): HTMLElement {
  const track = selected ? inspection.tracks[selected.track] : undefined
  const clip: ClipView | null | undefined =
    track && selected ? track.clips[selected.scene] : undefined
  if (!selected || !track || !clip) {
    return h(
      "p",
      { class: "muted" },
      "Select a clip to see what the file says about it. Striped clips are MIDI."
    )
  }
  const scene = inspection.scenes[selected.scene]
  const row = (label: string, value: Child): HTMLElement =>
    h("div", null, h("dt", null, label), h("dd", null, value))
  return h(
    "dl",
    null,
    row(
      "Clip",
      h(
        "span",
        null,
        withColor(h("span", { class: "swatch" }), clip.color),
        clip.name === "" ? "(unnamed)" : clip.name
      )
    ),
    row("Track", track.name),
    row("Scene", `${selected.scene + 1}${scene && scene.name ? `, ${scene.name.trim()}` : ""}`),
    row("Kind", clip.kind === "audio" ? "Audio" : "MIDI"),
    clip.bpm === null ? null : row("Warped at", `${formatNumber(clip.bpm)} BPM`),
    clip.signature === null ? null : row("Time signature", clip.signature),
    clip.lengthBeats === null
      ? null
      : row("Loop length", `${formatNumber(clip.lengthBeats)} beats`),
    clip.sample === null
      ? null
      : row("File", h("span", { class: "mono", translate: "no" }, clip.sample))
  )
}

function sessionGrid(inspection: Inspection, ui: Ui, actions: Actions): HTMLElement {
  const total = inspection.scenes.length
  const shown = ui.showAllScenes ? total : Math.min(total, SCENE_CAP)
  const detail = h(
    "div",
    { class: "clip-detail", "aria-live": "polite" },
    clipDetail(inspection, ui.selected)
  )
  let pressed: HTMLButtonElement | null = null

  const head = h(
    "tr",
    null,
    h("th", { class: "corner", scope: "col" }, "Scene"),
    inspection.tracks.map((track) =>
      withColor(
        h(
          "th",
          { class: "track-head", scope: "col", title: track.name },
          h("span", null, track.name === "" ? "(unnamed)" : track.name),
          h("span", { class: "kind" }, TRACK_KIND[track.type])
        ),
        track.color
      )
    )
  )

  const rows: HTMLElement[] = []
  for (let scene = 0; scene < shown; scene++) {
    const info = inspection.scenes[scene]!
    const meta = [
      info.bpm === null ? null : `${formatNumber(info.bpm)} BPM`,
      info.signature,
    ].filter((part): part is string => part !== null)
    const cells = inspection.tracks.map((track, trackIndex) => {
      if (scene >= track.clips.length) {
        return h(
          "td",
          null,
          h("span", {
            class: "slot slot-missing",
            title: `${track.name} has ${track.clips.length} slots for ${total} scenes`,
          })
        )
      }
      const clip = track.clips[scene]
      if (!clip) return h("td", null, h("span", { class: "slot" }))
      const label = `${track.name}, scene ${scene + 1}: ${clip.name === "" ? "unnamed clip" : clip.name}`
      const isSelected =
        ui.selected?.track === trackIndex && ui.selected.scene === scene
      const button = withColor(
        h("button", {
          class: "clip",
          type: "button",
          "data-kind": clip.kind,
          "data-key": `clip-${trackIndex}-${scene}`,
          "aria-label": label,
          "aria-pressed": String(isSelected),
          title: label,
        }),
        clip.color
      )
      if (isSelected) pressed = button
      button.addEventListener("click", () => {
        pressed?.setAttribute("aria-pressed", "false")
        button.setAttribute("aria-pressed", "true")
        pressed = button
        ui.selected = { track: trackIndex, scene }
        detail.replaceChildren(clipDetail(inspection, ui.selected))
      })
      return h("td", null, button)
    })
    rows.push(
      h(
        "tr",
        null,
        h(
          "th",
          { class: "scene-head", scope: "row" },
          h(
            "div",
            { class: "scene-row" },
            h("span", { class: "scene-index" }, scene + 1),
            h(
              "span",
              { class: "scene-name", title: info.name },
              info.name === "" ? "(unnamed)" : info.name
            ),
            meta.length > 0
              ? h("span", { class: "scene-meta" }, meta.join(" · "))
              : null
          )
        ),
        cells
      )
    )
  }

  return h(
    "div",
    { class: "block" },
    h(
      "div",
      { class: "session-scroll", tabindex: "0", role: "group", "aria-label": "Session grid" },
      h(
        "table",
        { class: "session" },
        h("thead", null, head),
        h("tbody", null, rows)
      )
    ),
    shown < total
      ? h(
          "button",
          {
            class: "button",
            type: "button",
            "data-key": "show-all-scenes",
            onclick: () => {
              ui.showAllScenes = true
              actions.rerender()
            },
          },
          `Show all ${total.toLocaleString("en")} scenes`
        )
      : null,
    detail
  )
}

function filesTable(inspection: Inspection, ui: Ui, actions: Actions): HTMLElement {
  const legacy = (inspection.version.major ?? 0) <= 10
  const files = inspection.files
  const shown = ui.showAllFiles ? files : files.slice(0, FILE_CAP)
  if (files.length === 0) {
    return h("p", { class: "muted" }, "This set references no files.")
  }
  return h(
    "div",
    { class: "block" },
    h(
      "div",
      { class: "table-scroll" },
      h(
        "table",
        { class: "table" },
        h(
          "thead",
          null,
          h(
            "tr",
            null,
            h("th", { scope: "col" }, "File"),
            h("th", { scope: "col" }, "Folder"),
            h("th", { scope: "col", class: "num" }, "Uses"),
            h("th", { scope: "col" }, legacy ? "Alias record" : "Alias on conversion")
          )
        ),
        h(
          "tbody",
          null,
          shown.map((file) =>
            h(
              "tr",
              null,
              h("td", { class: "path", translate: "no" }, file.name),
              h(
                "td",
                { class: "path", translate: "no" },
                file.folder === "" ? "not stated" : file.folder
              ),
              h("td", { class: "num" }, file.refs),
              h(
                "td",
                null,
                !file.audio
                  ? badge("idle", "Not audio")
                  : legacy
                    ? file.hasAlias
                      ? badge("ok", "Present")
                      : badge("warn", "Missing")
                    : file.external
                      ? badge("ok", "Can be built")
                      : badge("warn", "Not under /Volumes/")
              )
            )
          )
        )
      )
    ),
    shown.length < files.length
      ? h(
          "button",
          {
            class: "button",
            type: "button",
            "data-key": "show-all-files",
            onclick: () => {
              ui.showAllFiles = true
              actions.rerender()
            },
          },
          `Show all ${files.length.toLocaleString("en")} files`
        )
      : null
  )
}

export function renderInspect(
  state: SessionState,
  ui: Ui,
  actions: Actions
): readonly HTMLElement[] {
  const inspection = state.inspection
  const kinds = new Map<string, number>()
  for (const track of inspection.tracks) {
    const kind = TRACK_KIND[track.type]
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
  }
  const clips = inspection.audioClips + inspection.midiClips
  const audioFiles = inspection.files.filter((file) => file.audio).length

  return [
    h(
      "dl",
      { class: "facts" },
      fact("Saved by", inspection.version.creator || "unknown"),
      fact(
        "Schema",
        h("span", { class: "mono", translate: "no" }, inspection.version.minorVersion)
      ),
      fact(
        "Transport tempo",
        inspection.masterTempo === null
          ? "not stated"
          : `${formatNumber(inspection.masterTempo)} BPM`,
        "Where the transport was left, not always the song's tempo"
      ),
      fact("Time signature", inspection.masterSignature ?? "not stated"),
      fact(
        "Tracks",
        inspection.tracks.length,
        [...kinds].map(([kind, total]) => `${total} ${kind}`).join(", ")
      ),
      fact("Scenes", inspection.scenes.length),
      fact(
        "Clips",
        clips,
        `${inspection.audioClips} audio, ${inspection.midiClips} MIDI`
      ),
      fact(
        "Referenced files",
        inspection.files.length,
        `${audioFiles} audio`
      ),
      fact(
        "Size",
        formatBytes(inspection.sizeBytes),
        `${formatBytes(inspection.xmlLength)} of XML inside`
      )
    ),
    block(
      "Session",
      h(
        "p",
        { class: "muted small" },
        "Tracks across, scenes down. Each clip is painted with the colour index stored in the file."
      ),
      sessionGrid(inspection, ui, actions)
    ),
    block("Referenced files", filesTable(inspection, ui, actions)),
  ]
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

const RULES: readonly {
  readonly rule: ValidationProblem["rule"]
  readonly name: string
  readonly checks: string
}[] = [
  {
    rule: "grid",
    name: "Scene and track grid",
    checks:
      "Every clip slot list, freeze lists included, holds exactly one slot per scene. A mismatch crashes Live while the set loads.",
  },
  {
    rule: "ids",
    name: "Ids and automation targets",
    checks:
      "Clip automation points at a target that exists, and the Id allocator sits above every Id already used.",
  },
  {
    rule: "xml",
    name: "Document structure",
    checks:
      "Tags open and close in order, and no element Live expects once per parent appears twice.",
  },
  {
    rule: "routing",
    name: "Routing",
    checks: "Every track that routes into another track points at one that exists.",
  },
]

function problemItem(problem: {
  readonly code: string
  readonly values: Readonly<Record<string, string | number>>
  readonly detail: string
}): HTMLElement {
  return h(
    "div",
    { class: "item" },
    h(
      "div",
      { class: "item-head" },
      h("span", { class: "code-tag", translate: "no" }, problem.code)
    ),
    h("p", null, describe(problem)),
    valuesList(problem.values)
  )
}

function sentence(text: string): string {
  const trimmed = text.trim()
  if (trimmed === "") return trimmed
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return /[.!?]$/.test(capital) ? capital : `${capital}.`
}

export function renderValidate(state: SessionState): readonly HTMLElement[] {
  const problems = state.inspection.problems
  const byRule = (rule: string): number =>
    problems.filter((problem) => problem.rule === rule).length

  return [
    block(
      null,
      h(
        "p",
        null,
        problems.length === 0
          ? "No structural problems found in this set."
          : `${count(problems.length, "problem", "problems")} found. Each one would make Live refuse the set or crash while loading it.`
      ),
      h(
        "div",
        { class: "table-scroll" },
        h(
          "table",
          { class: "table" },
          h(
            "thead",
            null,
            h(
              "tr",
              null,
              h("th", { scope: "col" }, "Check"),
              h("th", { scope: "col" }, "What it looks for"),
              h("th", { scope: "col" }, "Result")
            )
          ),
          h(
            "tbody",
            null,
            RULES.map((entry) => {
              const found = byRule(entry.rule)
              return h(
                "tr",
                null,
                h("th", { scope: "row" }, entry.name),
                h("td", null, entry.checks),
                h(
                  "td",
                  null,
                  found === 0
                    ? badge("ok", "Passed")
                    : badge("bad", count(found, "problem", "problems"))
                )
              )
            })
          )
        )
      )
    ),
    problems.length > 0
      ? block(
          "Problems",
          h("div", { class: "items" }, problems.map(problemItem)),
          h(
            "p",
            { class: "muted small" },
            "The code and its values are stable and meant for your own wording or language. The sentence is the same message as English prose."
          )
        )
      : block(
          null,
          h(
            "p",
            { class: "muted" },
            "These checks catch damage Live refuses or crashes on. They cannot prove Live opens the set: a wrong value in a field Live knows passes every structural check."
          )
        ),
  ]
}

// ---------------------------------------------------------------------------
// Convert
// ---------------------------------------------------------------------------

function conversionResult(
  report: ConversionReport,
  state: SessionState,
  ui: Ui,
  actions: Actions
): readonly HTMLElement[] {
  const blocked = state.output.blocked
  const { withRecord, audioRefs, offVolume } = report.aliases
  const nodes: HTMLElement[] = []

  nodes.push(
    block(
      null,
      h(
        "div",
        { class: "result-line" },
        h(
          "p",
          null,
          blocked?.reason === "invalid"
            ? badge("bad", "Converted, but not safe to open")
            : badge("ok", "Converted"),
          " ",
          `${count(report.scenesConverted, "scene", "scenes")} rewritten, ${count(report.warnings.length, "warning", "warnings")}, ${count(report.problems.length, "validation problem", "validation problems")}.`
        ),
        blocked?.reason === "synthetic"
          ? null
          : h(
              "button",
              {
                class: "button button-primary",
                type: "button",
                "data-key": "download-convert",
                disabled: blocked !== null || ui.busy,
                onclick: () => actions.download(),
              },
              icon("download"),
              "Download the Live 10 set"
            )
      ),
      blocked === null
        ? h(
            "p",
            { class: "muted" },
            "Saved as ",
            h("span", { class: "mono", translate: "no" }, state.output.name),
            ", never over your original. Open the result in Live 10 and check it before you rely on it."
          )
        : blocked.reason === "synthetic"
          ? null
          : h("p", null, blocked.message)
    )
  )

  if (report.problems.length > 0) {
    nodes.push(
      block(
        "Validation problems in the result",
        h("div", { class: "items" }, report.problems.map(problemItem))
      )
    )
  }

  if (report.warnings.length > 0) {
    nodes.push(
      block(
        "Warnings",
        h(
          "p",
          { class: "muted small" },
          "What Live 10 has no way to store, or what the page could not work out."
        ),
        h("div", { class: "items" }, report.warnings.map(problemItem))
      )
    )
  }

  nodes.push(
    block(
      "Audio references",
      h(
        "p",
        null,
        audioRefs === 0
          ? "This set references no audio files."
          : `An alias record was written for ${withRecord.toLocaleString("en")} of ${count(audioRefs, "audio reference", "audio references")}. Live 10 finds audio by that record, not by the path next to it.`
      ),
      offVolume > 0
        ? h(
            "p",
            null,
            `${count(offVolume, "reference is", "references are")} not under /Volumes/, and the record for the startup disk has never been measured, so none was written. Live 10 will ask you to locate ${offVolume === 1 ? "that file" : "those files"} once.`
          )
        : null
    )
  )

  nodes.push(
    block("What changed", changesTable(report.changes, "Live 12", "Live 10"))
  )

  if (report.tagDeltas.length > 0) {
    nodes.push(
      block(
        "Elements added and removed",
        h(
          "p",
          { class: "muted small" },
          "Live 10 refuses elements it does not know and crashes without some that Live 12 stopped writing. Counted across the whole document."
        ),
        h(
          "div",
          { class: "table-scroll" },
          h(
            "table",
            { class: "table" },
            h(
              "thead",
              null,
              h(
                "tr",
                null,
                h("th", { scope: "col" }, "Element"),
                h("th", { scope: "col", class: "num" }, "In the Live 12 set"),
                h("th", { scope: "col", class: "num" }, "In the Live 10 set")
              )
            ),
            h(
              "tbody",
              null,
              report.tagDeltas.map((delta) =>
                h(
                  "tr",
                  null,
                  h("td", { class: "mono", translate: "no" }, delta.tag),
                  h("td", { class: "num" }, delta.before.toLocaleString("en")),
                  h("td", { class: "num" }, delta.after.toLocaleString("en"))
                )
              )
            )
          )
        ),
        report.tagDeltaCount > report.tagDeltas.length
          ? h(
              "p",
              { class: "muted small" },
              `And ${report.tagDeltaCount - report.tagDeltas.length} more element names whose count changed.`
            )
          : null
      )
    )
  }

  for (const excerpt of report.excerpts) {
    nodes.push(
      block(
        excerpt.title,
        h(
          "div",
          { class: "excerpt" },
          h(
            "figure",
            null,
            h("figcaption", null, "Before, as Live 12 wrote it"),
            codeBlock(excerpt.before, "xml")
          ),
          h(
            "figure",
            null,
            h("figcaption", null, "After, as Live 10 expects it"),
            codeBlock(excerpt.after, "xml")
          )
        )
      )
    )
  }

  nodes.push(
    block(
      "What a conversion cannot bring back",
      h(
        "ul",
        { class: "plain-list" },
        h(
          "li",
          null,
          "Follow action Jump exists from Live 11 on. Clips using it are set to no action, with a warning."
        ),
        h(
          "li",
          null,
          "A reference that pointed at a folder arrives from Live 12 empty. There is nothing to rebuild it from."
        ),
        h(
          "li",
          null,
          "A folder name longer than 31 characters is written in full inside the alias record, where Live would shorten it. Sets built this way opened in Live 10 with every clip loaded."
        ),
        h(
          "li",
          null,
          "Scene colours follow the measured track mapping. A coloured scene was never measured directly."
        )
      )
    )
  )

  return nodes
}

export function renderConvert(
  state: SessionState,
  ui: Ui,
  actions: Actions
): readonly HTMLElement[] {
  const inspection = state.inspection
  const step = state.steps.find(
    (candidate): candidate is Extract<StepView, { kind: "convert" }> =>
      candidate.kind === "convert"
  )
  if (step) return conversionResult(step.report, state, ui, actions)

  if (inspection.convert.state === "already_v10") {
    return [
      block(
        null,
        h(
          "p",
          null,
          badge("idle", "Nothing to convert"),
          " ",
          `This set was saved by ${inspection.version.creator || "Live 10 or older"}. Live 10 opens it as it is, and newer versions migrate it forward on their own.`
        )
      ),
    ]
  }
  if (inspection.convert.state === "unverified") {
    return [
      block(
        null,
        h(
          "p",
          null,
          badge("warn", "Not converted"),
          " ",
          "This set was saved by Live 11, and this conversion has only been measured on Live 12 sets. A guess here produces a file that passes every check and then crashes Live 10 with no message, so the page declines."
        ),
        h(
          "p",
          null,
          "If you can share a Live 11 set, ",
          h(
            "a",
            { href: "https://github.com/kevinkirsten/ableton-als/issues" },
            "open an issue with the file attached"
          ),
          ". That is the measurement the project is missing."
        )
      ),
    ]
  }

  return [
    block(
      null,
      h(
        "p",
        null,
        "Live has no downgrade path: a set saved in Live 12 will not open in Live 10. This rebuilds the document the older version expects and leaves everything it does not need to touch byte for byte as it was."
      ),
      h(
        "div",
        { class: "field" },
        h("label", { for: "library-root" }, "Library folder"),
        h("input", {
          class: "input mono",
          id: "library-root",
          "data-key": "library-root",
          type: "text",
          value: ui.libraryRoot,
          spellcheck: "false",
          autocomplete: "off",
          placeholder: "/Volumes/My SSD/Library",
          translate: "no",
          oninput: (event) => {
            ui.libraryRoot = (event.target as HTMLInputElement).value
            ui.libraryRootEdited = true
            actions.refreshCode()
          },
        }),
        h(
          "p",
          { class: "hint" },
          "The folder your audio lives under, read from the set. Audio outside it converts too and is listed as a warning."
        )
      ),
      h(
        "div",
        null,
        h(
          "button",
          {
            class: "button button-primary",
            type: "button",
            "data-key": "convert",
            disabled: ui.busy,
            onclick: () => actions.convert(),
          },
          "Convert to Live 10"
        )
      )
    ),
    block(
      "What the conversion does",
      h(
        "ul",
        { class: "plain-list" },
        h(
          "li",
          null,
          "Moves each scene's tempo and time signature back into the scene name, the only place Live 10 reads them from."
        ),
        h(
          "li",
          null,
          "Re-encodes track and scene colours. Both versions share one palette of 70 colours and store its indices differently."
        ),
        h(
          "li",
          null,
          "Rewrites every sample reference and builds the macOS alias record Live 10 uses to find the audio."
        ),
        h(
          "li",
          null,
          "Removes the elements Live 10 does not know and restores the ones it needs, then validates the result before offering it."
        )
      )
    ),
  ]
}

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

const TOOLS: Readonly<
  Record<ToolId, { readonly title: string; readonly fn: string; readonly about: string }>
> = {
  pointeeIds: {
    title: "Duplicate automation Ids",
    fn: "fixPointeeIds",
    about:
      "Two automation or modulation targets sharing one Id make Live 12 refuse the set. This renumbers the extra occurrences and moves the Id allocator past them.",
  },
  rewarp: {
    title: "Clips warped at the wrong tempo",
    fn: "rewarpClips",
    about:
      "Changing a clip's BPM in Live moves its warp marker and leaves the loop windows in the old beat scale, so the clip drifts. This rescales every beat value of every audio clip to the tempo you give. Follow times are a scene length and are left alone, so run the follow action repair after this one.",
  },
  followActions: {
    title: "Follow actions out of step",
    fn: "syncFollowActions",
    about:
      "Enables each clip's follow action, unlinks it from the clip length, and sets its time to the real length of its scene.",
  },
  mirrorTrack: {
    title: "Copy clip geometry between tracks",
    fn: "mirrorTrackGeometry",
    about:
      "Copies loop windows, warp markers and follow times from one track onto another, scene by scene. Each track keeps its own audio.",
  },
  relinkSamples: {
    title: "Samples that point at another machine",
    fn: "relinkFileRefs",
    about:
      "A set put together on another computer carries that computer's paths, and every clip opens missing. This re-roots each reference at your copy of the library and rebuilds its alias record.",
  },
}

export const TOOL_ORDER: readonly ToolId[] = [
  "pointeeIds",
  "rewarp",
  "followActions",
  "mirrorTrack",
  "relinkSamples",
]

export function toolTitle(tool: ToolId): string {
  return TOOLS[tool].title
}

function toolStatus(tool: ToolView): HTMLElement {
  if (tool.blocked !== null) return badge("idle", "Not available")
  if (tool.pending > 0) return badge("warn", `${tool.pending.toLocaleString("en")} to fix`)
  if (tool.id === "mirrorTrack" || tool.id === "relinkSamples") {
    return badge("idle", "On request")
  }
  return badge("ok", "Nothing to fix")
}

function toolControls(
  tool: ToolView,
  state: SessionState,
  ui: Ui,
  actions: Actions
): HTMLElement {
  const applyButton = (
    label: string,
    operation: () => Operation | null,
    enabled = true
  ): HTMLElement =>
    h(
      "button",
      {
        class: "button",
        type: "button",
        "data-key": `apply-${tool.id}`,
        disabled: ui.busy || !enabled,
        onclick: () => {
          const next = operation()
          if (next !== null) actions.apply(next)
        },
      },
      label
    )

  switch (tool.id) {
    case "pointeeIds":
      return h(
        "div",
        null,
        applyButton("Renumber duplicates", () => ({ tool: "pointeeIds" }), tool.pending > 0)
      )
    case "followActions":
      return h(
        "div",
        null,
        applyButton("Sync follow actions", () => ({ tool: "followActions" }), tool.pending > 0)
      )
    case "rewarp":
      return h(
        "div",
        { class: "form-row" },
        h(
          "div",
          { class: "field narrow" },
          h("label", { for: "rewarp-bpm" }, "Target BPM"),
          h("input", {
            class: "input",
            id: "rewarp-bpm",
            "data-key": "rewarp-bpm",
            type: "number",
            inputmode: "decimal",
            min: "20",
            max: "999",
            step: "any",
            value: ui.bpm,
            oninput: (event) => {
              ui.bpm = (event.target as HTMLInputElement).value
              actions.refreshCode()
            },
          })
        ),
        applyButton("Rescale clips", () => {
          const bpm = Number(ui.bpm)
          return Number.isFinite(bpm) && bpm >= 20 && bpm <= 999
            ? { tool: "rewarp", bpm }
            : null
        })
      )
    case "mirrorTrack": {
      const names = state.inspection.trackNames
      const select = (
        id: string,
        label: string,
        value: string,
        set: (next: string) => void
      ): HTMLElement =>
        h(
          "div",
          { class: "field" },
          h("label", { for: id }, label),
          h(
            "select",
            {
              class: "select",
              id,
              "data-key": id,
              onchange: (event) => {
                set((event.target as HTMLSelectElement).value)
                actions.requestMirrorPreview()
              },
            },
            names.map((name) => {
              const option = h("option", { value: name }, name)
              option.selected = name === value
              return option
            })
          )
        )
      const preview = ui.mirrorPreview
      return h(
        "div",
        { class: "block" },
        h(
          "div",
          { class: "form-row" },
          select("mirror-base", "Copy from", ui.base, (next) => {
            ui.base = next
          }),
          select("mirror-target", "Onto", ui.target, (next) => {
            ui.target = next
          }),
          applyButton(
            "Copy geometry",
            () => ({ tool: "mirrorTrack", base: ui.base, target: ui.target }),
            ui.base !== ui.target && (preview === null || preview.differing > 0)
          )
        ),
        ui.base === ui.target
          ? h("p", { class: "muted small" }, "Pick two different tracks.")
          : preview === null
            ? null
            : h(
                "p",
                { class: "muted small" },
                `${count(preview.shared, "scene has", "scenes have")} a clip on both tracks, and ${preview.differing} of them differ. ${preview.baseOnly + preview.targetOnly} with a clip on one side only are left alone.`
              )
      )
    }
    case "relinkSamples":
      return h(
        "div",
        { class: "form-row" },
        h(
          "div",
          { class: "field" },
          h("label", { for: "relink-root" }, "Where the library is on this machine"),
          h("input", {
            class: "input mono",
            id: "relink-root",
            "data-key": "relink-root",
            type: "text",
            value: ui.relinkRoot,
            spellcheck: "false",
            autocomplete: "off",
            placeholder: "/Volumes/My SSD/Library",
            translate: "no",
            oninput: (event) => {
              ui.relinkRoot = (event.target as HTMLInputElement).value
              actions.refreshCode()
            },
          }),
          h(
            "p",
            { class: "hint" },
            "The folder must have the same name it had on the machine that saved the set. Everything inside keeps its place."
          )
        ),
        applyButton("Relink samples", () =>
          ui.relinkRoot.trim() === ""
            ? null
            : { tool: "relinkSamples", libraryRoot: ui.relinkRoot }
        )
      )
  }
}

export function renderRepair(
  state: SessionState,
  ui: Ui,
  actions: Actions
): readonly HTMLElement[] {
  const byId = new Map(state.inspection.tools.map((tool) => [tool.id, tool]))
  const lastStep = (id: ToolId): Extract<StepView, { kind: "tool" }> | undefined => {
    for (let index = state.steps.length - 1; index >= 0; index--) {
      const step = state.steps[index]!
      if (step.kind === "tool" && step.tool === id) return step
    }
    return undefined
  }

  const sections = TOOL_ORDER.map((id) => {
    const tool = byId.get(id)
    if (!tool) return null
    const meta = TOOLS[id]
    const applied = lastStep(id)
    const section = h(
      "section",
      { class: "tool" },
      h(
        "div",
        { class: "tool-head" },
        h("h3", null, meta.title),
        h("span", { class: "code-tag", translate: "no" }, meta.fn),
        toolStatus(tool)
      ),
      h("p", null, meta.about),
      tool.facts.length > 0
        ? h(
            "dl",
            { class: "inline-facts" },
            tool.facts.map((entry) =>
              h("div", null, h("dt", null, entry.label), h("dd", null, entry.value))
            )
          )
        : null,
      tool.blocked !== null
        ? h(
            "div",
            { class: "item-head" },
            h("span", { class: "code-tag", translate: "no" }, tool.blocked.code),
            h(
              "span",
              { class: "muted" },
              sentence(tool.blocked.detail),
              id === "relinkSamples" && state.inspection.convert.state === "ready"
                ? " Convert the set to Live 10 first: the conversion writes these references."
                : ""
            )
          )
        : toolControls(tool, state, ui, actions),
      applied
        ? h(
            "div",
            { class: "block" },
            h("p", null, badge("ok", "Applied"), " ", sentence(applied.summary)),
            changesTable(applied.changes, "Before", "After")
          )
        : null
    )
    // Whichever tool the visitor is working in decides the code shown.
    section.addEventListener("focusin", () => actions.focusTool(id))
    section.addEventListener("pointerdown", () => actions.focusTool(id))
    return section
  })

  return [
    h(
      "p",
      { class: "muted" },
      "Each repair reads the set first and says what it would change. Nothing is applied until you ask, repairs stack on the same file, and the last one can be undone."
    ),
    h("div", { class: "tools" }, sections),
  ]
}
