// The page. It never holds the opened set: the Web Worker does, and sends back
// only what there is to draw.

import type { Inspection, SessionState } from "./engine.js"
import type { Reply, Request } from "./protocol.js"

// The two track names the sample plants a geometry difference between. Kept
// as literals so the page does not bundle the sample generator a second time;
// a test asserts they match what `sample.ts` exports.
const SAMPLE_MIRROR_BASE = "DRUMS"
const SAMPLE_MIRROR_TARGET = "GUITAR"
import { codeBlock, copyButton, snippet, type Runtime } from "./ui/code.js"
import { badge, count, formatBytes, h, icon, withColor } from "./ui/dom.js"
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

declare const __LIB_VERSION__: string
declare const __COMMIT__: string

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
  themeToggle.replaceChildren(icon(theme === "dark" ? "sun" : "moon"))
  themeToggle.setAttribute(
    "aria-label",
    theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"
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
paintTheme()

$("lib-version").textContent = `v${__LIB_VERSION__} (${__COMMIT__})`

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state: SessionState | null = null
let notice: string | null = null
let opening = false

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

// ---------------------------------------------------------------------------
// The worker
// ---------------------------------------------------------------------------

const OPEN_ERRORS: Readonly<Record<string, string>> = {
  empty_file:
    "That file is empty. Pick the .als file inside your project folder.",
  not_gzip:
    "That does not look like a Live Set. An .als file is gzip-compressed XML. Check that you picked the .als itself and not a project folder, an .alp pack or an audio file.",
  corrupt_gzip:
    "The file starts like a Live Set but could not be decompressed, so it is probably truncated. Copy it again from the original disk and retry.",
  not_a_live_set:
    "The file opened, but there is no Live document inside. It may come from another program.",
  too_large:
    "This set is larger than a browser tab handles well. Use the library from Node instead: npm install ableton-als.",
  crashed:
    "Something went wrong while working on the file, most likely the tab ran out of memory. Reload the page and try again, or use the library from Node for a set this size.",
}

const supported =
  typeof Worker === "function" &&
  typeof DecompressionStream === "function" &&
  typeof CompressionStream === "function"

let worker: Worker | null = null
let busyTimer: number | undefined
let busyLabel = ""

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

function setBusy(label: string | null): void {
  ui.busy = label !== null
  busyLabel = label ?? ""
  window.clearTimeout(busyTimer)
  const show = (): void => {
    const target = document.getElementById("busy")
    if (target) {
      target.textContent = busyLabel
      target.hidden = busyLabel === ""
    }
    if (opening) {
      openStatus.removeAttribute("data-kind")
      openStatus.textContent = busyLabel
    }
  }
  // Fast work never flashes a spinner; slow work shows one after a beat.
  if (label === null) show()
  else busyTimer = window.setTimeout(show, 150)
}

function receive(reply: Reply): void {
  switch (reply.type) {
    case "phase":
      busyLabel = reply.label
      if (opening) {
        openStatus.removeAttribute("data-kind")
        openStatus.textContent = reply.label
      }
      {
        const target = document.getElementById("busy")
        if (target && !target.hidden) target.textContent = reply.label
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
        openStatus.textContent = ""
        resetUi()
        seedUi(reply.state)
        announce(`Opened ${reply.state.inspection.fileName}`)
      } else if (reply.state.steps.length > before) {
        notice = null
        announce("Done. The set was updated.")
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
      {
        const message = OPEN_ERRORS[reply.code] ?? OPEN_ERRORS.crashed!
        opening = false
        if (state === null) {
          openStatus.setAttribute("data-kind", "error")
          openStatus.textContent = message
        } else {
          // A file is already open: keep it, and say why the new one failed.
          notice = message
          render()
        }
        announce(message)
      }
      if (reply.code === "crashed") {
        worker?.terminate()
        worker = null
      }
      return
    case "refused":
      notice = reply.message
      setBusy(null)
      announce(reply.message)
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
      announce(`Saved ${reply.name}`)
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
    opened.synthetic &&
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
  openStatus.setAttribute("data-kind", "error")
  openStatus.textContent =
    "This browser lacks the Compression Streams API this page needs. Use a current Chrome, Edge, Firefox or Safari, or use the library from Node: npm install ableton-als."
  return true
}

async function openFile(file: File): Promise<void> {
  if (refuseUnsupported() || ui.busy) return
  opening = true
  notice = null
  setBusy("Reading the file…")
  const bytes = await file.arrayBuffer()
  send({ type: "open", name: file.name, bytes }, [bytes])
}

function openSample(which: "healthy" | "damaged"): void {
  if (refuseUnsupported() || ui.busy) return
  opening = true
  notice = null
  setBusy("Building the sample set…")
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
  grid.style.setProperty("--columns", String(inspection.tracks.length))
  const cells: HTMLElement[] = []
  for (let scene = 0; scene < inspection.scenes.length; scene++) {
    for (const track of inspection.tracks) {
      const clip = track.clips[scene]
      const cell = h("span", clip ? { "data-clip": true } : null)
      cells.push(clip ? withColor(cell, clip.color ?? "var(--clip-none)") : cell)
    }
  }
  grid.replaceChildren(...cells)
  const clips = inspection.audioClips + inspection.midiClips
  $("preview-caption").textContent =
    `The sample set as this page reads it: ${count(inspection.tracks.length, "track", "tracks")}, ${count(inspection.scenes.length, "scene", "scenes")}, ${count(clips, "clip", "clips")}. It is synthetic, written for this page and never saved by Live.`
}

if (supported) send({ type: "preview" })
else refuseUnsupported()

// ---------------------------------------------------------------------------
// Rendering the workspace
// ---------------------------------------------------------------------------

const actions: Actions = {
  convert() {
    if (ui.busy) return
    setBusy("Converting to the Live 10 format…")
    send({ type: "convert", libraryRoot: ui.libraryRoot })
  },
  apply(operation) {
    if (ui.busy) return
    setBusy("Applying the repair…")
    send({ type: "tool", operation })
  },
  download() {
    if (ui.busy) return
    setBusy("Compressing…")
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

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: "inspect", label: "Inspect" },
  { id: "validate", label: "Validate" },
  { id: "convert", label: "Convert" },
  { id: "repair", label: "Repair" },
]

const codeHost = h("aside", { class: "code-panel", "aria-label": "Code for this view" })

function renderCode(): void {
  if (state === null) return
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
  codeHost.replaceChildren(
    h(
      "div",
      { class: "code-head" },
      h("h3", null, "The same thing in code"),
      h(
        "div",
        { class: "form-row" },
        h(
          "div",
          { class: "segmented", role: "group", "aria-label": "Runtime" },
          runtimeButton("browser", "Browser"),
          runtimeButton("node", "Node")
        ),
        copyButton(source, announce)
      )
    ),
    codeBlock(source(), "ts"),
    h(
      "p",
      { class: "muted small" },
      h("code", { translate: "no" }, "npm install ableton-als"),
      ` Works with version ${__LIB_VERSION__} as published. Zero dependencies.`
    )
  )
  if (focused?.startsWith("runtime-")) {
    codeHost.querySelector<HTMLElement>(`[data-key="${focused}"]`)?.focus()
  }
}

function fileBar(current: SessionState): HTMLElement {
  const inspection = current.inspection
  const clips = inspection.audioClips + inspection.midiClips
  const dirty = current.steps.length > 0
  const converted = current.steps.some((step) => step.kind === "convert")
  const canDownload = dirty && current.output.blocked === null
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
        current.synthetic ? badge("idle", "Synthetic sample") : null,
        h("span", null, inspection.version.creator || "Unknown version"),
        h("span", null, count(inspection.tracks.length, "track", "tracks")),
        h("span", null, count(inspection.scenes.length, "scene", "scenes")),
        h("span", null, count(clips, "clip", "clips")),
        h("span", null, formatBytes(inspection.sizeBytes)),
        inspection.problems.length === 0
          ? badge("ok", "No structural problems")
          : badge("bad", count(inspection.problems.length, "problem", "problems"))
      ),
      h("p", { class: "busy", id: "busy", role: "status", hidden: !ui.busy }, busyLabel)
    ),
    h(
      "div",
      { class: "file-actions" },
      dirty && current.output.blocked?.reason !== "synthetic"
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
              title: current.output.blocked?.message ?? "",
              onclick: () => actions.download(),
            },
            icon("download"),
            "Download"
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
        "Open another file"
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
        "Close"
      )
    )
  )
}

function stepsBar(current: SessionState): HTMLElement | null {
  if (current.steps.length === 0) return null
  return h(
    "div",
    { class: "steps" },
    h("span", { class: "muted" }, "Changes so far"),
    h(
      "ol",
      null,
      current.steps.map((step) =>
        h(
          "li",
          null,
          step.kind === "convert" ? "Converted to Live 10" : toolTitle(step.tool)
        )
      )
    ),
    current.output.blocked?.reason === "synthetic"
      ? h("p", { class: "muted steps-note" }, current.output.blocked.message)
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
        "Undo last"
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
        "Back to the original"
      )
    )
  )
}

function tabBar(current: SessionState): HTMLElement {
  const pending = current.inspection.tools.reduce(
    (sum, tool) => sum + (tool.blocked === null ? tool.pending : 0),
    0
  )
  const counts: Partial<Record<Tab, number>> = {
    validate: current.inspection.problems.length,
    repair: pending,
  }
  const buttons = TABS.map((tab) => {
    const total = counts[tab.id] ?? 0
    return h(
      "button",
      {
        class: "tab",
        type: "button",
        role: "tab",
        id: `tab-${tab.id}`,
        "data-key": `tab-${tab.id}`,
        "aria-selected": String(ui.tab === tab.id),
        "aria-controls": "tab-panel",
        tabindex: ui.tab === tab.id ? "0" : "-1",
        onclick: () => selectTab(tab.id),
      },
      tab.label,
      total > 0
        ? h("span", { class: "tab-count" }, total.toLocaleString("en"))
        : null
    )
  })
  const bar = h("div", { class: "tabs", role: "tablist", "aria-label": "Views" }, buttons)
  bar.addEventListener("keydown", (event) => {
    const key = (event as KeyboardEvent).key
    if (key !== "ArrowRight" && key !== "ArrowLeft") return
    const index = TABS.findIndex((tab) => tab.id === ui.tab)
    const next = TABS[(index + (key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!
    selectTab(next.id)
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
            h("p", null, notice),
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
              "Dismiss"
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
      h(
        "p",
        { class: "muted small" },
        "This set is being read on this computer only. Nothing has been uploaded."
      ),
    ].filter((node): node is HTMLElement => node !== null)
  )
  renderCode()

  if (focused) {
    workspace.querySelector<HTMLElement>(`[data-key="${focused}"]`)?.focus()
  }
}
