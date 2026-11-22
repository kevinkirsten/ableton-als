# ableton-als

[![npm](https://img.shields.io/npm/v/ableton-als?color=cb3837&logo=npm)](https://www.npmjs.com/package/ableton-als)
[![CI](https://github.com/kevinkirsten/ableton-als/actions/workflows/ci.yml/badge.svg)](https://github.com/kevinkirsten/ableton-als/actions/workflows/ci.yml)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](./package.json)
[![types](https://img.shields.io/npm/types/ableton-als)](./package.json)
[![license](https://img.shields.io/npm/l/ableton-als?color=blue)](./LICENSE)

**Read, edit, validate and version-convert Ableton Live Set (`.als`) files — in Node or directly in the browser, with zero dependencies.**

Its headline feature: **convert a Live 12 set into a file Live 10 can open.** Ableton offers no downgrade path — a set saved in a newer Live simply refuses to open in an older one. This library builds the file the older Live expects.

**[Try it in your browser](https://kevinkirsten.github.io/ableton-als/)**: drop a set to inspect it, validate it, repair it and convert it from Live 12 to Live 10. Nothing to install, and the file never leaves your machine.

> ## Status: 0.x, in production use
>
> **The API can still change between minor versions until `1.0`.** This code was
> extracted from a private application, where it runs in production against a
> real archive.
>
> | | |
> |---|---|
> | Working today | `.als` parsing, surgical editing, validation, the Live 12 → 10 porter, alias record generation, sample relinking, repair tools, Node and web adapters, and a [browser demo](https://kevinkirsten.github.io/ableton-als/) |
> | Next | `docs/FORMAT.md` |
>
> What is here is verified rather than asserted: 194 unit tests on the library,
> and the conversion is checked against sets Ableton itself wrote. Most recently
> 5,016 alias records were reproduced byte for byte, and a converted 561-scene
> set opened in real Live 10 with zero missing files.

## This is not a "control Live" library

If you want to talk to a **running** copy of Ableton Live — launch clips, change tempo, read device parameters — you want [`ableton-js`][ableton-js] or [AbletonOSC][abletonosc], which drive Live through Max for Live and OSC.

`ableton-als` never talks to Live. It reads and writes the **`.als` file on disk**, with Live closed. Different problem, different tool.

[ableton-js]: https://github.com/leolabs/ableton-js
[abletonosc]: https://github.com/ideoforms/AbletonOSC

## Quickstart

```bash
npm install ableton-als
```

Convert a Live 12 set to Live 10 in Node:

```ts
import { readFile, writeFile } from "node:fs/promises"
import { convertAlsToV10 } from "ableton-als/node"

const result = convertAlsToV10({
  fileName: "Song.als",
  bytes: await readFile("Song.als"),
  libraryRoot: "/Volumes/Demo SSD/Library",
})
if (!result.ok) throw new Error(result.error)

const { fileName, bytes } = result.data
const { warnings, problems } = result.data
for (const warning of warnings) {
  console.warn(warning.code, warning.values)
}

// Never keep a set Live 10 would crash on.
if (problems.length > 0) {
  throw new Error(problems[0]!.detail)
}

// "Song [v10].als", never over the original.
await writeFile(fileName, bytes)
```

The same conversion in a browser, where the file never leaves the page:

```ts
import {
  decodeAls,
  downgradeToV10,
  encodeAls,
  fileCreatedAt,
  validateGeneratedSet,
} from "ableton-als/web"

export async function convert(
  file: File
): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const xml = await decodeAls(bytes)

  const result = downgradeToV10(xml, {
    libraryRoot: "/Volumes/Demo SSD/Library",
    // Builds the alias records Live 10 finds audio by.
    fileCreatedAt,
  })
  if (!result.ok) throw new Error(result.error)

  for (const warning of result.warnings) {
    console.warn(warning.code, warning.values)
  }

  // Never hand over a set Live 10 would crash on.
  const problems = validateGeneratedSet(result.xml)
  if (problems.length > 0) {
    throw new Error(problems[0]!.detail)
  }

  // Save as "Song [v10].als" and keep the original.
  return encodeAls(result.xml)
}
```

Both snippets are compiled in CI against the library source, together with the
rest of the [examples the demo shows](./site/src/snippets).

## Why it runs in the browser

The core has **zero dependencies** and never imports a Node builtin. Everything that touches the world — gzip, the filesystem — lives in adapters. So the same conversion logic runs in Node, Deno, Bun, Workers and the browser.

That is not a technical curiosity. Every other tool that downgrades a Live set is either a Python CLI or a web service you have to **upload your project to**. This one can do it in a tab, with the file never leaving your machine.

And it is genuinely lossless there: the only filesystem fact the conversion appears to need is a file creation date, and Live turns out to ignore it — measured by writing a file with a deliberately wrong constant date and watching it open with every clip loaded.

### The demo

[kevinkirsten.github.io/ableton-als](https://kevinkirsten.github.io/ableton-als/) is that claim made checkable. It is a static page whose Content Security Policy carries `connect-src 'none'`, so the browser itself refuses any upload, and it does all its work in a Web Worker: inspect a set, validate it, convert it and run the repair tools, each one next to the code that does the same thing.

Its source is in [`site/`](./site). It is written without a framework, on purpose, so it doubles as the reference example.

```bash
pnpm demo:dev      # http://localhost:3140
pnpm demo:build    # static files in site/dist
```

## What makes writing `.als` hard

Reading a Live set is easy: gunzip, parse XML. Writing one that Live actually opens is a different problem, and the reason is not documented anywhere public.

A few things this library had to learn the hard way, each measured against real Live 10 and Live 12:

- **`<FileRef><Data>` is a macOS alias record, and it is how Live 10 finds your audio.** Not the absolute path, not the relative path, not the file name. Live 12 stops writing it, so a downgrade has to synthesize one — otherwise the set opens with every clip greyed out.
- **Live 10 rejects a file for a single unknown attribute**, and does not ignore unknown elements. But a *wrong value in a field it knows* passes every structural check and then crashes it at load with no message at all.
- **Clip colours and track colours use different encodings** of the same 70-colour palette. Writing a track-shaped index into a clip is an out-of-range value in a valid field — the dangerous kind.
- **Attribute values read by a regex are already XML-escaped**, and Ableton switches to single-quoted attributes when a value contains a double quote.

A full write-up lands in `docs/FORMAT.md`. It is intended to be the reference that does not currently exist.

## Known limits

Measured gaps, stated plainly, because a library about byte-fidelity should not be vague about where it stops.

- **A long folder name is not reproduced exactly.** Live shortens any name over 31 characters to 30. For a *file* the marker is the constant `#FFFFFFFF`, which this library reproduces. For a *directory* the marker embeds a filesystem CNID (`…(Shorter#1CE2`) that cannot be computed — it is volume-specific, changes when folders move, and is not available in a browser at all. This library writes the full folder name instead. Sets built that way open in Live 10 with every clip loaded, and the field is in the group Live demonstrably ignores, but it is a real difference from what Live writes.
- **`fileType` and `creator` come from the file's `com.apple.FinderInfo` xattr**, and are zero when the file has none. Reading an xattr is I/O, so they are optional inputs; the default is the disabled value that almost every audio file carries. A caller that wants exactness supplies them.
- **Alias records are only generated for paths under `/Volumes/`.** The boot-volume variant was never measured, and guessing would produce a file that opens and finds nothing — the exact defect this code exists to prevent. It declines instead.
- **`volumeAttributes` and the filesystem id default to values sampled from one external SSD.** No second volume has been measured.
- **Scene colours are inferred, not measured.** Track and clip colours are measured across the full 70-colour palette.

### Everything here was measured on macOS

Against Live 10.1.43 and Live 12.4.3, on macOS, using sets those versions wrote. That matters differently for different parts of the library:

| | |
|---|---|
| Parsing, editing, validation, colours, scene and clip semantics | **OS-independent by construction** — it is string work on the XML inside the file, and a `.als` is the same document whoever saved it. No reason to expect a difference, but no Windows-authored set has been checked against it either. |
| **Alias record generation** | **macOS-specific by definition.** The `<Data>` blob is a macOS Alias Manager record built around `/Volumes/<volume>/…`; the generator refuses any other path shape. Whether Live on Windows needs this element at all, and what it puts there if so, has never been measured. |

So: the library runs anywhere Node or a browser runs, and the conversion is only *proven* for macOS-authored sets. If you use Live on Windows, a bug report with the `.als` file is genuinely useful — that is the measurement nobody here can make.

## Design rules

- **Zero dependencies in the core.** Enforced by CI, not by good intentions.
- **Never reserialize.** Edits are surgical: anything the library does not deliberately touch comes out byte-identical.
- **Never write in place.** Functions return new bytes; the caller decides what to overwrite. People point this at irreplaceable work.
- **Prove fidelity, don't claim it.** Conversion output is compared against files Ableton itself wrote.

## Contributing

Issues are wanted — especially bug reports that include the `.als` file that broke. Code contributions are limited at this stage for one concrete reason: this project's characteristic bug is a plausible value in a valid field, which validates cleanly, opens, and then crashes Live during load. No test catches that. Verifying a change means opening files in two installed Live versions against a private archive, and right now only the maintainer can do that.

`CONTRIBUTING.md` will spell this out properly before the repository is announced.

## License

MIT. See [LICENSE](./LICENSE).

`Ableton®` and `Live™` are trademarks of Ableton AG. This project is unofficial, unaffiliated with and unendorsed by Ableton AG, and uses none of their logos or brand styling.
