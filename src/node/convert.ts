// ---------------------------------------------------------------------------
// Converts a Live 12 `.als` to the Live 10 schema from uploaded bytes,
// without touching the disk: gunzip → downgrade → validation → gzip.
//
// The result is NOT written anywhere — the file goes back to the caller and
// the archive stays untouched.
// ---------------------------------------------------------------------------

import { gunzipSync, gzipSync } from "node:zlib"
import {
  downgradeToV10,
  majorVersionOf,
  type DowngradeWarning,
} from "../core/downgrade.js"
import { parseAlsDocument } from "../core/document.js"
import {
  validateGeneratedSet,
  type ValidationProblem,
} from "../core/validate.js"
import {
  MAX_UPLOAD_BYTES,
  fileCreatedAt as fileCreatedAtFromDisk,
  readXml,
  safeFileName,
} from "./shared.js"

export type ConversionReport = {
  readonly fileName: string
  /** The v10 `.als`, already gzipped, ready to write. */
  readonly bytes: Uint8Array
  readonly sourceVersion: number | null
  /** Already v10: nothing was converted, the file goes back as it came. */
  readonly alreadyV10: boolean
  readonly scenes: number
  readonly tracks: number
  readonly scenesConverted: number
  readonly warnings: readonly DowngradeWarning[]
  /**
   * Validation failures. A non-empty list means a file Live 10 refuses — or
   * worse, accepts and takes down mid-load.
   */
  readonly problems: readonly ValidationProblem[]
}

export type ConversionResult =
  | { readonly ok: true; readonly data: ConversionReport }
  | { readonly ok: false; readonly error: string }

export function convertAlsToV10(input: {
  readonly fileName: string
  readonly bytes: Uint8Array
  /**
   * The library root. v12 writes the wav's ABSOLUTE path and v10 wants the
   * folder list relative to the project root — this is where it comes from.
   * REQUIRED: the adapter never reads `process.env`; the host decides.
   */
  readonly libraryRoot: string
  /**
   * Creation-date source for the `<Data>` alias records — what Live 10 uses
   * to find the audio. Defaults to reading the disk, which only works when
   * the wavs are mounted on THIS machine: on a server they are not, the blob
   * comes out empty and the user opens the set with grey clips until they
   * tell Live to locate the files once. Better than guessing an alias that
   * points nowhere.
   */
  readonly fileCreatedAt?: (absolutePath: string) => number | null
}): ConversionResult {
  if (input.bytes.length === 0) return { ok: false, error: "empty_file" }
  if (input.bytes.length > MAX_UPLOAD_BYTES)
    return { ok: false, error: "too_large" }

  const xml = readXml(input.bytes)
  if (xml === null) return { ok: false, error: "not_an_als" }

  const sourceVersion = majorVersionOf(xml)
  if (sourceVersion === null) return { ok: false, error: "not_an_als" }

  const result = downgradeToV10(xml, {
    libraryRoot: input.libraryRoot,
    fileCreatedAt: input.fileCreatedAt ?? fileCreatedAtFromDisk,
  })
  if (!result.ok) return { ok: false, error: result.error }

  const document = parseAlsDocument(result.xml)
  const problems = validateGeneratedSet(result.xml)

  const bytes = gzipSync(Buffer.from(result.xml, "utf8"))
  // The same round-trip the tools edge does: a corrupt gzip produces a file
  // Live opens and then dies on, with nothing to explain why.
  if (gunzipSync(bytes).toString("utf8") !== result.xml) {
    return { ok: false, error: "gzip_roundtrip_failed" }
  }

  return {
    ok: true,
    data: {
      fileName: outputName(input.fileName),
      bytes,
      sourceVersion,
      alreadyV10: sourceVersion <= 10,
      scenes: document.scenes.length,
      tracks: document.tracks.length,
      scenesConverted: result.scenesConverted,
      warnings: result.warnings,
      problems,
    },
  }
}

/** The naming convention: `Song.als` → `Song [v10].als`. */
function outputName(fileName: string): string {
  const base = fileName.replace(/\.als$/i, "").trim()
  return `${safeFileName(base || "converted")} [v10].als`
}
