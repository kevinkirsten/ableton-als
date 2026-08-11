// ---------------------------------------------------------------------------
// The `.als` tools edge: takes uploaded bytes, decompresses, runs the pure
// algorithms from `core/tools.ts` and returns the file. Nothing is written
// anywhere — the caller's archive is never touched.
// ---------------------------------------------------------------------------

import { gunzipSync, gzipSync } from "node:zlib"
import {
  detectVersion,
  fixPointeeIds,
  inspectFollowActions,
  inspectPointeeIds,
  inspectRewarp,
  listTrackNames,
  mirrorTrackGeometry,
  rewarpClips,
  isUntestedVersion,
  supportsTool,
  syncFollowActions,
  type AlsVersion,
  type ToolId,
} from "../core/tools.js"
import { parseAlsDocument } from "../core/document.js"
import { validateGeneratedSet } from "../core/validate.js"
import { MAX_UPLOAD_BYTES, readXml, safeFileName } from "./shared.js"

export type ToolAvailability = {
  readonly id: ToolId
  readonly supported: boolean
  /** How many items the tool would fix. 0 = everything is fine. */
  readonly pending: number
  /** Why it cannot run right now (version, or the algorithm's own guard). */
  readonly blocked: string | null
  /** Per-tool numbers for a UI. */
  readonly detail: Readonly<Record<string, string | number>>
}

export type Diagnosis = {
  readonly fileName: string
  readonly version: AlsVersion
  readonly scenes: number
  readonly tracks: number
  readonly clips: number
  readonly masterBpm: number | null
  readonly trackNames: readonly string[]
  readonly tools: readonly ToolAvailability[]
  readonly problems: readonly {
    readonly rule: string
    readonly detail: string
  }[]
}

export type Operation =
  | { readonly tool: "pointeeIds" }
  | { readonly tool: "followActions" }
  | { readonly tool: "rewarp"; readonly bpm: number }
  | {
      readonly tool: "mirrorTrack"
      readonly base: string
      readonly target: string
    }

export type ApplyReport = {
  readonly fileName: string
  readonly applied: readonly {
    readonly tool: ToolId
    readonly summary: string
  }[]
  readonly failed: readonly { readonly tool: ToolId; readonly error: string }[]
  readonly diagnosis: Diagnosis
  readonly bytes: Uint8Array
}

export type ToolsResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string }

function diagnose(xml: string, fileName: string): Diagnosis {
  const version = detectVersion(xml)
  const document = parseAlsDocument(xml)
  const pointee = inspectPointeeIds(xml)
  const rewarp = inspectRewarp(xml)
  const trackNames = listTrackNames(xml)

  // Follow Action is only inspected where the fields exist — on v10 the read
  // would return zeros and a UI would lie that "everything is fine".
  const followSupported = supportsTool("followActions", version)
  const follow = followSupported ? inspectFollowActions(xml) : null

  // Two different reasons to refuse, and the operator needs to know which: the
  // whole version was never verified, or only this tool does not cover it.
  const unsupported = () =>
    isUntestedVersion(version)
      ? `Live ${version.major} files have not been verified yet — no fix runs on them`
      : `this tool does not yet run on Live ${version.major ?? "?"} files`

  const tools: ToolAvailability[] = [
    {
      id: "pointeeIds",
      supported: supportsTool("pointeeIds", version),
      pending: pointee.extraOccurrences,
      blocked: !supportsTool("pointeeIds", version)
        ? unsupported()
        : pointee.collidingReferences.length > 0
          ? `automation points at a duplicated Id (${pointee.collidingReferences.join(", ")}) — renumbering would attach it to the wrong occurrence`
          : null,
      detail: {
        targets: pointee.targets,
        duplicatedIds: pointee.duplicatedIds.length,
      },
    },
    {
      id: "rewarp",
      supported: supportsTool("rewarp", version),
      pending:
        rewarp.gridBpm !== null &&
        rewarp.masterBpm !== null &&
        Math.abs(rewarp.gridBpm - rewarp.masterBpm) > 1e-6
          ? rewarp.clips
          : 0,
      blocked: !supportsTool("rewarp", version) ? unsupported() : null,
      detail: {
        gridAt: rewarp.gridBpm ?? "—",
        master: rewarp.masterBpm ?? "—",
        clips: rewarp.clips,
      },
    },
    {
      id: "mirrorTrack",
      supported: supportsTool("mirrorTrack", version),
      pending: 0,
      blocked: !supportsTool("mirrorTrack", version)
        ? unsupported()
        : trackNames.length < 2
          ? "the file does not have two tracks with clips"
          : null,
      detail: { tracks: trackNames.length },
    },
    {
      id: "followActions",
      supported: followSupported,
      pending:
        follow === null
          ? 0
          : follow.needEnable + follow.needUnlink + follow.needRetime,
      blocked: !followSupported
        ? unsupported()
        : follow !== null && follow.conflicting.length > 0
          ? `${follow.conflicting.length} scene(s) have clips with different durations — without a single duration per row there is no way to tell when to jump`
          : null,
      detail:
        follow === null
          ? {}
          : {
              enable: follow.needEnable,
              unlink: follow.needUnlink,
              retime: follow.needRetime,
              scenes: follow.scenesWithDuration,
            },
    },
    {
      id: "relinkSamples",
      supported: supportsTool("relinkSamples", version),
      pending: 0,
      blocked: !supportsTool("relinkSamples", version)
        ? unsupported()
        : "needs the project folder on disk — use a script for now",
      detail: {},
    },
  ]

  return {
    fileName,
    version,
    scenes: document.scenes.length,
    tracks: document.tracks.length,
    clips: document.tracks
      .flatMap((track) => track.sessionClips)
      .filter(Boolean).length,
    masterBpm: rewarp.masterBpm,
    trackNames,
    tools,
    problems: validateGeneratedSet(xml).map((problem) => ({
      rule: problem.rule,
      detail: problem.detail,
    })),
  }
}

export function diagnoseAls(input: {
  readonly fileName: string
  readonly bytes: Uint8Array
}): ToolsResult<Diagnosis> {
  if (input.bytes.length === 0) return { ok: false, error: "empty_file" }
  if (input.bytes.length > MAX_UPLOAD_BYTES)
    return { ok: false, error: "too_large" }
  const xml = readXml(input.bytes)
  if (xml === null) return { ok: false, error: "not_an_als" }
  const version = detectVersion(xml)
  if (version.major === null) return { ok: false, error: "not_an_als" }
  return { ok: true, data: diagnose(xml, input.fileName) }
}

/**
 * Applies the operations IN ORDER, each over the previous one's result. One
 * that fails does not take the others down — it goes into the report and the
 * file continues with what worked, because aborting everything over one would
 * throw away work that was already correct.
 */
export function applyAlsTools(input: {
  readonly fileName: string
  readonly bytes: Uint8Array
  readonly operations: readonly Operation[]
}): ToolsResult<ApplyReport> {
  if (input.bytes.length === 0) return { ok: false, error: "empty_file" }
  if (input.bytes.length > MAX_UPLOAD_BYTES)
    return { ok: false, error: "too_large" }
  const original = readXml(input.bytes)
  if (original === null) return { ok: false, error: "not_an_als" }

  const version = detectVersion(original)
  if (version.major === null) return { ok: false, error: "not_an_als" }
  if (input.operations.length === 0)
    return { ok: false, error: "no_operations" }

  let xml = original
  const applied: { tool: ToolId; summary: string }[] = []
  const failed: { tool: ToolId; error: string }[] = []

  for (const operation of input.operations) {
    // The version guard belongs to this edge, not to a UI: a forged POST must
    // not run an algorithm on a version that lacks its fields.
    if (!supportsTool(operation.tool, version)) {
      failed.push({
        tool: operation.tool,
        error: `does not run on Live ${version.major} files`,
      })
      continue
    }

    const outcome =
      operation.tool === "pointeeIds"
        ? fixPointeeIds(xml)
        : operation.tool === "followActions"
          ? syncFollowActions(xml)
          : operation.tool === "rewarp"
            ? rewarpClips(xml, operation.bpm)
            : mirrorTrackGeometry(xml, operation.base, operation.target)

    if (outcome.ok) {
      xml = outcome.xml
      applied.push({ tool: operation.tool, summary: outcome.summary })
    } else {
      failed.push({ tool: operation.tool, error: outcome.error })
    }
  }

  const bytes = gzipSync(Buffer.from(xml, "utf8"))
  // The same round-trip as the porter: a corrupt gzip yields a file Live
  // opens and then dies on, with nothing to explain why.
  if (gunzipSync(bytes).toString("utf8") !== xml) {
    return { ok: false, error: "gzip_roundtrip_failed" }
  }

  return {
    ok: true,
    data: {
      fileName: outputName(input.fileName),
      applied,
      failed,
      diagnosis: diagnose(xml, input.fileName),
      bytes,
    },
  }
}

function outputName(fileName: string): string {
  const base = fileName.replace(/\.als$/i, "").trim()
  return `${safeFileName(base || "fixed")} [fix].als`
}
