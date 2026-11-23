import { describe, expect, it } from "vitest"
import { relinkFileRefs } from "../../src/core/file-ref.js"

// A set assembled from song files inherits their FileRefs, and those point at
// the machine of whoever split the tracks. Re-rooting them is what makes the
// set open with the audio on any other copy of the same library.

const ROOT = "/Volumes/X10 Pro/SPLIT TRACKS 2.0 Project"

/** A v10 FileRef as Live 10 writes it: relative chain, hint, and alias data. */
function v10Ref(input: {
  readonly relative?: readonly string[]
  readonly hint?: readonly string[]
  readonly name: string
}): string {
  const list = (tag: string, dirs: readonly string[] | undefined) =>
    dirs === undefined
      ? `<${tag} />`
      : `<${tag}>${dirs
          .map((dir, index) => `<RelativePathElement Id="${index}" Dir="${dir}" />`)
          .join("")}</${tag}>`
  return [
    `<SampleRef><FileRef>`,
    `<HasRelativePath Value="true" />`,
    `<RelativePathType Value="3" />`,
    list("RelativePath", input.relative),
    `<Name Value="${input.name}" />`,
    `<Type Value="2" />`,
    `<Data>DEADBEEF</Data>`,
    `<RefersToFolder Value="false" />`,
    `<SearchHint>`,
    list("PathHint", input.hint),
    `<FileSize Value="4102590" />`,
    `<Crc Value="51450" />`,
    `<MaxCrcSize Value="16384" />`,
    `<HasExtendedInfo Value="true" />`,
    `</SearchHint>`,
    `<LivePackName Value="" />`,
    `<LivePackId Value="" />`,
    `</FileRef></SampleRef>`,
  ].join("")
}

describe("relinkFileRefs", () => {
  it("re-roots the relative chain at the local library", () => {
    const xml = v10Ref({
      relative: ["AUDIO TRACKS", "CURRENT SONGS", "Alive"],
      hint: ["Users", "someone", "SPLIT TRACKS 2.0 Project", "AUDIO TRACKS"],
      name: "Alive_PERC.wav",
    })
    const report = relinkFileRefs(xml, ROOT)

    expect(report.relinked).toBe(1)
    expect(report.unresolved).toEqual([])
    // The whole local path, folder by folder, is what resolves the file.
    for (const dir of ["Volumes", "X10 Pro", "SPLIT TRACKS 2.0 Project", "Alive"]) {
      expect(report.xml).toContain(`Dir="${dir}"`)
    }
    expect(report.xml).toContain('<Name Value="Alive_PERC.wav" />')
    // No relative path: measured as the shape Live 10 itself writes.
    expect(report.xml).toContain('<HasRelativePath Value="false" />')
    expect(report.xml).toContain('<RelativePathType Value="0" />')
    // The stale alias of the other machine must not survive.
    expect(report.xml).not.toContain("DEADBEEF")
  })

  it("falls back to the hint, cutting at the library's own folder", () => {
    // No relative chain: what is left is the absolute path of the machine that
    // wrote the file. Everything after the library folder is still valid here.
    const xml = v10Ref({
      hint: [
        "Users",
        "someone",
        "OneDrive",
        "SPLIT TRACKS 2.0 Project",
        "AUDIO TRACKS",
        "ITEMS",
      ],
      name: "Behold_PERC.wav",
    })
    const report = relinkFileRefs(xml, ROOT)

    expect(report.relinked).toBe(1)
    expect(report.xml).toContain('Dir="ITEMS"')
    expect(report.xml).not.toContain('Dir="OneDrive"')
    expect(report.xml).not.toContain('Dir="someone"')
  })

  it("an up-level in the chain is not a library path, so the hint decides", () => {
    // An empty `Dir` means "go up one" — that chain is measured from the .als,
    // and where the .als will sit is not something this function knows.
    const xml = v10Ref({
      relative: ["", "", "AUDIO TRACKS"],
      hint: ["SPLIT TRACKS 2.0 Project", "AUDIO TRACKS", "CHRISTMAS"],
      name: "Noel_LEAD.wav",
    })
    const report = relinkFileRefs(xml, ROOT)
    expect(report.xml).toContain('Dir="CHRISTMAS"')
  })

  it("says which files it could not place instead of inventing a path", () => {
    const xml = v10Ref({ hint: ["Users", "someone"], name: "lost.wav" })
    const report = relinkFileRefs(xml, ROOT)

    expect(report.relinked).toBe(0)
    expect(report.unresolved).toEqual(["lost.wav"])
    // Untouched, not half-written.
    expect(report.xml).toBe(xml)
  })

  it("leaves the v12 shape alone — that one is convertFileRefs's job", () => {
    const xml = `<SampleRef><FileRef><RelativePathType Value="1" /><RelativePath Value="../x.wav" /><Path Value="/elsewhere/x.wav" /><Type Value="2" /></FileRef></SampleRef>`
    const report = relinkFileRefs(xml, ROOT)
    expect(report.relinked).toBe(0)
    expect(report.xml).toBe(xml)
  })

  it("keeps the FileRef's own Id: a list member without one is refused", () => {
    const xml = v10Ref({
      relative: ["AUDIO TRACKS"],
      name: "x.wav",
    }).replace("<FileRef>", '<FileRef Id="4">')
    const report = relinkFileRefs(xml, ROOT)
    expect(report.xml).toContain('<FileRef Id="4">')
  })

  it("passes the volume attributes through to the alias record", () => {
    const xml = v10Ref({ relative: ["AUDIO", "Song"], name: "stem.wav" })
    const dataOf = (attributes?: number): string =>
      /<Data>([\s\S]*?)<\/Data>/
        .exec(
          relinkFileRefs(xml, ROOT, {
            fileCreatedAt: () => 3_061_152_000,
            volumeAttributes: attributes,
          }).xml
        )![1]!
        .replace(/\s+/g, "")
    expect(dataOf().slice(268, 276)).toBe("00000A00")
    expect(dataOf(0x0d02).slice(268, 276)).toBe("00000D02")
  })

  it("writes the alias record when the caller can date the file", () => {
    const xml = v10Ref({ relative: ["AUDIO TRACKS"], name: "x.wav" })
    const report = relinkFileRefs(xml, ROOT, {
      fileCreatedAt: () => 3_800_000_000,
    })
    expect(report.xml).toMatch(/<Data>\n\t[0-9A-F]/)
  })

  it("is a no-op on a set already rooted here, byte for byte", () => {
    const xml = v10Ref({ relative: ["AUDIO TRACKS"], name: "x.wav" })
    const once = relinkFileRefs(xml, ROOT).xml
    expect(relinkFileRefs(once, ROOT).xml).toBe(once)
  })
})

describe("relinkFileRefs with a locate callback", () => {
  const ref = () =>
    v10Ref({
      relative: ["AUDIO TRACKS", "CURRENT SONGS", "NOVO SOM"],
      name: "NOVO SOM_ DRUMS.wav",
    })

  it("writes where the file really is when the document is stale", () => {
    // The real case: the audio moved into the campus folder after the .als was
    // saved, so the path the document states points nowhere.
    const real = `${ROOT}/AUDIO TRACKS/CAMPUSES/BRAZIL/Novo Som_D_128/NOVO SOM_ DRUMS.wav`
    const report = relinkFileRefs(ref(), ROOT, { locate: () => real })

    expect(report.relinked).toBe(1)
    expect(report.located).toBe(1)
    expect(report.xml).toContain('Dir="BRAZIL"')
    expect(report.xml).not.toContain('Dir="CURRENT SONGS"')
  })

  it("gets the rebuilt path and the file name, so the caller can look it up", () => {
    const seen: { candidate: string; fileName: string }[] = []
    relinkFileRefs(ref(), ROOT, {
      locate: (input) => {
        seen.push({ ...input })
        return null
      },
    })
    expect(seen).toEqual([
      {
        candidate: `${ROOT}/AUDIO TRACKS/CURRENT SONGS/NOVO SOM/NOVO SOM_ DRUMS.wav`,
        fileName: "NOVO SOM_ DRUMS.wav",
      },
    ])
  })

  it("null keeps the rebuilt path and counts nothing as located", () => {
    const report = relinkFileRefs(ref(), ROOT, { locate: () => null })
    expect(report.relinked).toBe(1)
    expect(report.located).toBe(0)
    expect(report.xml).toContain('Dir="NOVO SOM"')
  })

  it("returning the same path is not counted as a relocation", () => {
    const report = relinkFileRefs(ref(), ROOT, {
      locate: ({ candidate }) => candidate,
    })
    expect(report.located).toBe(0)
  })
})
