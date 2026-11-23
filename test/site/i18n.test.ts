import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { downgradeToV10, validateGeneratedSet } from "../../src/index.js"
import { decodeAls } from "../../src/node.js"
import {
  CATALOGS,
  detectLocale,
  LOCALES,
  type Catalog,
} from "../../site/src/i18n/index.js"
import { describe as describeMessage, wordedCodes } from "../../site/src/messages.js"
import {
  buildDamagedSampleSet,
  SAMPLE_LIBRARY_ROOT,
} from "../../site/src/sample-set.js"

/**
 * A stand-in for any argument a catalog function takes: a number when used as
 * one, an object whose every property is another stand-in, and callable. It
 * lets the test call every sentence without knowing its signature.
 */
function anything(): unknown {
  const target = () => "x"
  return new Proxy(target, {
    get: (_, key) =>
      key === Symbol.toPrimitive
        ? () => 3
        : key === "length"
          ? 3
          : anything(),
    apply: () => "x",
  })
}

/** Every string a catalog can produce, with the path it lives at. */
function sentences(node: unknown, path: string): [string, string][] {
  if (typeof node === "string") return [[path, node]]
  if (typeof node === "function") {
    const args = Array.from({ length: Math.max(node.length, 1) }, anything)
    return sentences((node as (...values: unknown[]) => unknown)(...args), path)
  }
  if (Array.isArray(node)) {
    return node.flatMap((child, index) => sentences(child, `${path}[${index}]`))
  }
  if (node !== null && typeof node === "object") {
    return Object.entries(node).flatMap(([key, child]) =>
      sentences(child, `${path}.${key}`)
    )
  }
  return []
}

const sample = decodeAls(
  readFileSync(new URL("../../site/sample/Demo Set.als", import.meta.url))
)

describe("the three catalogs", () => {
  it("are English, Brazilian Portuguese and Spanish, each under its own name", () => {
    expect(LOCALES).toEqual([
      { id: "en", name: "English" },
      { id: "pt-BR", name: "Português" },
      { id: "es", name: "Español" },
    ])
  })

  for (const { id } of LOCALES) {
    const all = sentences(CATALOGS[id], id)

    it(`${id}: every sentence is non-empty and carries no placeholder left over`, () => {
      expect(all.length).toBeGreaterThan(150)
      for (const [path, text] of all) {
        expect(text.trim(), path).not.toBe("")
        expect(text, path).not.toMatch(/undefined|\[object Object\]|NaN/)
      }
    })

    it(`${id}: no dash used as punctuation, and no exclamation mark`, () => {
      for (const [path, text] of all) {
        expect(text, path).not.toMatch(/[—–!]/)
      }
    })

    it(`${id}: never mentions the typeface`, () => {
      for (const [path, text] of all) {
        expect(text, path).not.toMatch(/IBM Plex|SIL Open Font|typeface|tipograf/i)
      }
    })

    it(`${id}: keeps the trademark marks exactly as Ableton lists them`, () => {
      const footer = sentences(CATALOGS[id].footer, id)
        .map(([, text]) => text)
        .join(" ")
      expect(footer).toContain("Ableton®")
      expect(footer).toContain("Live™")
    })
  }

  it("say the same number of things in every language", () => {
    const shape = (catalog: Catalog) =>
      sentences(catalog, "").map(([path]) => path).sort()
    expect(shape(CATALOGS["pt-BR"])).toEqual(shape(CATALOGS.en))
    expect(shape(CATALOGS.es)).toEqual(shape(CATALOGS.en))
  })
})

describe("the library's messages, in each language", () => {
  const damaged = validateGeneratedSet(buildDamagedSampleSet(sample))
  const converted = downgradeToV10(sample, { libraryRoot: SAMPLE_LIBRARY_ROOT })
  if (!converted.ok) throw new Error(converted.error)
  const messages = [...damaged, ...converted.warnings]

  it("the sample produces real problems and warnings to word", () => {
    expect(new Set(messages.map((message) => message.code)).size).toBe(8)
  })

  for (const { id } of LOCALES) {
    it(`${id}: words every code with its own values, never the library's English`, () => {
      const catalog = CATALOGS[id]
      for (const message of messages) {
        expect(wordedCodes(catalog), message.code).toContain(message.code)
        const text = describeMessage(message, catalog)
        expect(text).not.toBe(message.detail)
        expect(text).not.toMatch(/undefined|\[object Object\]|[—–]/)
      }
      const grid = damaged.find((problem) => problem.code === "grid_slot_count")!
      expect(describeMessage(grid, catalog)).toContain("BASS")
    })
  }

  it("falls back to the library's prose for a code no catalog knows yet", () => {
    expect(
      describeMessage({
        code: "from_the_future",
        values: {},
        detail: "something new",
      })
    ).toBe("Something new.")
  })
})

describe("plurals", () => {
  it("puts zero in the plural in every language, Portuguese included", async () => {
    const { formatter } = await import("../../site/src/i18n/format.js")
    expect(formatter("pt-BR").count(0, "problema", "problemas")).toBe(
      "0 problemas"
    )
    expect(formatter("pt-BR").count(1, "problema", "problemas")).toBe(
      "1 problema"
    )
    expect(formatter("es").count(0, "problema", "problemas")).toBe("0 problemas")
    expect(formatter("en").count(1, "problem", "problems")).toBe("1 problem")
  })
})

describe("detectLocale", () => {
  it("honours a saved choice first", () => {
    expect(detectLocale(["pt-BR"], "es")).toBe("es")
  })

  it("ignores a saved value that is not a language the page speaks", () => {
    expect(detectLocale(["pt-BR"], "fr")).toBe("pt-BR")
  })

  it("maps any Portuguese to pt-BR and any Spanish to es", () => {
    expect(detectLocale(["pt-PT"], null)).toBe("pt-BR")
    expect(detectLocale(["pt-BR", "en"], null)).toBe("pt-BR")
    expect(detectLocale(["es-AR"], null)).toBe("es")
  })

  it("takes the first language it speaks, and English otherwise", () => {
    expect(detectLocale(["de-DE", "es-MX", "en"], null)).toBe("es")
    expect(detectLocale(["de-DE", "fr"], null)).toBe("en")
    expect(detectLocale([], null)).toBe("en")
  })
})
