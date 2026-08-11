import { describe, expect, it } from "vitest"
import {
  buildAliasRecord,
  hfsShortName,
  MAC_EPOCH_OFFSET,
  macCreationTime,
  SYNTHETIC_CREATION_TIME,
} from "../../src/core/alias.js"

// ANCHORS: every hex literal below came out of an `.als` written by Live 10
// itself — sets that open with every clip loaded. They are not synthetic; they
// are what Ableton produces. If these start failing, either the generator
// regressed or the format changed, and in both cases Live is the authority.
//
// The sets were recorded on purpose for this test, with file and folder names
// chosen to carry nothing but the shape being measured. Between them they cover
// 956 records across four sets, all reproduced byte for byte.
const ANCHORS = [
  {
    why: "a name of 32 characters, mangled with a four-character extension",
    absolutePath:
      "/Volumes/X10 Pro/Tracks/ableton-als-demo/Name Rule Test/NAMETEST 32 AAAAAAAAAAAAAAAA.wav",
    createdAt: 3869264620,
    fileType: 0xffffffff,
    creator: 0xffffffff,
    hex:
    "0000000001C400020000075831302050726F0000000000000000000000000000" +
    "0000000000000000000042440001FFFFFFFF1E4E414D45544553542033322041" +
    "414141412346464646464646462E776176000000000000000000000000000000" +
    "000000000000000000000000000000000000FFFFFFFFE6A04AECFFFFFFFFFFFF" +
    "FFFFFFFFFFFF00000A007846000000000000000000000000000E4E616D652052" +
    "756C652054657374000200592F3A566F6C756D65733A5831302050726F3A5472" +
    "61636B733A61626C65746F6E2D616C732D64656D6F3A4E616D652052756C6520" +
    "546573743A4E414D455445535420333220414141414141414141414141414141" +
    "412E77617600000E00420020004E0041004D0045005400450053005400200033" +
    "0032002000410041004100410041004100410041004100410041004100410041" +
    "00410041002E007700610076000F00100007005800310030002000500072006F" +
    "001200482F547261636B732F61626C65746F6E2D616C732D64656D6F2F4E616D" +
    "652052756C6520546573742F4E414D4554455354203332204141414141414141" +
    "41414141414141412E776176001300102F566F6C756D65732F5831302050726F" +
    "FFFF0000",
  },
  {
    why: "a five-character extension, which keeps one character less",
    absolutePath:
      "/Volumes/X10 Pro/Tracks/ableton-als-demo/Name Rule Test/NAMETEST AIFF AAAAAAAAAAAAAAAAAAAAAAAAA.aiff",
    createdAt: 3869264620,
    fileType: 0xffffffff,
    creator: 0xffffffff,
    hex:
    "0000000001F400020000075831302050726F0000000000000000000000000000" +
    "0000000000000000000042440001FFFFFFFF1E4E414D45544553542041494646" +
    "2041412346464646464646462E61696666000000000000000000000000000000" +
    "000000000000000000000000000000000000FFFFFFFFE6A04AECFFFFFFFFFFFF" +
    "FFFFFFFFFFFF00000A007846000000000000000000000000000E4E616D652052" +
    "756C652054657374000200652F3A566F6C756D65733A5831302050726F3A5472" +
    "61636B733A61626C65746F6E2D616C732D64656D6F3A4E616D652052756C6520" +
    "546573743A4E414D455445535420414946462041414141414141414141414141" +
    "4141414141414141414141412E6169666600000E005A002C004E0041004D0045" +
    "0054004500530054002000410049004600460020004100410041004100410041" +
    "0041004100410041004100410041004100410041004100410041004100410041" +
    "004100410041002E0061006900660066000F0010000700580031003000200050" +
    "0072006F001200542F547261636B732F61626C65746F6E2D616C732D64656D6F" +
    "2F4E616D652052756C6520546573742F4E414D45544553542041494646204141" +
    "41414141414141414141414141414141414141414141412E6169666600130010" +
    "2F566F6C756D65732F5831302050726FFFFF0000",
  },
  {
    why: "a short name, and a file carrying no FinderInfo at all",
    absolutePath:
      "/Volumes/X10 Pro/Tracks/ableton-als-demo/Other/Default Click 137BPM.wav",
    createdAt: 3854281214,
    fileType: 0x00000000,
    creator: 0x00000000,
    hex:
    "00000000018A00020000075831302050726F0000000000000000000000000000" +
    "0000000000000000000042440001FFFFFFFF1844656661756C7420436C69636B" +
    "2031333742504D2E776176000000000000000000000000000000000000000000" +
    "000000000000000000000000000000000000FFFFFFFFE5BBA9FE000000000000" +
    "0000FFFFFFFF00000A00784600000000000000000000000000054F7468657200" +
    "000200482F3A566F6C756D65733A5831302050726F3A547261636B733A61626C" +
    "65746F6E2D616C732D64656D6F3A4F746865723A44656661756C7420436C6963" +
    "6B2031333742504D2E776176000E0032001800440065006600610075006C0074" +
    "00200043006C00690063006B002000310033003700420050004D002E00770061" +
    "0076000F00100007005800310030002000500072006F001200372F547261636B" +
    "732F61626C65746F6E2D616C732D64656D6F2F4F746865722F44656661756C74" +
    "20436C69636B2031333742504D2E77617600001300102F566F6C756D65732F58" +
    "31302050726FFFFF0000",
  },] as const

describe("buildAliasRecord", () => {
  it.each(ANCHORS)("reproduces what Live 10 wrote for $why", (anchor) => {
    const result = buildAliasRecord({
      absolutePath: anchor.absolutePath,
      createdAt: anchor.createdAt,
      fileType: anchor.fileType,
      creator: anchor.creator,
    })
    if (!result.ok) throw new Error(result.reason)
    expect(result.hex).toBe(anchor.hex)
  })

  it("declares its own length in the header", () => {
    const anchor = ANCHORS[0]
    const result = buildAliasRecord({
      absolutePath: anchor.absolutePath,
      createdAt: anchor.createdAt,
      fileType: anchor.fileType,
      creator: anchor.creator,
    })
    if (!result.ok) throw new Error(result.reason)
    const declared = parseInt(result.hex.slice(8, 12), 16)
    expect(declared).toBe(result.hex.length / 2)
  })

  it("declines paths outside /Volumes rather than guessing", () => {
    // The boot-volume variant was never measured. A wrong alias yields a file
    // that opens and finds nothing — the defect this module exists to fix.
    expect(
      buildAliasRecord({ absolutePath: "/Users/someone/x.wav", createdAt: 1 })
    ).toEqual({ ok: false, reason: "not_on_external_volume" })
    expect(
      buildAliasRecord({ absolutePath: "/Volumes/Disk", createdAt: 1 })
    ).toEqual({ ok: false, reason: "not_on_external_volume" })
  })

  it("carries the file name in both mac-roman and UTF-16", () => {
    const result = buildAliasRecord({
      absolutePath: "/Volumes/Disk/folder/sound.wav",
      createdAt: 0,
    })
    if (!result.ok) throw new Error(result.reason)
    expect(result.hex).toContain("736F756E642E776176") // "sound.wav"
    expect(result.hex).toContain("0073006F0075006E0064002E00770061007600")
  })

  it("keeps the full name in the UTF-16 tag even when the short one is mangled", () => {
    // Only the mac-roman Pascal field is shortened; the UTF-16 tag and the
    // colon-separated path both carry the name in full.
    const long = "A".repeat(40) + ".wav"
    const result = buildAliasRecord({
      absolutePath: `/Volumes/Disk/folder/${long}`,
      createdAt: 0,
    })
    if (!result.ok) throw new Error(result.reason)
    expect(result.hex).toContain(
      [...long].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("").toUpperCase()
    )
    expect(result.hex).toContain("2346464646464646462E776176") // "#FFFFFFFF.wav"
  })

  it("defaults fileType and creator to the disabled value", () => {
    const explicit = buildAliasRecord({
      absolutePath: "/Volumes/Disk/folder/sound.wav",
      createdAt: 0,
      fileType: 0xffffffff,
      creator: 0xffffffff,
    })
    const implied = buildAliasRecord({
      absolutePath: "/Volumes/Disk/folder/sound.wav",
      createdAt: 0,
    })
    if (!explicit.ok || !implied.ok) throw new Error("expected both to build")
    expect(implied.hex).toBe(explicit.hex)
  })

  it("the synthetic date produces a record of the same shape", () => {
    // Live ignores the creation date, which is what lets a browser — with no
    // filesystem at all — generate a working record.
    const path = "/Volumes/Disk/folder/sound.wav"
    const real = buildAliasRecord({ absolutePath: path, createdAt: 1_000_000 })
    const synthetic = buildAliasRecord({
      absolutePath: path,
      createdAt: SYNTHETIC_CREATION_TIME,
    })
    if (!real.ok || !synthetic.ok) throw new Error("expected both to build")
    expect(synthetic.hex).toHaveLength(real.hex.length)
    const dateStart = 118 * 2
    expect(synthetic.hex.slice(0, dateStart)).toBe(real.hex.slice(0, dateStart))
    expect(synthetic.hex.slice(dateStart + 8)).toBe(real.hex.slice(dateStart + 8))
  })
})

describe("hfsShortName", () => {
  it("leaves a name of 31 characters or fewer alone", () => {
    // Measured boundary: 31 goes in whole, 32 is mangled.
    expect(hfsShortName("A".repeat(27) + ".wav")).toBe("A".repeat(27) + ".wav")
  })

  it("mangles from 32 characters on, always landing on 30", () => {
    const mangled = hfsShortName("A".repeat(28) + ".wav")
    expect(mangled).toBe("A".repeat(17) + "#FFFFFFFF.wav")
    expect(mangled).toHaveLength(30)
  })

  it("keeps one character less when the extension is one longer", () => {
    // This is what pins the rule to a fixed TOTAL rather than a fixed prefix.
    const mangled = hfsShortName("A".repeat(40) + ".aiff")
    expect(mangled).toBe("A".repeat(16) + "#FFFFFFFF.aiff")
    expect(mangled).toHaveLength(30)
  })

  it("is not confused by a hash sign inside the name itself", () => {
    // Measured on a real archive: "Consecrate (C#)_STRINGS ENSMB.wav".
    expect(hfsShortName("Consecrate (C#)_STRINGS ENSMB.wav")).toBe(
      "Consecrate (C#)_S#FFFFFFFF.wav"
    )
  })

  it("treats a name with no extension as all base", () => {
    expect(hfsShortName("B".repeat(40))).toBe("B".repeat(21) + "#FFFFFFFF")
  })

  it("does not let a leading dot count as an extension", () => {
    expect(hfsShortName("." + "C".repeat(40))).toBe(
      "." + "C".repeat(20) + "#FFFFFFFF"
    )
  })
})

describe("macCreationTime", () => {
  it("converts a Unix epoch to the Mac epoch in local time", () => {
    // Measured: real blobs sat exactly 10,800 s (3 h) behind `birthtime` in UTC.
    expect(macCreationTime(0, 0)).toBe(MAC_EPOCH_OFFSET)
    expect(macCreationTime(0, -10800)).toBe(MAC_EPOCH_OFFSET - 10800)
  })

  it("drops the fractional part of birthtime", () => {
    expect(macCreationTime(10.75, 0)).toBe(MAC_EPOCH_OFFSET + 10)
  })
})
