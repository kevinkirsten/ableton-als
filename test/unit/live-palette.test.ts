import { describe, expect, it } from "vitest"
import {
  clipColorHex,
  isNeutralLiveColor,
  liveColorHex,
  paletteIndexFromFileColor,
} from "../../src/core/live-palette.js"

/** The five achromatics: the LAST column of each row of the 5×14 palette. */
const NEUTRAL_PALETTE_INDEXES = [13, 27, 41, 55, 69]

describe("paletteIndexFromFileColor", () => {
  it("translates the shifted ranges TRACK and SCENE use", () => {
    expect(paletteIndexFromFileColor(140)).toBe(0)
    expect(paletteIndexFromFileColor(145)).toBe(5)
    expect(paletteIndexFromFileColor(199)).toBe(59)
    expect(paletteIndexFromFileColor(278)).toBe(60)
    expect(paletteIndexFromFileColor(287)).toBe(69)
  })

  it("the CLIP's raw index passes straight through", () => {
    // Measured in the archive: one track is 145 and its clips are 5.
    expect(paletteIndexFromFileColor(5)).toBe(5)
    expect(paletteIndexFromFileColor(69)).toBe(69)
  })

  it("outside the known ranges is null, and so is absence", () => {
    expect(paletteIndexFromFileColor(200)).toBeNull()
    expect(paletteIndexFromFileColor(300)).toBeNull()
    expect(paletteIndexFromFileColor(null)).toBeNull()
    expect(paletteIndexFromFileColor(undefined)).toBeNull()
  })
})

describe("isNeutralLiveColor", () => {
  it("exactly the palette's five greys are neutral", () => {
    for (let index = 0; index < 70; index += 1) {
      expect([index, isNeutralLiveColor(index)]).toEqual([
        index,
        NEUTRAL_PALETTE_INDEXES.includes(index),
      ])
    }
  })

  it("holds the same when the color comes in the track's file range", () => {
    for (const index of NEUTRAL_PALETTE_INDEXES) {
      const asTrackColor = index < 60 ? index + 140 : index + 218
      expect(isNeutralLiveColor(asTrackColor)).toBe(true)
    }
    expect(isNeutralLiveColor(145)).toBe(false)
    expect(isNeutralLiveColor(148)).toBe(false)
  })

  it("no color or an unknown index counts as neutral — when in doubt do not repaint", () => {
    expect(isNeutralLiveColor(null)).toBe(true)
    expect(isNeutralLiveColor(undefined)).toBe(true)
    expect(isNeutralLiveColor(9999)).toBe(true)
  })
})

describe("liveColorHex (track/scene) kept its contract", () => {
  it("0 is still 'no color'", () => {
    expect(liveColorHex(0)).toBeNull()
    expect(liveColorHex(69)).toBeNull()
    expect(liveColorHex(145)).toBe("#1AFF2F")
  })

  it("the clip reads the same hex from the raw index", () => {
    expect(clipColorHex(5)).toBe("#1AFF2F")
    expect(clipColorHex(13)).toBe("#FFFFFF")
  })
})
