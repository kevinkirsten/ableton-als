// The Web Worker: every byte of the opened set stays here. Decompression,
// parsing, validation, conversion, repairs and compression all happen off the
// main thread, because a 50 MB XML string and several passes over it would
// freeze the page.

import { decodeAls, encodeAls } from "../../src/web.js"
import {
  checkDocument,
  inspect,
  looksGzipped,
  outputRefusal,
  Session,
  type Phase,
} from "./engine.js"
import type { Reply, Request } from "./protocol.js"
import { sampleBytes } from "./sample-bytes.js"
import {
  buildDamagedSampleSet,
  DAMAGED_FILE_NAME,
  SAMPLE_FILE_NAME,
} from "./sample-set.js"

/** The sample as Live 12 saved it, decompressed once. */
let sampleXml: string | null = null

async function loadSample(): Promise<string> {
  sampleXml ??= await decodeAls(sampleBytes())
  return sampleXml
}

type WorkerScope = {
  postMessage(message: Reply, transfer?: Transferable[]): void
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<Request>) => void
  ): void
}

const scope = self as unknown as WorkerScope

let session: Session | null = null

function send(reply: Reply, transfer?: Transferable[]): void {
  scope.postMessage(reply, transfer)
}

// The worker speaks in codes only. Every sentence is the page's to word.
const phase = (phase: Phase): void => send({ type: "phase", phase })

function publish(): void {
  if (session === null) return
  send({ type: "state", state: session.state(phase) })
}

async function open(name: string, buffer: ArrayBuffer): Promise<void> {
  const bytes = new Uint8Array(buffer)
  if (bytes.length === 0) return send({ type: "openError", code: "empty_file" })

  let xml: string
  if (looksGzipped(bytes)) {
    phase("decompressing")
    try {
      xml = await decodeAls(bytes)
    } catch {
      return send({ type: "openError", code: "corrupt_gzip" })
    }
  } else {
    // Some people unzip a set by hand to look inside. Accept the raw XML too.
    const text = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart()
    if (!text.startsWith("<")) return send({ type: "openError", code: "not_gzip" })
    xml = new TextDecoder().decode(bytes)
  }

  const problem = checkDocument(xml)
  if (problem !== null) return send({ type: "openError", code: problem })

  session = new Session(name, xml, bytes.length)
  publish()
}

async function handle(request: Request): Promise<void> {
  switch (request.type) {
    case "open":
      return open(request.name, request.bytes)
    case "sample": {
      phase("building_sample")
      const damaged = request.which === "damaged"
      const healthy = await loadSample()
      session = damaged
        ? new Session(
            DAMAGED_FILE_NAME,
            buildDamagedSampleSet(healthy),
            sampleBytes().length,
            "damaged"
          )
        : new Session(SAMPLE_FILE_NAME, healthy, sampleBytes().length, "sample")
      return publish()
    }
    case "preview": {
      const xml = await loadSample()
      return send({
        type: "preview",
        inspection: inspect(xml, { fileName: SAMPLE_FILE_NAME, sizeBytes: 0 }),
      })
    }
    case "close":
      session = null
      return send({ type: "closed" })
  }

  if (session === null) return

  switch (request.type) {
    case "convert": {
      phase("converting")
      const result = session.convert(request.libraryRoot)
      if (!result.ok) send({ type: "refused", refusal: result.refusal })
      return publish()
    }
    case "tool": {
      phase("repairing")
      const result = session.applyTool(request.operation)
      if (!result.ok) send({ type: "refused", refusal: result.refusal })
      return publish()
    }
    case "previewMirror":
      return send({
        type: "mirrorPreview",
        preview: session.previewMirror(request.base, request.target),
      })
    case "undo":
      session.undo()
      return publish()
    case "reset":
      session.reset()
      return publish()
    case "download": {
      const state = session.state()
      if (state.output.blocked !== null) {
        return send({
          type: "refused",
          refusal: outputRefusal(state.output.blocked),
        })
      }
      phase("compressing")
      // `encodeAls` round-trips before returning: a corrupt gzip yields a file
      // Live opens and then dies on.
      const bytes = await encodeAls(session.xml)
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer
      return send({ type: "file", name: state.output.name, bytes: buffer }, [
        buffer,
      ])
    }
  }
}

scope.addEventListener("message", (event) => {
  handle(event.data).catch(() => {
    send({ type: "openError", code: "crashed" })
  })
})
