// The page's languages. English is the default and the source of truth; the
// other catalogs are typed against it, so the compiler is what guarantees a
// sentence exists in all three. There is no lookup by string key and no
// fallback chain: `catalog().landing.title` either compiles or it does not.
//
// Nothing here touches the DOM or storage, so it loads under vitest. The page
// (`main.ts`) reads the saved choice and the browser's languages and hands
// them to `detectLocale`.

import { en, type Catalog } from "./en.js"
import { es } from "./es.js"
import { ptBR } from "./pt-BR.js"

export type { Catalog } from "./en.js"

export type Locale = "en" | "pt-BR" | "es"

/** Each language under its own name, in the order the picker lists them. */
export const LOCALES: readonly {
  readonly id: Locale
  readonly name: string
}[] = [
  { id: "en", name: "English" },
  { id: "pt-BR", name: "Português" },
  { id: "es", name: "Español" },
]

export const CATALOGS: Readonly<Record<Locale, Catalog>> = {
  en,
  "pt-BR": ptBR,
  es,
}

/** The key the visitor's choice is saved under in `localStorage`. */
export const LOCALE_STORAGE_KEY = "locale"

export function isLocale(value: unknown): value is Locale {
  return LOCALES.some((entry) => entry.id === value)
}

/**
 * The language to start in: the saved choice when there is a valid one, else
 * the first of the browser's languages this page speaks, else English. Any
 * Portuguese gets pt-BR and any Spanish gets es, by language prefix.
 */
export function detectLocale(
  languages: readonly string[],
  saved: string | null
): Locale {
  if (isLocale(saved)) return saved
  for (const language of languages) {
    const prefix = language.toLowerCase().split("-")[0]
    if (prefix === "pt") return "pt-BR"
    if (prefix === "es") return "es"
    if (prefix === "en") return "en"
  }
  return "en"
}

let active: Locale = "en"

export function locale(): Locale {
  return active
}

export function setLocale(next: Locale): void {
  active = next
}

/** The catalog of the active language. */
export function catalog(): Catalog {
  return CATALOGS[active]
}
