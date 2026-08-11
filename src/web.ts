// Web adapter. Uses only platform APIs — no `node:*`, no packages — so it runs
// in browsers, Workers and edge runtimes.
//
// This is the entry point behind the project's flagship claim: a `.als` can be
// converted entirely on the user's machine, with the file never leaving it.
// Every alternative tool is either a Python CLI or a web service that requires
// an upload.

import { SYNTHETIC_CREATION_TIME } from "./core/alias.js"

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

/** An `.als` file is gzipped XML. Decompress it into the string the core wants. */
export async function decodeAls(bytes: Uint8Array): Promise<string> {
  const stream = streamOf(bytes).pipeThrough(new DecompressionStream("gzip"))
  return new TextDecoder().decode(await collect(stream))
}

/**
 * Compress XML back into `.als` bytes.
 *
 * Round-trips before returning, for the same reason the Node adapter does: a
 * corrupt gzip yields a file Live opens and then dies on, silently.
 */
export async function encodeAls(xml: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(xml)
  const stream = streamOf(encoded).pipeThrough(new CompressionStream("gzip"))
  const bytes = await collect(stream)
  if ((await decodeAls(bytes)) !== xml) {
    throw new Error("gzip round-trip failed; refusing to return corrupt bytes")
  }
  return bytes
}

/**
 * The creation date to stamp into alias records in a browser.
 *
 * A browser cannot read file creation dates, and it does not need to: Live
 * ignores the field (measured — a file written with a deliberately wrong
 * constant date opens with all clips loaded). The absolute path, which Live
 * *does* use, is already inside the Live 12 document.
 *
 * The constant is deliberately implausible so that anyone inspecting a produced
 * file can tell it carries no information.
 */
export function fileCreatedAt(): number {
  return SYNTHETIC_CREATION_TIME
}

export * from "./index.js"
