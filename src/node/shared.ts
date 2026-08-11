// Internals shared by the Node adapter modules. Nothing here is part of the
// public surface except what `src/node.ts` explicitly re-exports.

import { statSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { macCreationTime } from "../core/alias.js"

/** A large v12 `.als` passes 20 MB decompressed; 80 MB is headroom with a cap. */
export const MAX_UPLOAD_BYTES = 80 * 1024 * 1024

/** An `.als` is gzip; some are saved raw. Try to decompress, fall back to text. */
export function readXml(bytes: Uint8Array): string | null {
  try {
    return gunzipSync(bytes).toString("utf8")
  } catch {
    const text = Buffer.from(bytes).toString("utf8")
    return text.trimStart().startsWith("<") ? text : null
  }
}

/**
 * A file name safe for `Content-Disposition` (keeps accents and spaces).
 *
 * Deliberately DUPLICATED from the first consumer rather than imported: it is
 * a six-line leaf with no state, and moving its whole storage module for one
 * sanitizer would be worse than two copies with a test each.
 */
export function safeFileName(name: string): string {
  return name.replace(/[/\\?%*:|"<>\x00-\x1f]/g, "_").slice(0, 180)
}

/**
 * The creation date for a sample's alias record, read from disk.
 *
 * Returns `null` when the file is not reachable from this machine — a normal
 * situation, not an error. The caller then writes an empty `<Data>`, and Live
 * asks the user to locate the audio once.
 *
 * Live ignores this value in practice (measured), so hosts without a
 * filesystem can pass `SYNTHETIC_CREATION_TIME` instead of calling this.
 */
export function fileCreatedAt(absolutePath: string): number | null {
  try {
    const birthtime = statSync(absolutePath).birthtime
    // The alias stores local time; `getTimezoneOffset` is minutes, sign
    // inverted, and is taken from the file's own date so historical daylight
    // saving does not shift everything.
    return macCreationTime(
      birthtime.getTime() / 1000,
      -birthtime.getTimezoneOffset() * 60
    )
  } catch {
    return null
  }
}
