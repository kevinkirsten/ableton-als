// The messages between the page and its Web Worker. The worker owns the opened
// document; the page only ever holds what it needs to draw.

import type { MirrorPreview } from "../../src/index.js"
import type {
  Inspection,
  OpenError,
  Operation,
  SessionState,
} from "./engine.js"

export type Request =
  | { readonly type: "open"; readonly name: string; readonly bytes: ArrayBuffer }
  | { readonly type: "sample"; readonly which: "healthy" | "damaged" }
  /** Read the sample set for the landing page, without opening it. */
  | { readonly type: "preview" }
  | { readonly type: "convert"; readonly libraryRoot: string }
  | { readonly type: "tool"; readonly operation: Operation }
  | {
      readonly type: "previewMirror"
      readonly base: string
      readonly target: string
    }
  | { readonly type: "undo" }
  | { readonly type: "reset" }
  | { readonly type: "download" }
  | { readonly type: "close" }

export type Reply =
  /** What the worker is doing right now. Honest labels, never a percentage. */
  | { readonly type: "phase"; readonly label: string }
  | { readonly type: "state"; readonly state: SessionState }
  | { readonly type: "closed" }
  | { readonly type: "preview"; readonly inspection: Inspection }
  | { readonly type: "openError"; readonly code: OpenError | "crashed" }
  /** An action that was refused. The document is unchanged. */
  | { readonly type: "refused"; readonly message: string }
  | { readonly type: "mirrorPreview"; readonly preview: MirrorPreview }
  | {
      readonly type: "file"
      readonly name: string
      readonly bytes: ArrayBuffer
    }
