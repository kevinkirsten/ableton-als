// Numbers and plurals for one locale. Pure `Intl`, no DOM, so the catalogs
// that use it load under vitest.

export type Formatter = {
  /** `1234.5` as the locale writes it, with at most `maxFraction` decimals. */
  number(value: number, maxFraction?: number): string
  /** The word that goes with `value`: `one` or `other`, by the locale's rule. */
  pick(value: number, one: string, other: string): string
  /** The number and its word: "1 problem", "3 problems". */
  count(value: number, one: string, other: string): string
  /** A file size: "812 B", "34 KB", "5.2 MB". */
  bytes(bytes: number): string
}

const cache = new Map<string, Formatter>()

export function formatter(locale: string): Formatter {
  const known = cache.get(locale)
  if (known) return known

  const plurals = new Intl.PluralRules(locale)
  const number = (value: number, maxFraction = 2): string =>
    value.toLocaleString(locale, { maximumFractionDigits: maxFraction })
  // Zero takes the plural in all three languages. CLDR files Portuguese 0
  // under `one`, which would print "0 problema".
  const pick = (value: number, one: string, other: string): string =>
    value !== 0 && plurals.select(value) === "one" ? one : other

  const made: Formatter = {
    number,
    pick,
    count: (value, one, other) => `${number(value)} ${pick(value, one, other)}`,
    bytes: (bytes) => {
      if (bytes < 1024) return `${number(bytes, 0)} B`
      if (bytes < 1024 * 1024) return `${number(bytes / 1024, 0)} KB`
      const megabytes = (bytes / (1024 * 1024)).toLocaleString(locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })
      return `${megabytes} MB`
    },
  }
  cache.set(locale, made)
  return made
}
