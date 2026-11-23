// The page's own wording for every message the library can produce.
//
// The library hands each message over twice: as English prose (`detail`) and
// taken apart into a stable `code` plus the `values` that belong to it. The
// second form exists so an application can say it in its own words or its own
// language, and this page is that mechanism in use: it words every code in
// three languages, in `i18n/en.ts`, `i18n/pt-BR.ts` and `i18n/es.ts`.
//
// The value shapes are determined by the code, so a placeholder that does not
// exist is a type error in a catalog, not a blank on someone's screen. And
// because every catalog is typed as `Wording`, a code the library adds fails
// the build in all three until someone words it.

import type { DowngradeWarning, ValidationProblem } from "../../src/index.js"
import { catalog, type Catalog } from "./i18n/index.js"

export type Message = ValidationProblem | DowngradeWarning

export type Wording = {
  readonly [Code in Message["code"]]: (
    values: Extract<Message, { readonly code: Code }>["values"]
  ) => string
}

/**
 * The message in this page's words, in the active language unless a catalog
 * is given. A code this page has no wording for yet (a newer library) falls
 * back to the library's own English prose.
 */
export function describe(
  message: {
    readonly code: string
    readonly values: Readonly<Record<string, string | number>>
    readonly detail: string
  },
  words: Catalog = catalog()
): string {
  const wording = (
    words.messages as Readonly<
      Record<string, ((values: never) => string) | undefined>
    >
  )[message.code]
  if (wording) return wording(message.values as never)
  const text = message.detail.trim()
  const capital = text.charAt(0).toUpperCase() + text.slice(1)
  return /[.!?]$/.test(capital) ? capital : `${capital}.`
}

/** Every code a catalog words. Used by the tests. */
export function wordedCodes(words: Catalog = catalog()): readonly string[] {
  return Object.keys(words.messages)
}
