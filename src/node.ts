// Node adapter. This is the only place in the package allowed to touch `node:*`.
//
// The core works on the decompressed XML as a string and knows nothing about
// gzip or filesystems. That separation is what lets the same conversion logic
// run in a browser, so keep it: anything that reads the world belongs here.

import { gunzipSync, gzipSync } from "node:zlib"

/** An `.als` file is gzipped XML. Decompress it into the string the core wants. */
export function decodeAls(bytes: Uint8Array): string {
  return gunzipSync(bytes).toString("utf8")
}

/**
 * Compress XML back into `.als` bytes.
 *
 * Round-trips before returning: a corrupt gzip produces a file that Live opens
 * and then dies on, with nothing to explain why. Cheap check, expensive failure.
 */
export function encodeAls(xml: string): Uint8Array {
  const bytes = gzipSync(Buffer.from(xml, "utf8"))
  if (gunzipSync(bytes).toString("utf8") !== xml) {
    throw new Error("gzip round-trip failed; refusing to return corrupt bytes")
  }
  return new Uint8Array(bytes)
}

export { fileCreatedAt, MAX_UPLOAD_BYTES } from "./node/shared.js"

export {
  applyAlsTools,
  diagnoseAls,
  type ApplyReport,
  type Diagnosis,
  type Operation,
  type ToolAvailability,
  type ToolsResult,
} from "./node/tools.js"

export {
  convertAlsToV10,
  type ConversionReport,
  type ConversionResult,
} from "./node/convert.js"

export * from "./index.js"
