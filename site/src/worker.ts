// The Web Worker: every byte of the opened set stays here. Decompression,
// parsing, validation, conversion, repairs and compression all happen off the
// main thread, because a 50 MB XML string and several passes over it would
// freeze the page.

import { decodeAls, encodeAls } from "../../src/web.js"
import { checkDocument, inspect, looksGzipped, Session } from "./engine.js"
import type { Reply, Request } from "./protocol.js"
import {
  buildDamagedSampleSet,
  buildSampleSet,
  DAMAGED_FILE_NAME,
  SAMPLE_FILE_NAME,
} from "./sample.js"

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

const phase = (label: string): void => send({ type: "phase", label })

function publish(): void {
  if (session === null) return
  send({ type: "state", state: session.state(phase) })
}

async function open(name: string, buffer: ArrayBuffer): Promise<void> {
  const bytes = new Uint8Array(buffer)
  if (bytes.length === 0) return send({ type: "openError", code: "empty_file" })

  let xml: string
  if (looksGzipped(bytes)) {
    phase("Decompressing…")
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
      phase("Building the sample set…")
      const damaged = request.which === "damaged"
      const xml = damaged ? buildDamagedSampleSet() : buildSampleSet()
      const size = (await encodeAls(xml)).length
      session = new Session(
        damaged ? DAMAGED_FILE_NAME : SAMPLE_FILE_NAME,
        xml,
        size,
        true
      )
      return publish()
    }
    case "preview": {
      const xml = buildSampleSet()
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
      phase("Converting to the Live 10 format…")
      const result = session.convert(request.libraryRoot)
      if (!result.ok) send({ type: "refused", message: result.error })
      return publish()
    }
    case "tool": {
      phase("Applying the repair…")
      const result = session.applyTool(request.operation)
      if (!result.ok) send({ type: "refused", message: result.error })
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
        return send({ type: "refused", message: state.output.blocked.message })
      }
      phase("Compressing…")
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
