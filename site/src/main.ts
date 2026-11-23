// The page. It never holds the opened set: the Web Worker does, and sends back
// only what there is to draw.
//
// Every word on it comes from the active catalog in `i18n/`. `index.html`
// carries the English text for the first paint and for a browser without
// JavaScript; from then on `paintStatic` and `render` draw the page from the
// catalog, on load and again whenever the language changes.

import type {
  Inspection,
  OpenError,
  Phase,
  Refusal,
  SessionState,
} from "./engine.js"
import {
  catalog,
  detectLocale,
  isLocale,
  locale,
  LOCALE_STORAGE_KEY,
  LOCALES,
  setLocale,
} from "./i18n/index.js"
import type { Reply, Request } from "./protocol.js"
import { codeBlock, copyButton, snippet, type Runtime } from "./ui/code.js"
import {
  badge,
  formatBytes,
  formatNumber,
  h,
  icon,
  rich,
  withColor,
} from "./ui/dom.js"
import {
  renderConvert,
  renderInspect,
  renderRepair,
  renderValidate,
  snippetFor,
  toolTitle,
  type Actions,
  type Tab,
  type Ui,
} from "./ui/views.js"
import { outputText, refusalText } from "./ui/wording.js"

// The two track names the sample plants a geometry difference between. Kept
// as literals so the page does not bundle the sample generator a second time;
// a test asserts they match what `sample.ts` exports.
const SAMPLE_MIRROR_BASE = "DRUMS"
const SAMPLE_MIRROR_TARGET = "GUITAR"

declare const __LIB_VERSION__: string
declare const __COMMIT__: string

const VERSION = `v${__LIB_VERSION__} (${__COMMIT__})`

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T

const landing = $("landing")
const about = $("about")
const workspace = $("workspace")
const fileInput = $<HTMLInputElement>("file-input")
const openStatus = $("open-status")
const dropVeil = $("drop-veil")
const announcer = $("announcer")

function announce(message: string): void {
  announcer.textContent = ""
  // A fresh task, so a repeated message is still read out.
  window.setTimeout(() => {
    announcer.textContent = message
  }, 50)
}

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

function savedLocale(): string | null {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY)
  } catch {
    // Storage can be blocked. The browser's languages then decide.
    return null
  }
}

// Before anything is drawn: every painter below reads the active catalog.
setLocale(detectLocale(navigator.languages, savedLocale()))

const localeSelect = $<HTMLSelectElement>("locale-select")
localeSelect.replaceChildren(
  ...LOCALES.map((entry) =>
    // `lang` so a screen reader says each name in its own language.
    h("option", { value: entry.id, lang: entry.id }, entry.name)
  )
)
localeSelect.value = locale()
localeSelect.addEventListener("change", () => {
  const next = localeSelect.value
  if (!isLocale(next) || next === locale()) return
  setLocale(next)
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, next)
  } catch {
    // Storage can be blocked; the choice then lasts for this visit.
  }
  paintStatic()
  render()
})

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)")
const themeToggle = $<HTMLButtonElement>("theme-toggle")

function currentTheme(): "light" | "dark" {
  const chosen = document.documentElement.getAttribute("data-theme")
  if (chosen === "light" || chosen === "dark") return chosen
  return darkQuery.matches ? "dark" : "light"
}

function paintTheme(): void {
  const theme = currentTheme()
  const words = catalog().header
  themeToggle.replaceChildren(icon(theme === "dark" ? "sun" : "moon"))
  themeToggle.setAttribute(
    "aria-label",
    theme === "dark" ? words.toLight : words.toDark
  )
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#0f1113" : "#f4f5f6")
}

themeToggle.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark"
  document.documentElement.setAttribute("data-theme", next)
  try {
    localStorage.setItem("theme", next)
  } catch {
    // Storage can be blocked; the choice then lasts for this visit.
  }
  paintTheme()
})
darkQuery.addEventListener("change", paintTheme)

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Something the page has to tell the visitor about, kept as a code so it can
 * be said again in another language.
 */
type Notice =
  | { readonly kind: "open"; readonly code: OpenError | "crashed" }
  | { readonly kind: "refusal"; readonly refusal: Refusal }

/** What the line under the landing's buttons shows. */
type OpenStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | {
      readonly kind: "error"
      readonly code: OpenError | "crashed" | "unsupported"
    }

let state: SessionState | null = null
let notice: Notice | null = null
let opening = false
let openState: OpenStatus = { kind: "idle" }
/** What the landing preview counted in the sample, once it has been read. */
let previewCounts: {
  readonly tracks: number
  readonly scenes: number
  readonly clips: number
} | null = null

const ui: Ui = {
  tab: "inspect",
  runtime: "browser",
  repairFocus: "pointeeIds",
  libraryRoot: "",
  libraryRootEdited: false,
  relinkRoot: "",
  bpm: "",
  base: "",
  target: "",
  mirrorPreview: null,
  selected: null,
  showAllScenes: false,
  showAllFiles: false,
  busy: false,
}

function resetUi(): void {
  ui.tab = "inspect"
  ui.repairFocus = "pointeeIds"
  ui.libraryRoot = ""
  ui.libraryRootEdited = false
  ui.relinkRoot = ""
  ui.bpm = ""
  ui.base = ""
  ui.target = ""
  ui.mirrorPreview = null
  ui.selected = null
  ui.showAllScenes = false
  ui.showAllFiles = false
}

function noticeText(current: Notice): string {
  return current.kind === "open"
    ? catalog().errors.open[current.code]
    : refusalText(current.refusal)
}

// ---------------------------------------------------------------------------
// The static parts of the page: header, landing, about and footer
// ---------------------------------------------------------------------------

function aboutBlocks(): readonly HTMLElement[] {
  const t = catalog()
  const { does, verify, measured } = t.about
  const row = (name: string, text: string): HTMLElement =>
    h("tr", null, h("th", { scope: "row" }, name), h("td", null, text))
  return [
    h(
      "div",
      { class: "about-block" },
      h("h2", null, does.title),
      h(
        "div",
        { class: "table-scroll" },
        h(
          "table",
          { class: "table" },
          h(
            "tbody",
            null,
            row(t.tabs.inspect, does.inspect),
            row(t.tabs.validate, does.validate),
            row(t.tabs.convert, does.convert),
            row(t.tabs.repair, does.repair)
          )
        )
      ),
      h("p", { class: "muted" }, rich(does.code))
    ),
    h(
      "div",
      { class: "about-block", id: "verify" },
      h("h2", null, verify.title),
      h(
        "ol",
        { class: "steps-list" },
        h("li", null, verify.network),
        h("li", null, verify.offline),
        h("li", null, rich(verify.source))
      )
    ),
    h(
      "div",
      { class: "about-block" },
      h("h2", null, measured.title),
      h(
        "ul",
        { class: "plain-list" },
        h("li", null, measured.versions),
        h("li", null, rich(measured.aliases)),
        h("li", null, measured.live11),
        h("li", null, rich(measured.windows)),
        h("li", null, measured.original)
      )
    ),
  ]
}

function paintPreviewCaption(): void {
  const words = catalog().landing
  $("preview-caption").textContent =
    previewCounts === null
      ? words.previewCaption
      : words.previewCaptionCounted(
          previewCounts.tracks,
          previewCounts.scenes,
          previewCounts.clips
        )
}

function paintOpenStatus(): void {
  const t = catalog()
  if (openState.kind === "error") {
    openStatus.setAttribute("data-kind", "error")
    openStatus.textContent =
      openState.code === "unsupported"
        ? t.errors.unsupportedBrowser
        : t.errors.open[openState.code]
    return
  }
  openStatus.removeAttribute("data-kind")
  openStatus.textContent = openState.kind === "busy" ? busyText() : ""
}

/**
 * Everything that is not the workspace, from the catalog. In English it
 * draws exactly what `index.html` already shows, so nothing moves on load.
 */
function paintStatic(): void {
  const t = catalog()
  document.documentElement.lang = locale()
  document.title = t.meta.title
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute("content", t.meta.description)

  $("brand-note").textContent = t.header.demo
  $("top-nav").setAttribute("aria-label", t.header.projectLinks)
  $("locale-label").textContent = t.header.language
  paintTheme()

  $("landing-title").textContent = t.landing.title
  $("landing-lead").replaceChildren(...rich(t.landing.lead))
  $("drop-title").replaceChildren(...rich(t.landing.dropTitle))
  $("choose-label").textContent = t.landing.chooseFile
  $("open-sample").textContent = t.landing.openSample
  $("open-damaged").textContent = t.landing.openDamaged
  $("privacy").replaceChildren(...rich(t.landing.privacy))
  $("landing-preview").setAttribute("aria-label", t.landing.previewLabel)
  paintPreviewCaption()
  paintOpenStatus()

  about.replaceChildren(...aboutBlocks())

  $("foot-license").replaceChildren(...rich(t.footer.license(VERSION)))
  $("foot-privacy").textContent = t.footer.privacy
  $("drop-veil-text").textContent = t.landing.dropVeil
}

// ---------------------------------------------------------------------------
// The worker
// ---------------------------------------------------------------------------

const supported =
  typeof Worker === "function" &&
  typeof DecompressionStream === "function" &&
  typeof CompressionStream === "function"

let worker: Worker | null = null
let busyTimer: number | undefined
/** What the worker is doing, as the code it reported. `null` when idle. */
let busyPhase: Phase | null = null

function busyText(): string {
  return busyPhase === null ? "" : catalog().phases[busyPhase]
}

function startWorker(): Worker {
  const next = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  })
  next.addEventListener("message", (event: MessageEvent<Reply>) =>
    receive(event.data)
  )
  next.addEventListener("error", () => receive({ type: "openError", code: "crashed" }))
  return next
}

function send(request: Request, transfer: Transferable[] = []): void {
  worker ??= startWorker()
  worker.postMessage(request, transfer)
}

function setBusy(phase: Phase | null): void {
  ui.busy = phase !== null
  busyPhase = phase
  window.clearTimeout(busyTimer)
  const show = (): void => {
    const target = document.getElementById("busy")
    if (target) {
      target.textContent = busyText()
      target.hidden = busyPhase === null
    }
    if (opening) {
      openState = { kind: busyPhase === null ? "idle" : "busy" }
      paintOpenStatus()
    }
  }
  // Fast work never flashes a spinner; slow work shows one after a beat.
  if (phase === null) show()
  else busyTimer = window.setTimeout(show, 150)
}

function receive(reply: Reply): void {
  switch (reply.type) {
    case "phase":
      busyPhase = reply.phase
      if (opening) {
        openState = { kind: "busy" }
        paintOpenStatus()
      }
      {
        const target = document.getElementById("busy")
        if (target && !target.hidden) target.textContent = busyText()
      }
      return
    case "preview":
      return paintPreview(reply.inspection)
    case "state": {
      const first = state === null
      const before = state?.steps.length ?? 0
      state = reply.state
      setBusy(null)
      if (opening) {
        opening = false
        openState = { kind: "idle" }
        paintOpenStatus()
        resetUi()
        seedUi(reply.state)
        announce(catalog().announce.opened(reply.state.inspection.fileName))
      } else if (reply.state.steps.length > before) {
        notice = null
        announce(catalog().announce.updated)
      }
      if (!ui.libraryRootEdited) {
        ui.libraryRoot = reply.state.inspection.libraryRootGuess
      }
      render()
      if (first) window.scrollTo({ top: 0 })
      requestMirrorPreview()
      return
    }
    case "closed":
      state = null
      notice = null
      setBusy(null)
      render()
      return
    case "openError":
      setBusy(null)
      opening = false
      if (state === null) {
        openState = { kind: "error", code: reply.code }
        paintOpenStatus()
      } else {
        // A file is already open: keep it, and say why the new one failed.
        notice = { kind: "open", code: reply.code }
        render()
      }
      announce(catalog().errors.open[reply.code])
      if (reply.code === "crashed") {
        worker?.terminate()
        worker = null
      }
      return
    case "refused":
      notice = { kind: "refusal", refusal: reply.refusal }
      setBusy(null)
      announce(refusalText(reply.refusal))
      render()
      return
    case "mirrorPreview":
      ui.mirrorPreview = reply.preview
      if (ui.tab === "repair") render()
      return
    case "file": {
      setBusy(null)
      const url = URL.createObjectURL(
        new Blob([reply.bytes], { type: "application/octet-stream" })
      )
      const link = h("a", { href: url, download: reply.name })
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      announce(catalog().announce.saved(reply.name))
      return
    }
  }
}

function seedUi(opened: SessionState): void {
  const inspection = opened.inspection
  const names = inspection.trackNames
  ui.libraryRoot = inspection.libraryRootGuess
  ui.bpm = inspection.masterTempo === null ? "" : String(inspection.masterTempo)
  // The sample has one pair of tracks planted to differ.
  const planted =
    opened.origin !== "file" &&
    names.includes(SAMPLE_MIRROR_BASE) &&
    names.includes(SAMPLE_MIRROR_TARGET)
  ui.base = planted ? SAMPLE_MIRROR_BASE : (names[0] ?? "")
  ui.target = planted ? SAMPLE_MIRROR_TARGET : (names[1] ?? "")
}

function requestMirrorPreview(): void {
  if (state === null || ui.base === "" || ui.target === "" || ui.base === ui.target) {
    ui.mirrorPreview = null
    return
  }
  const names = state.inspection.trackNames
  if (!names.includes(ui.base) || !names.includes(ui.target)) return
  send({ type: "previewMirror", base: ui.base, target: ui.target })
}

// ---------------------------------------------------------------------------
// Opening a file
// ---------------------------------------------------------------------------

function refuseUnsupported(): boolean {
  if (supported) return false
  openState = { kind: "error", code: "unsupported" }
  paintOpenStatus()
  return true
}

async function openFile(file: File): Promise<void> {
  if (refuseUnsupported() || ui.busy) return
  opening = true
  notice = null
  setBusy("reading_file")
  const bytes = await file.arrayBuffer()
  send({ type: "open", name: file.name, bytes }, [bytes])
}

function openSample(which: "healthy" | "damaged"): void {
  if (refuseUnsupported() || ui.busy) return
  opening = true
  notice = null
  setBusy("building_sample")
  send({ type: "sample", which })
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0]
  fileInput.value = ""
  if (file) void openFile(file)
})
$("open-sample").addEventListener("click", () => openSample("healthy"))
$("open-damaged").addEventListener("click", () => openSample("damaged"))

// Dropping works over the whole window. Without `preventDefault` on dragover
// the browser navigates to the file and the visitor loses their place.
let dragDepth = 0
const carriesFiles = (event: DragEvent): boolean =>
  event.dataTransfer?.types.includes("Files") ?? false

window.addEventListener("dragenter", (event) => {
  if (!carriesFiles(event)) return
  event.preventDefault()
  dragDepth++
  dropVeil.hidden = false
})
window.addEventListener("dragover", (event) => {
  if (carriesFiles(event)) event.preventDefault()
})
window.addEventListener("dragleave", (event) => {
  if (!carriesFiles(event)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dropVeil.hidden = true
})
window.addEventListener("drop", (event) => {
  if (!carriesFiles(event)) return
  event.preventDefault()
  dragDepth = 0
  dropVeil.hidden = true
  const file = event.dataTransfer?.files[0]
  if (file) void openFile(file)
})

// ---------------------------------------------------------------------------
// The landing preview: the sample set, drawn the way the page reads it
// ---------------------------------------------------------------------------

function paintPreview(inspection: Inspection): void {
  const grid = $("preview-grid")
  // Return tracks have no clip slots, so they get no column.
  const tracks = inspection.tracks.filter(
    (track) => track.type !== "ReturnTrack"
  )
  grid.style.setProperty("--columns", String(tracks.length))
  const cells: HTMLElement[] = []
  for (let scene = 0; scene < inspection.scenes.length; scene++) {
    for (const track of tracks) {
      const clip = track.clips[scene]
      const cell = h("span", clip ? { "data-clip": true } : null)
      cells.push(clip ? withColor(cell, clip.color ?? "var(--clip-none)") : cell)
    }
  }
  grid.replaceChildren(...cells)
  previewCounts = {
    tracks: inspection.tracks.length,
    scenes: inspection.scenes.length,
    clips: inspection.audioClips + inspection.midiClips,
  }
  paintPreviewCaption()
}

// ---------------------------------------------------------------------------
// Rendering the workspace
// ---------------------------------------------------------------------------

const actions: Actions = {
  convert() {
    if (ui.busy) return
    setBusy("converting")
    send({ type: "convert", libraryRoot: ui.libraryRoot })
  },
  apply(operation) {
    if (ui.busy) return
    setBusy("repairing")
    send({ type: "tool", operation })
  },
  download() {
    if (ui.busy) return
    setBusy("compressing")
    send({ type: "download" })
  },
  requestMirrorPreview,
  refreshCode: () => renderCode(),
  focusTool(tool) {
    if (ui.repairFocus === tool) return
    ui.repairFocus = tool
    renderCode()
  },
  rerender: () => render(),
}

function showLanding(): void {
  workspace.hidden = true
  landing.hidden = false
  about.hidden = false
}

const TABS: readonly Tab[] = ["inspect", "validate", "convert", "repair"]

const codeHost = h("aside", { class: "code-panel" })

function renderCode(): void {
  if (state === null) return
  const words = catalog().code
  const focused = document.activeElement?.getAttribute("data-key")
  const id = snippetFor(ui)
  const source = (): string =>
    snippet(id, ui.runtime, {
      fileName: state?.inspection.fileName ?? "Song.als",
      libraryRoot:
        id === "relinkSamples" && ui.relinkRoot.trim() !== ""
          ? ui.relinkRoot
          : ui.libraryRoot,
      bpm: ui.bpm,
      base: ui.base,
      target: ui.target,
    })
  const runtimeButton = (runtime: Runtime, label: string): HTMLElement =>
    h(
      "button",
      {
        type: "button",
        "data-key": `runtime-${runtime}`,
        "aria-pressed": String(ui.runtime === runtime),
        onclick: () => {
          ui.runtime = runtime
          renderCode()
        },
      },
      label
    )
  codeHost.setAttribute("aria-label", words.panelLabel)
  codeHost.replaceChildren(
    h(
      "div",
      { class: "code-head" },
      h("h3", null, words.title),
      h(
        "div",
        { class: "form-row" },
        h(
          "div",
          { class: "segmented", role: "group", "aria-label": words.runtime },
          runtimeButton("browser", words.browser),
          runtimeButton("node", words.node)
        ),
        copyButton(source, announce)
      )
    ),
    codeBlock(source(), "ts"),
    h(
      "p",
      { class: "muted small" },
      h("code", { translate: "no" }, "npm install ableton-als"),
      " ",
      words.worksWith(__LIB_VERSION__)
    )
  )
  if (focused?.startsWith("runtime-")) {
    codeHost.querySelector<HTMLElement>(`[data-key="${focused}"]`)?.focus()
  }
}

function fileBar(current: SessionState): HTMLElement {
  const t = catalog()
  const words = t.fileBar
  const inspection = current.inspection
  const clips = inspection.audioClips + inspection.midiClips
  const dirty = current.steps.length > 0
  const converted = current.steps.some((step) => step.kind === "convert")
  const blocked = current.output.blocked
  const canDownload = dirty && blocked === null
  return h(
    "div",
    { class: "file-bar" },
    h(
      "div",
      { class: "file-id" },
      h("h2", { class: "file-name", translate: "no" }, inspection.fileName),
      h(
        "div",
        { class: "file-meta" },
        current.origin === "damaged" ? badge("bad", words.damagedSample) : null,
        h("span", null, inspection.version.creator || words.unknownVersion),
        h("span", null, t.common.tracks(inspection.tracks.length)),
        h("span", null, t.common.scenes(inspection.scenes.length)),
        h("span", null, t.common.clips(clips)),
        h("span", null, formatBytes(inspection.sizeBytes)),
        inspection.problems.length === 0
          ? badge("ok", words.noProblems)
          : badge("bad", t.common.problems(inspection.problems.length))
      ),
      h("p", { class: "busy", id: "busy", role: "status", hidden: !ui.busy }, busyText())
    ),
    h(
      "div",
      { class: "file-actions" },
      dirty && blocked?.reason !== "damaged"
        ? h(
            "button",
            {
              // On the Convert view the result has its own filled button.
              class:
                ui.tab === "convert" && converted
                  ? "button"
                  : "button button-primary",
              type: "button",
              "data-key": "download",
              disabled: !canDownload,
              title: blocked === null ? "" : outputText(blocked),
              onclick: () => actions.download(),
            },
            icon("download"),
            words.download
          )
        : null,
      h(
        "button",
        {
          class: "button",
          type: "button",
          "data-key": "open-another",
          onclick: () => fileInput.click(),
        },
        words.openAnother
      ),
      h(
        "button",
        {
          class: "button button-quiet",
          type: "button",
          "data-key": "close",
          onclick: () => send({ type: "close" }),
        },
        icon("close"),
        words.close
      )
    )
  )
}

function stepsBar(current: SessionState): HTMLElement | null {
  if (current.steps.length === 0) return null
  const words = catalog().steps
  const blocked = current.output.blocked
  return h(
    "div",
    { class: "steps" },
    h("span", { class: "muted" }, words.title),
    h(
      "ol",
      null,
      current.steps.map((step) =>
        h(
          "li",
          null,
          step.kind === "convert" ? words.converted : toolTitle(step.tool)
        )
      )
    ),
    blocked?.reason === "damaged"
      ? h("p", { class: "muted steps-note" }, outputText(blocked))
      : null,
    h(
      "div",
      { class: "steps-actions" },
      h(
        "button",
        {
          class: "button button-quiet",
          type: "button",
          "data-key": "undo",
          disabled: !current.canUndo,
          onclick: () => {
            if (!ui.busy) send({ type: "undo" })
          },
        },
        icon("undo"),
        words.undo
      ),
      h(
        "button",
        {
          class: "button button-quiet",
          type: "button",
          "data-key": "reset",
          onclick: () => {
            if (!ui.busy) send({ type: "reset" })
          },
        },
        words.reset
      )
    )
  )
}

function tabBar(current: SessionState): HTMLElement {
  const words = catalog().tabs
  const pending = current.inspection.tools.reduce(
    (sum, tool) => sum + (tool.blocked === null ? tool.pending : 0),
    0
  )
  const counts: Partial<Record<Tab, number>> = {
    validate: current.inspection.problems.length,
    repair: pending,
  }
  const buttons = TABS.map((tab) => {
    const total = counts[tab] ?? 0
    return h(
      "button",
      {
        class: "tab",
        type: "button",
        role: "tab",
        id: `tab-${tab}`,
        "data-key": `tab-${tab}`,
        "aria-selected": String(ui.tab === tab),
        "aria-controls": "tab-panel",
        tabindex: ui.tab === tab ? "0" : "-1",
        onclick: () => selectTab(tab),
      },
      words[tab],
      total > 0 ? h("span", { class: "tab-count" }, formatNumber(total)) : null
    )
  })
  const bar = h(
    "div",
    { class: "tabs", role: "tablist", "aria-label": words.label },
    buttons
  )
  bar.addEventListener("keydown", (event) => {
    const key = (event as KeyboardEvent).key
    if (key !== "ArrowRight" && key !== "ArrowLeft") return
    const index = TABS.indexOf(ui.tab)
    const next = TABS[(index + (key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!
    selectTab(next)
  })
  return bar
}

function selectTab(tab: Tab): void {
  ui.tab = tab
  render()
  document.getElementById(`tab-${tab}`)?.focus()
}

function render(): void {
  if (state === null) {
    workspace.replaceChildren()
    showLanding()
    return
  }
  const current = state
  const words = catalog().fileBar
  const focused = document.activeElement?.getAttribute("data-key")

  const view =
    ui.tab === "inspect"
      ? renderInspect(current, ui, actions)
      : ui.tab === "validate"
        ? renderValidate(current)
        : ui.tab === "convert"
          ? renderConvert(current, ui, actions)
          : renderRepair(current, ui, actions)

  landing.hidden = true
  about.hidden = true
  workspace.hidden = false
  workspace.replaceChildren(
    ...[
      fileBar(current),
      notice === null
        ? null
        : h(
            "div",
            { class: "notice", role: "alert" },
            h("p", null, noticeText(notice)),
            h(
              "button",
              {
                class: "button button-quiet",
                type: "button",
                "data-key": "dismiss",
                onclick: () => {
                  notice = null
                  render()
                },
              },
              words.dismiss
            )
          ),
      stepsBar(current),
      tabBar(current),
      h(
        "div",
        { class: "panel" },
        h(
          "div",
          {
            class: "panel-main",
            id: "tab-panel",
            role: "tabpanel",
            "aria-labelledby": `tab-${ui.tab}`,
          },
          view
        ),
        codeHost
      ),
      h("p", { class: "muted small" }, words.localOnly),
    ].filter((node): node is HTMLElement => node !== null)
  )
  renderCode()

  if (focused) {
    workspace.querySelector<HTMLElement>(`[data-key="${focused}"]`)?.focus()
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

paintStatic()
if (supported) send({ type: "preview" })
else refuseUnsupported()
