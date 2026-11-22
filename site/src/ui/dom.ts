// A small element builder. Text always goes in as text nodes, never as HTML:
// scene names, track names and file paths come straight out of a file a
// stranger handed us.

export type Child = Node | string | number | null | undefined | false

type Listener = (event: Event) => void
type Value = string | number | boolean | null | undefined | Listener

export type Props = Readonly<Record<string, Value>>

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: readonly (Child | readonly Child[])[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue
      if (typeof value === "function") {
        element.addEventListener(key.replace(/^on/, ""), value)
      } else if (value === true) {
        element.setAttribute(key, "")
      } else {
        element.setAttribute(key, String(value))
      }
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    element.append(child instanceof Node ? child : String(child))
  }
  return element
}

/** Sets a CSS custom property through the CSSOM, which the page's CSP allows. */
export function withColor<T extends HTMLElement>(
  element: T,
  hex: string | null
): T {
  if (hex !== null) element.style.setProperty("--c", hex)
  return element
}

const ICONS = {
  check: ["M3.5 8.5l3 3 6-7"],
  copy: ["M5.5 5.5h7v8h-7z", "M3.5 10.5v-8h7"],
  download: ["M8 2.5v8", "M5 7.5l3 3 3-3", "M3 13.5h10"],
  undo: ["M5.5 3.5l-3 3 3 3", "M2.5 6.5h7a3.5 3.5 0 010 7h-3"],
  close: ["M4 4l8 8", "M12 4l-8 8"],
  moon: ["M13 9.6A5.5 5.5 0 016.4 3a5.5 5.5 0 106.6 6.6z"],
  sun: [
    "M8 5.2a2.8 2.8 0 100 5.6 2.8 2.8 0 000-5.6z",
    "M8 1.5V3",
    "M8 13v1.5",
    "M1.5 8H3",
    "M13 8h1.5",
    "M3.4 3.4l1.1 1.1",
    "M11.5 11.5l1.1 1.1",
    "M3.4 12.6l1.1-1.1",
    "M11.5 4.5l1.1-1.1",
  ],
} as const

export type IconName = keyof typeof ICONS

const SVG = "http://www.w3.org/2000/svg"

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg")
  svg.setAttribute("viewBox", "0 0 16 16")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke", "currentColor")
  svg.setAttribute("stroke-width", "1.5")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("stroke-linejoin", "round")
  svg.setAttribute("aria-hidden", "true")
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG, "path")
    path.setAttribute("d", d)
    svg.append(path)
  }
  return svg
}

export type Tone = "ok" | "warn" | "bad" | "idle"

export function badge(tone: Tone, text: string): HTMLSpanElement {
  return h("span", { class: "badge", "data-tone": tone }, text)
}

/** `{ list: 3, track: "BASS" }` as a row of key and value pairs. */
export function valuesList(
  values: Readonly<Record<string, string | number>>
): HTMLElement | null {
  const entries = Object.entries(values)
  if (entries.length === 0) return null
  return h(
    "dl",
    { class: "values", translate: "no" },
    entries.map(([key, value]) =>
      h("div", null, h("dt", null, key), h("dd", null, String(value)))
    )
  )
}

const plurals = new Intl.PluralRules("en")

export function count(value: number, one: string, other: string): string {
  const word = plurals.select(value) === "one" ? one : other
  return `${value.toLocaleString("en")} ${word}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}\u00a0B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}\u00a0KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}\u00a0MB`
}

export function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString("en")
    : String(Number(value.toFixed(2)))
}
