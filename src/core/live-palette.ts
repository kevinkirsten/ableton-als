// ---------------------------------------------------------------------------
// The Ableton Live 10 color palette (70 colors, 5 rows × 14), to paint scenes
// and clips in a UI with the SAME color the operator sees in Session View.
//
// The v10 file stores the index in two ranges (measured against real files):
//   140..199 → colors 0..59        278..287 → colors 60..69
//   0 (or absent) = no color
//
// The hex values are the consolidated visual approximation of the Live 10
// palette — they serve a UI, not file writing.
// ---------------------------------------------------------------------------

const LIVE_PALETTE: readonly string[] = [
  // row 1 — bright vivids
  "#FF94A6",
  "#FFA529",
  "#CC9927",
  "#F7F47C",
  "#BFFB00",
  "#1AFF2F",
  "#25FFA8",
  "#5CFFE8",
  "#8BC5FF",
  "#5480E4",
  "#92A7FF",
  "#D86CE4",
  "#E553A0",
  "#FFFFFF",
  // row 2 — saturated
  "#FF3636",
  "#F66C03",
  "#99724B",
  "#FFF034",
  "#87FF67",
  "#3DC300",
  "#00BFAF",
  "#19E9FF",
  "#10A4EE",
  "#007DC0",
  "#886CE4",
  "#B677C6",
  "#FF39D4",
  "#D0D0D0",
  // row 3 — pastels
  "#E2675A",
  "#FFA374",
  "#D3AD71",
  "#EDFFAE",
  "#D2E498",
  "#BAD074",
  "#9BC48D",
  "#D4FDE1",
  "#CDF1F8",
  "#B9C1E3",
  "#CDBBE4",
  "#AE98E5",
  "#E5DCE1",
  "#A9A9A9",
  // row 4 — desaturated
  "#C6928B",
  "#B78256",
  "#99836A",
  "#BFBA69",
  "#A6BE00",
  "#7DB04D",
  "#88C2BA",
  "#9BB3C4",
  "#85A5C2",
  "#8393CC",
  "#A595B5",
  "#BF9FBE",
  "#BC7196",
  "#7B7B7B",
  // row 5 — darks
  "#AF3333",
  "#A95131",
  "#724F41",
  "#DBC300",
  "#85961F",
  "#539F31",
  "#0A9C8E",
  "#236384",
  "#1A2F96",
  "#2F52A2",
  "#624BAD",
  "#A34BAD",
  "#CC2E6E",
  "#3C3C3C",
]

declare const paletteIndexBrand: unique symbol

/**
 * A palette index — `0..69`, which is what a v10 **clip** stores.
 *
 * Branded on purpose, and this is the one place in the library where a brand
 * earns its keep. v10 writes the same colour two ways: a **track or scene**
 * uses the shifted ranges (140..199 and 278..287), a **clip** uses the raw
 * index. Both are plain numbers, so nothing but a type can stop one being
 * written where the other belongs — and the consequence is not a wrong colour.
 * It is an out-of-range value in a field Live KNOWS, which passes every
 * validation and then takes Live 10 down at load, with no message.
 *
 * The only way to obtain one is `paletteIndexFromFileColor` — which is exactly
 * the conversion that prevents the crash. That is the point of the brand: the
 * compiler now demands the call a person can forget.
 */
export type PaletteIndex = number & {
  readonly [paletteIndexBrand]: "PaletteIndex"
}

/**
 * The hex of a scene/track color from the index as it sits IN THE v10 FILE.
 * `null` = no color (v10 writes 0) or an index outside the known ranges.
 */
export function liveColorHex(
  fileColorIndex: number | null | undefined
): string | null {
  if (fileColorIndex == null) return null
  if (fileColorIndex >= 140 && fileColorIndex <= 199) {
    return LIVE_PALETTE[fileColorIndex - 140]!
  }
  if (fileColorIndex >= 278 && fileColorIndex <= 287) {
    return LIVE_PALETTE[fileColorIndex - 218]!
  }
  return null
}

/**
 * The PALETTE index (0..69) from a v10 file `ColorIndex`.
 *
 * v10 writes the SAME color two ways, depending on the element (measured in
 * the archive): TRACK and SCENE use the shifted ranges (one track sits at
 * 145, another at 287) and CLIP writes the raw palette index — the clips of
 * that same 145 track are 5, those of a 148 track are 8.
 *
 * Without this conversion, writing a catalog color into a clip would put 145
 * where Live expects 0..69: an out-of-range value in a KNOWN field, which
 * passes every validation and is exactly the class of error that takes
 * Live 10 down with no message.
 */
export function paletteIndexFromFileColor(
  colorIndex: number | null | undefined
): PaletteIndex | null {
  if (colorIndex == null) return null
  if (colorIndex >= 0 && colorIndex < LIVE_PALETTE.length) {
    return colorIndex as PaletteIndex
  }
  if (colorIndex >= 140 && colorIndex <= 199) {
    return (colorIndex - 140) as PaletteIndex
  }
  if (colorIndex >= 278 && colorIndex <= 287) {
    return (colorIndex - 218) as PaletteIndex
  }
  return null
}

/** The hex of a v10 CLIP color (raw palette index). */
export function clipColorHex(
  clipColorIndex: number | null | undefined
): string | null {
  const index = paletteIndexFromFileColor(clipColorIndex)
  return index === null ? null : LIVE_PALETTE[index]!
}

/**
 * Is the color achromatic — the LAST column of each palette row (`#FFFFFF`,
 * `#D0D0D0`, `#A9A9A9`, `#7B7B7B`, `#3C3C3C`)?
 *
 * Derived from the hex, not from `index % 14`: it stays self-documenting and
 * survives a palette adjustment. A missing or unknown color counts as
 * neutral — when in doubt, a generator does not repaint.
 */
export function isNeutralLiveColor(
  colorIndex: number | null | undefined
): boolean {
  const hex = clipColorHex(colorIndex)
  if (hex === null) return true
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  const chroma = Math.max(red, green, blue) - Math.min(red, green, blue)
  return chroma <= 8
}
