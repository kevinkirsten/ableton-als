// The four working views. Each one is a function from the worker's state to
// DOM nodes; nothing here holds the document or touches the library. Every
// word comes from the active catalog, read when the view is drawn, so drawing
// again after a language change is all it takes to translate the page.

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
import { catalog } from "../i18n/index.js"
import { describe } from "../messages.js"
import { codeBlock, type Runtime, type SnippetId } from "./code.js"
import {
  around,
  badge,
  formatBytes,
  formatNumber,
  h,
  icon,
  rich,
  valuesList,
  withColor,
  type Child,
} from "./dom.js"
import {
  blockedText,
  doneText,
  excerptText,
  excerptTitle,
  labelText,
  outputText,
  valueText,
} from "./wording.js"

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
          h("th", { scope: "col" }, catalog().repair.what),
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
            h("th", { scope: "row" }, labelText(change.label)),
            h("td", { class: "mono", translate: "no" }, valueText(change.before)),
            h("td", { class: "mono", translate: "no" }, valueText(change.after))
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

function clipDetail(
  inspection: Inspection,
  selected: Ui["selected"]
): HTMLElement {
  const t = catalog()
  const words = t.inspect.clip
  const track = selected ? inspection.tracks[selected.track] : undefined
  const clip: ClipView | null | undefined =
    track && selected ? track.clips[selected.scene] : undefined
  if (!selected || !track || !clip) {
    return h("p", { class: "muted" }, words.select)
  }
  const scene = inspection.scenes[selected.scene]
  const row = (label: string, value: Child): HTMLElement =>
    h("div", null, h("dt", null, label), h("dd", null, value))
  return h(
    "dl",
    null,
    row(
      words.clip,
      h(
        "span",
        null,
        withColor(h("span", { class: "swatch" }), clip.color),
        clip.name === "" ? t.common.unnamed : clip.name
      )
    ),
    row(words.track, track.name),
    row(
      words.scene,
      `${selected.scene + 1}${scene && scene.name ? `, ${scene.name.trim()}` : ""}`
    ),
    row(words.kind, clip.kind === "audio" ? words.audio : words.midi),
    clip.bpm === null ? null : row(words.warpedAt, t.common.bpm(clip.bpm)),
    clip.signature === null ? null : row(words.timeSignature, clip.signature),
    clip.lengthBeats === null
      ? null
      : row(words.loopLength, words.beats(clip.lengthBeats)),
    clip.sample === null
      ? null
      : row(words.file, h("span", { class: "mono", translate: "no" }, clip.sample))
  )
}

function sessionGrid(inspection: Inspection, ui: Ui, actions: Actions): HTMLElement {
  const t = catalog()
  const words = t.inspect.session
  const total = inspection.scenes.length
  const shown = ui.showAllScenes ? total : Math.min(total, SCENE_CAP)
  const detail = h(
    "div",
    { class: "clip-detail", "aria-live": "polite" },
    clipDetail(inspection, ui.selected)
  )
  let pressed: HTMLButtonElement | null = null

  // Return tracks have no clip slots in Live's Session view. Their columns
  // would only show empty space, or worse, read as missing slots. The index
  // into `inspection.tracks` is kept, because selection is keyed by it.
  const columns = inspection.tracks
    .map((track, trackIndex) => ({ track, trackIndex }))
    .filter(({ track }) => track.type !== "ReturnTrack")

  const head = h(
    "tr",
    null,
    h("th", { class: "corner", scope: "col" }, words.sceneColumn),
    columns.map(({ track }) =>
      withColor(
        h(
          "th",
          { class: "track-head", scope: "col", title: track.name },
          h("span", null, track.name === "" ? t.common.unnamed : track.name),
          h("span", { class: "kind" }, t.inspect.trackKinds[track.type])
        ),
        track.color
      )
    )
  )

  const rows: HTMLElement[] = []
  for (let scene = 0; scene < shown; scene++) {
    const info = inspection.scenes[scene]!
    const meta = [
      info.bpm === null ? null : t.common.bpm(info.bpm),
      info.signature,
    ].filter((part): part is string => part !== null)
    const cells = columns.map(({ track, trackIndex }) => {
      if (scene >= track.clips.length) {
        return h(
          "td",
          null,
          h("span", {
            class: "slot slot-missing",
            title: words.missingSlots(track.name, track.clips.length, total),
          })
        )
      }
      const clip = track.clips[scene]
      if (!clip) return h("td", null, h("span", { class: "slot" }))
      const label = words.clipLabel(
        track.name,
        scene + 1,
        clip.name === "" ? words.unnamedClip : clip.name
      )
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
              info.name === "" ? t.common.unnamed : info.name
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
      {
        class: "session-scroll",
        tabindex: "0",
        role: "group",
        "aria-label": words.gridLabel,
      },
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
          words.showAll(total)
        )
      : null,
    detail
  )
}

function filesTable(inspection: Inspection, ui: Ui, actions: Actions): HTMLElement {
  const t = catalog()
  const words = t.inspect.files
  const legacy = (inspection.version.major ?? 0) <= 10
  const files = inspection.files
  const shown = ui.showAllFiles ? files : files.slice(0, FILE_CAP)
  if (files.length === 0) {
    return h("p", { class: "muted" }, words.none)
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
            h("th", { scope: "col" }, words.file),
            h("th", { scope: "col" }, words.folder),
            h("th", { scope: "col", class: "num" }, words.uses),
            h(
              "th",
              { scope: "col" },
              legacy ? words.aliasRecord : words.aliasOnConversion
            )
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
              file.folder === ""
                ? h("td", { class: "path" }, t.common.notStated)
                : h("td", { class: "path", translate: "no" }, file.folder),
              h("td", { class: "num" }, formatNumber(file.refs)),
              h(
                "td",
                null,
                !file.audio
                  ? badge("idle", words.notAudio)
                  : legacy
                    ? file.hasAlias
                      ? badge("ok", words.present)
                      : badge("warn", words.missing)
                    : file.external
                      ? badge("ok", words.canBeBuilt)
                      : badge("warn", words.notUnderVolumes)
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
          words.showAll(files.length)
        )
      : null
  )
}

export function renderInspect(
  state: SessionState,
  ui: Ui,
  actions: Actions
): readonly HTMLElement[] {
  const t = catalog()
  const words = t.inspect.facts
  const inspection = state.inspection
  const kinds = new Map<string, number>()
  for (const track of inspection.tracks) {
    const kind = t.inspect.trackKinds[track.type]
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
  }
  const clips = inspection.audioClips + inspection.midiClips
  const audioFiles = inspection.files.filter((file) => file.audio).length

  return [
    h(
      "dl",
      { class: "facts" },
      fact(words.savedBy, inspection.version.creator || words.unknown),
      fact(
        words.schema,
        h("span", { class: "mono", translate: "no" }, inspection.version.minorVersion)
      ),
      fact(
        words.transportTempo,
        inspection.masterTempo === null
          ? t.common.notStated
          : t.common.bpm(inspection.masterTempo),
        words.transportNote
      ),
      fact(words.timeSignature, inspection.masterSignature ?? t.common.notStated),
      fact(
        words.tracks,
        formatNumber(inspection.tracks.length),
        [...kinds]
          .map(([kind, total]) => `${formatNumber(total)} ${kind}`)
          .join(", ")
      ),
      fact(words.scenes, formatNumber(inspection.scenes.length)),
      fact(
        words.clips,
        formatNumber(clips),
        words.clipsNote(inspection.audioClips, inspection.midiClips)
      ),
      fact(
        words.referencedFiles,
        formatNumber(inspection.files.length),
        words.audioFiles(audioFiles)
      ),
      fact(
        words.size,
        formatBytes(inspection.sizeBytes),
        words.xmlInside(inspection.xmlLength)
      )
    ),
    block(
      t.inspect.session.title,
      h("p", { class: "muted small" }, t.inspect.session.note),
      sessionGrid(inspection, ui, actions)
    ),
    block(t.inspect.files.title, filesTable(inspection, ui, actions)),
  ]
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

/** The library's four rule families, in the order the page lists them. */
const RULES: readonly ValidationProblem["rule"][] = [
  "grid",
  "ids",
  "xml",
  "routing",
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

export function renderValidate(state: SessionState): readonly HTMLElement[] {
  const t = catalog()
  const words = t.validate
  const problems = state.inspection.problems
  const byRule = (rule: string): number =>
    problems.filter((problem) => problem.rule === rule).length

  return [
    block(
      null,
      h(
        "p",
        null,
        problems.length === 0 ? words.none : words.found(problems.length)
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
              h("th", { scope: "col" }, words.check),
              h("th", { scope: "col" }, words.looksFor),
              h("th", { scope: "col" }, words.result)
            )
          ),
          h(
            "tbody",
            null,
            RULES.map((rule) => {
              const found = byRule(rule)
              return h(
                "tr",
                null,
                h("th", { scope: "row" }, words.rules[rule].name),
                h("td", null, words.rules[rule].checks),
                h(
                  "td",
                  null,
                  found === 0
                    ? badge("ok", words.passed)
                    : badge("bad", t.common.problems(found))
                )
              )
            })
          )
        )
      )
    ),
    problems.length > 0
      ? block(
          words.problemsTitle,
          h("div", { class: "items" }, problems.map(problemItem)),
          h("p", { class: "muted small" }, words.codesNote)
        )
      : block(null, h("p", { class: "muted" }, words.cannotProve)),
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
  const t = catalog()
  const words = t.convert.result
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
            ? badge("bad", words.convertedUnsafe)
            : badge("ok", words.converted),
          " ",
          words.summary(
            report.scenesConverted,
            report.warnings.length,
            report.problems.length
          )
        ),
        blocked?.reason === "damaged"
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
              words.download
            )
      ),
      blocked === null
        ? h(
            "p",
            { class: "muted" },
            around(
              words.savedAs,
              h("span", { class: "mono", translate: "no" }, state.output.name)
            )
          )
        : blocked.reason === "damaged"
          ? null
          : h("p", null, outputText(blocked))
    )
  )

  if (report.problems.length > 0) {
    nodes.push(
      block(
        words.problemsTitle,
        h("div", { class: "items" }, report.problems.map(problemItem))
      )
    )
  }

  if (report.warnings.length > 0) {
    nodes.push(
      block(
        words.warningsTitle,
        h("p", { class: "muted small" }, words.warningsNote),
        h("div", { class: "items" }, report.warnings.map(problemItem))
      )
    )
  }

  nodes.push(
    block(
      words.audioTitle,
      h(
        "p",
        null,
        audioRefs === 0 ? words.noAudio : words.aliasWritten(withRecord, audioRefs)
      ),
      offVolume > 0 ? h("p", null, words.offVolume(offVolume)) : null
    )
  )

  nodes.push(
    block(words.changedTitle, changesTable(report.changes, "Live 12", "Live 10"))
  )

  if (report.tagDeltas.length > 0) {
    nodes.push(
      block(
        words.elementsTitle,
        h("p", { class: "muted small" }, words.elementsNote),
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
                h("th", { scope: "col" }, words.element),
                h("th", { scope: "col", class: "num" }, words.inV12),
                h("th", { scope: "col", class: "num" }, words.inV10)
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
                  h("td", { class: "num" }, formatNumber(delta.before)),
                  h("td", { class: "num" }, formatNumber(delta.after))
                )
              )
            )
          )
        ),
        report.tagDeltaCount > report.tagDeltas.length
          ? h(
              "p",
              { class: "muted small" },
              words.moreElements(report.tagDeltaCount - report.tagDeltas.length)
            )
          : null
      )
    )
  }

  for (const excerpt of report.excerpts) {
    nodes.push(
      block(
        excerptTitle(excerpt.title),
        h(
          "div",
          { class: "excerpt" },
          h(
            "figure",
            null,
            h("figcaption", null, words.before),
            codeBlock(excerptText(excerpt.before), "xml")
          ),
          h(
            "figure",
            null,
            h("figcaption", null, words.after),
            codeBlock(excerptText(excerpt.after), "xml")
          )
        )
      )
    )
  }

  const cannot = t.convert.cannot
  nodes.push(
    block(
      cannot.title,
      h(
        "ul",
        { class: "plain-list" },
        h("li", null, cannot.jump),
        h("li", null, cannot.folderRef),
        h("li", null, cannot.longFolder),
        h("li", null, cannot.sceneColours)
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
  const words = catalog().convert
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
          badge("idle", words.nothingToConvert),
          " ",
          words.alreadyV10(inspection.version.creator || words.live10OrOlder)
        )
      ),
    ]
  }
  if (inspection.convert.state === "unverified") {
    return [
      block(
        null,
        h("p", null, badge("warn", words.notConverted), " ", words.unverified),
        h("p", null, rich(words.shareLive11))
      ),
    ]
  }

  return [
    block(
      null,
      h("p", null, words.intro),
      h(
        "div",
        { class: "field" },
        h("label", { for: "library-root" }, words.libraryFolder),
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
        h("p", { class: "hint" }, words.libraryHint)
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
          words.button
        )
      )
    ),
    block(
      words.does.title,
      h(
        "ul",
        { class: "plain-list" },
        h("li", null, words.does.tempo),
        h("li", null, words.does.colours),
        h("li", null, words.does.samples),
        h("li", null, words.does.elements)
      )
    ),
  ]
}

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

/** The library function behind each repair. Code, so never translated. */
const TOOL_FUNCTION: Readonly<Record<ToolId, string>> = {
  pointeeIds: "fixPointeeIds",
  rewarp: "rewarpClips",
  followActions: "syncFollowActions",
  mirrorTrack: "mirrorTrackGeometry",
  relinkSamples: "relinkFileRefs",
}

export const TOOL_ORDER: readonly ToolId[] = [
  "pointeeIds",
  "rewarp",
  "followActions",
  "mirrorTrack",
  "relinkSamples",
]

export function toolTitle(tool: ToolId): string {
  return catalog().repair.tools[tool].title
}

function toolStatus(tool: ToolView): HTMLElement {
  const words = catalog().repair.status
  if (tool.blocked !== null) return badge("idle", words.notAvailable)
  if (tool.pending > 0) return badge("warn", words.toFix(tool.pending))
  if (tool.id === "mirrorTrack" || tool.id === "relinkSamples") {
    return badge("idle", words.onRequest)
  }
  return badge("ok", words.nothingToFix)
}

function toolControls(
  tool: ToolView,
  state: SessionState,
  ui: Ui,
  actions: Actions
): HTMLElement {
  const words = catalog().repair
  const applyButton = (
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
      words.tools[tool.id].button
    )

  switch (tool.id) {
    case "pointeeIds":
      return h(
        "div",
        null,
        applyButton(() => ({ tool: "pointeeIds" }), tool.pending > 0)
      )
    case "followActions":
      return h(
        "div",
        null,
        applyButton(() => ({ tool: "followActions" }), tool.pending > 0)
      )
    case "rewarp":
      return h(
        "div",
        { class: "form-row" },
        h(
          "div",
          { class: "field narrow" },
          h("label", { for: "rewarp-bpm" }, words.targetBpm),
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
        applyButton(() => {
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
              translate: "no",
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
          select("mirror-base", words.copyFrom, ui.base, (next) => {
            ui.base = next
          }),
          select("mirror-target", words.onto, ui.target, (next) => {
            ui.target = next
          }),
          applyButton(
            () => ({ tool: "mirrorTrack", base: ui.base, target: ui.target }),
            ui.base !== ui.target && (preview === null || preview.differing > 0)
          )
        ),
        ui.base === ui.target
          ? h("p", { class: "muted small" }, words.pickTwo)
          : preview === null
            ? null
            : h(
                "p",
                { class: "muted small" },
                words.mirrorPreview(
                  preview.shared,
                  preview.differing,
                  preview.baseOnly + preview.targetOnly
                )
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
          h("label", { for: "relink-root" }, words.relinkLabel),
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
          h("p", { class: "hint" }, words.relinkHint)
        ),
        applyButton(() =>
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
  const words = catalog().repair
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
    const meta = words.tools[id]
    const applied = lastStep(id)
    const section = h(
      "section",
      { class: "tool" },
      h(
        "div",
        { class: "tool-head" },
        h("h3", null, meta.title),
        h("span", { class: "code-tag", translate: "no" }, TOOL_FUNCTION[id]),
        toolStatus(tool)
      ),
      h("p", null, meta.about),
      tool.facts.length > 0
        ? h(
            "dl",
            { class: "inline-facts" },
            tool.facts.map((entry) =>
              h(
                "div",
                null,
                h("dt", null, labelText(entry.label)),
                h("dd", null, valueText(entry.value))
              )
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
              blockedText(tool.blocked),
              id === "relinkSamples" && state.inspection.convert.state === "ready"
                ? ` ${words.convertFirst}`
                : ""
            )
          )
        : toolControls(tool, state, ui, actions),
      applied
        ? h(
            "div",
            { class: "block" },
            h("p", null, badge("ok", words.applied), " ", doneText(applied)),
            changesTable(applied.changes, words.before, words.after)
          )
        : null
    )
    // Whichever tool the visitor is working in decides the code shown.
    section.addEventListener("focusin", () => actions.focusTool(id))
    section.addEventListener("pointerdown", () => actions.focusTool(id))
    return section
  })

  return [
    h("p", { class: "muted" }, words.intro),
    h("div", { class: "tools" }, sections),
  ]
}
