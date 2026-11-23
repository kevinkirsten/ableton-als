// The code shown next to every action. The snippets are real `.ts` files in
// `../snippets`, typechecked against the library's source in CI, so what the
// page shows cannot drift from what the library exports.

import type { ToolId } from "../../../src/index.js"
import convertBrowser from "../snippets/convert.browser.ts?raw"
import convertNode from "../snippets/convert.node.ts?raw"
import followBrowser from "../snippets/followActions.browser.ts?raw"
import followNode from "../snippets/followActions.node.ts?raw"
import inspectBrowser from "../snippets/inspect.browser.ts?raw"
import inspectNode from "../snippets/inspect.node.ts?raw"
import mirrorBrowser from "../snippets/mirrorTrack.browser.ts?raw"
import mirrorNode from "../snippets/mirrorTrack.node.ts?raw"
import pointeeBrowser from "../snippets/pointeeIds.browser.ts?raw"
import pointeeNode from "../snippets/pointeeIds.node.ts?raw"
import relinkBrowser from "../snippets/relinkSamples.browser.ts?raw"
import relinkNode from "../snippets/relinkSamples.node.ts?raw"
import rewarpBrowser from "../snippets/rewarp.browser.ts?raw"
import rewarpNode from "../snippets/rewarp.node.ts?raw"
import validateBrowser from "../snippets/validate.browser.ts?raw"
import validateNode from "../snippets/validate.node.ts?raw"
import { catalog } from "../i18n/index.js"
import { h, icon } from "./dom.js"

export type SnippetId = "inspect" | "validate" | "convert" | ToolId
export type Runtime = "browser" | "node"

const SOURCES: Readonly<Record<SnippetId, Readonly<Record<Runtime, string>>>> = {
  inspect: { browser: inspectBrowser, node: inspectNode },
  validate: { browser: validateBrowser, node: validateNode },
  convert: { browser: convertBrowser, node: convertNode },
  pointeeIds: { browser: pointeeBrowser, node: pointeeNode },
  rewarp: { browser: rewarpBrowser, node: rewarpNode },
  followActions: { browser: followBrowser, node: followNode },
  mirrorTrack: { browser: mirrorBrowser, node: mirrorNode },
  relinkSamples: { browser: relinkBrowser, node: relinkNode },
}

export type SnippetValues = {
  readonly fileName: string
  readonly libraryRoot: string
  readonly bpm: string
  readonly base: string
  readonly target: string
}

/**
 * The snippet with the visitor's own values in place of the defaults the
 * files are written with, so what they copy matches what they just did.
 */
export function snippet(
  id: SnippetId,
  runtime: Runtime,
  values: SnippetValues
): string {
  const stem = values.fileName.replace(/\.(als|xml)$/i, "") || "Song"
  const quoted = (text: string): string => JSON.stringify(text)
  let source = SOURCES[id][runtime].trimEnd()
  source = source
    .replaceAll('"Song.als"', quoted(`${stem}.als`))
    .replaceAll('"Song [fix].als"', quoted(`${stem} [fix].als`))
    .replaceAll('"Song [v10].als"', quoted(`${stem} [v10].als`))
  if (values.libraryRoot.trim() !== "") {
    source = source.replaceAll(
      '"/Volumes/Demo SSD/Library"',
      quoted(values.libraryRoot.trim())
    )
  }
  const bpm = Number(values.bpm)
  if (Number.isFinite(bpm) && bpm > 0) {
    source = source.replace("rewarpClips(xml, 120)", `rewarpClips(xml, ${bpm})`)
  }
  if (values.base !== "" && values.target !== "") {
    source = source
      .replaceAll('"DRUMS", "BASS"', `${quoted(values.base)}, ${quoted(values.target)}`)
  }
  return source
}

const TS_TOKEN =
  /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(import|from|export|async|function|const|await|return|if|for|of|throw|new)\b|\b(\d+(?:\.\d+)?)\b/g

const XML_TOKEN = /(<\/?[\w.:-]+|\/?>)|("[^"]*")/g

function tokenize(
  source: string,
  pattern: RegExp,
  classes: readonly string[]
): DocumentFragment {
  const fragment = document.createDocumentFragment()
  let cursor = 0
  pattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > cursor) fragment.append(source.slice(cursor, match.index))
    const group = match.slice(1).findIndex((part) => part !== undefined)
    fragment.append(h("span", { class: classes[group] ?? "" }, match[0]))
    cursor = match.index + match[0].length
  }
  if (cursor < source.length) fragment.append(source.slice(cursor))
  return fragment
}

export function codeBlock(source: string, language: "ts" | "xml"): HTMLElement {
  const code = h("code", null)
  code.append(
    language === "ts"
      ? tokenize(source, TS_TOKEN, [
          "t-comment",
          "t-string",
          "t-keyword",
          "t-number",
        ])
      : tokenize(source, XML_TOKEN, ["t-tag", "t-string"])
  )
  // `tabindex` so a keyboard user can scroll a wide block sideways.
  return h("pre", { class: "code", translate: "no", tabindex: "0" }, code)
}

/** A copy button whose icon turns into a check for two seconds. */
export function copyButton(
  text: () => string,
  announce: (message: string) => void
): HTMLButtonElement {
  const label = h("span", null, catalog().code.copy)
  const button = h("button", { class: "button", type: "button" }, icon("copy"), label)
  let timer: number | undefined
  button.addEventListener("click", () => {
    const done = (ok: boolean): void => {
      // Read when the click lands, so the words follow a language change.
      const words = catalog()
      button.replaceChildren(icon(ok ? "check" : "copy"), label)
      label.textContent = ok ? words.code.copied : words.code.selectAndCopy
      announce(ok ? words.announce.codeCopied : words.announce.copyBlocked)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        button.replaceChildren(icon("copy"), label)
        label.textContent = catalog().code.copy
      }, 2000)
    }
    navigator.clipboard.writeText(text()).then(
      () => done(true),
      () => done(false)
    )
  })
  return button
}
