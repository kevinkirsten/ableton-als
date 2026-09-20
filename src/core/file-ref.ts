// ---------------------------------------------------------------------------
// The `<FileRef>`: how a Live set says where a sample lives.
//
// It is its own module because two very different operations write the same
// thing, and they must never drift: the v12 to v10 downgrade, which rebuilds
// every ref from the v12 shape, and `relinkFileRefs`, which re-roots refs that
// are already in the v10 shape at a different copy of the same library.
//
// The second one exists because a set assembled from song files carries their
// refs verbatim, and those point at the machine of whoever split the tracks.
// On any other machine every clip is missing.
// ---------------------------------------------------------------------------

import { buildAliasRecord } from "./alias.js"
import { unescapeXml } from "./document.js"
import { applyEdits, escapeXml, type Edit } from "./surgery.js"

/** Captures the tag's own attributes and its body. Stateful: reset `lastIndex`. */
export const FILE_REF =
  /<FileRef((?:\s+[\w:-]+="[^"]*")*)\s*>([\s\S]*?)<\/FileRef>/g

export const AUDIO_FILE = /\.(wav|aif|aiff|mp3|flac|ogg|m4a)$/i

function readValue(body: string, tag: string): string | null {
  const match = new RegExp(`<${tag} Value="([^"]*)" />`).exec(body)
  return match ? unescapeXml(match[1]!) : null
}

/**
 * The `<Data>` of the FileRef: the alias record Live 10 uses to find the
 * file. Empty when it cannot be built (no date, or outside `/Volumes`) — the
 * set then opens with the clips greyed out, but it opens, and the caller warns.
 *
 * The hex goes out in 80-character lines, as Ableton writes it.
 */
export function aliasData(
  path: string,
  fileCreatedAt?: ((absolutePath: string) => number | null) | undefined
): string {
  if (!fileCreatedAt) return `<Data />`
  const absolute = path.startsWith("/") ? path : `/${path}`
  const createdAt = fileCreatedAt(absolute)
  if (createdAt === null || createdAt === undefined) return `<Data />`
  const alias = buildAliasRecord({ absolutePath: absolute, createdAt })
  if (!alias.ok) return `<Data />`
  const lines = alias.hex.match(/.{1,80}/g) ?? []
  return `<Data>\n\t${lines.join("\n\t")}\n\t</Data>`
}

/**
 * The v10 `FileRef`, written the way Live 10 itself writes one that always
 * opened: no relative path, the whole absolute path in the `PathHint`, and the
 * alias record in `<Data>`.
 *
 * MEASURED, not chosen: all 392 FileRefs of the small v10 reference set are
 * `false`/`0`/empty list. Writing `RelativePathType=3` made Live 10 open with
 * ALL clips greyed out, and `1` with the up-level elements did not fix it
 * either (two tests in real Live). The relative path Live writes after you
 * locate the samples by hand is ANOTHER thing, and no reference for whoever
 * writes the file from scratch.
 */
export function writeV10FileRef(input: {
  /** The tag's own attributes, `Id` included: a list member must keep it. */
  readonly attributes: string
  /** Absolute path of the file, already rooted at the library. */
  readonly absolutePath: string
  readonly type: string
  readonly fileSize: string
  readonly crc: string
  readonly fileCreatedAt?: ((absolutePath: string) => number | null) | undefined
}): string {
  const segments = input.absolutePath.split("/").filter(Boolean)
  const fileName = segments[segments.length - 1] ?? ""

  // Ids local to the FileRef, as in the real files — a global counter would
  // inflate the document's highest Id and break the `NextPointeeId`.
  let elementId = 0
  const element = (dir: string): string =>
    `<RelativePathElement Id="${elementId++}" Dir="${escapeXml(dir)}" />`

  // An empty list is written self-closed, as Live 10 writes it.
  const list = (tag: string, dirs: readonly string[]): string =>
    dirs.length === 0
      ? `<${tag} />`
      : `<${tag}>${dirs.map(element).join("")}</${tag}>`

  const hasExtendedInfo = input.fileSize !== "0" || input.crc !== "0"

  return [
    `<FileRef${input.attributes}>`,
    `<HasRelativePath Value="false" />`,
    `<RelativePathType Value="0" />`,
    `<RelativePath />`,
    `<Name Value="${escapeXml(fileName)}" />`,
    `<Type Value="${input.type}" />`,
    aliasData(segments.join("/"), input.fileCreatedAt),
    `<RefersToFolder Value="false" />`,
    `<SearchHint>`,
    list("PathHint", segments.slice(0, -1)),
    `<FileSize Value="${input.fileSize}" />`,
    `<Crc Value="${input.crc}" />`,
    `<MaxCrcSize Value="${hasExtendedInfo ? "16384" : "0"}" />`,
    `<HasExtendedInfo Value="${hasExtendedInfo}" />`,
    `</SearchHint>`,
    `<LivePackName Value="" />`,
    `<LivePackId Value="" />`,
    `</FileRef>`,
  ].join("")
}

/** Directories of an element list (`<RelativePath>`, `<PathHint>`). */
function dirsOf(body: string, tag: string): string[] | null {
  const block = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body)
  if (!block) return null
  return [...block[1]!.matchAll(/Dir="([^"]*)"/g)].map((match) =>
    unescapeXml(match[1]!)
  )
}

export type RelinkOptions = {
  /**
   * The file's creation date, for the alias record. Reading the disk is an
   * effect, so the caller supplies it.
   */
  readonly fileCreatedAt?:
    | ((absolutePath: string) => number | null)
    | undefined
  /**
   * Last word on where the file really is, called for EVERY ref this function
   * rebuilds. It exists because the document can be stale: a folder renamed or
   * moved after the `.als` was saved leaves a path that points nowhere, and
   * only the caller can look at the disk to find out. Return the path to
   * write, or `null` to keep the rebuilt one.
   *
   * Measured in the archive: three songs had their audio moved or their folder
   * renamed (a key corrected from Ab to Bb, a song filed under its campus),
   * which was 686 of the 698 clips that still opened greyed out.
   */
  readonly locate?:
    | ((input: {
        readonly candidate: string
        readonly fileName: string
      }) => string | null)
    | undefined
}

export type RelinkReport = {
  readonly xml: string
  /** Refs rewritten to point inside `libraryRoot`. */
  readonly relinked: number
  /** Of those, how many `locate` sent somewhere other than the rebuilt path. */
  readonly located: number
  /**
   * Refs left untouched because the document does not say where the file sits
   * inside the library. Their names, for the caller to report.
   */
  readonly unresolved: readonly string[]
}

/**
 * Re-roots every v10 `FileRef` at `libraryRoot`, keeping each file's place
 * INSIDE the library.
 *
 * A set assembled by transplanting blocks from song files inherits their refs,
 * and those carry the absolute path of the machine that authored them. The
 * path within the library is still right, though, and the document states it
 * twice: in the `<RelativePath>` chain (Live 10 writes it relative to the
 * Project) and in the `<SearchHint><PathHint>` absolute chain. Either one, hung
 * off the local root, gives the local path.
 *
 * Refs already in the v12 shape are not touched — that is `convertFileRefs`.
 */
export function relinkFileRefs(
  xml: string,
  libraryRoot: string,
  options: RelinkOptions = {}
): RelinkReport {
  const root = libraryRoot.replace(/\/+$/, "")
  const rootName = root.split("/").filter(Boolean).pop() ?? ""
  const edits: Edit[] = []
  const unresolved: string[] = []
  let located = 0

  FILE_REF.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FILE_REF.exec(xml)) !== null) {
    const attributes = match[1] ?? ""
    const body = match[2]!
    const name = readValue(body, "Name")
    // No `<Name>` means the v12 shape, which belongs to `convertFileRefs`.
    if (name === null) continue

    // The `<RelativePath>` chain first: it is already measured from the
    // library root. An empty `Dir` is an up-level, which makes the chain
    // relative to the `.als` instead, and we do not know where that will sit.
    const relativeDirs = dirsOf(body, "RelativePath")
    const fromRelative =
      relativeDirs !== null &&
      relativeDirs.length > 0 &&
      relativeDirs.every((dir) => dir !== "")
        ? relativeDirs
        : null

    // Fallback: the absolute hint of the machine that wrote the file. The part
    // after the library's own folder name is the path inside the library.
    const hintDirs = dirsOf(body, "PathHint") ?? []
    const cut = hintDirs.lastIndexOf(rootName)
    const fromHint = cut >= 0 ? hintDirs.slice(cut + 1) : null

    const dirs = fromRelative ?? fromHint
    if (dirs === null) {
      if (AUDIO_FILE.test(name)) unresolved.push(name)
      continue
    }

    const candidate = [root, ...dirs, name].join("/")
    const encontrado = options.locate?.({ candidate, fileName: name }) ?? null
    if (encontrado !== null && encontrado !== candidate) located++
    const replacement = writeV10FileRef({
      attributes,
      absolutePath: encontrado ?? candidate,
      type: readValue(body, "Type") ?? "2",
      fileSize: readValue(body, "FileSize") ?? "0",
      crc: readValue(body, "Crc") ?? "0",
      fileCreatedAt: options.fileCreatedAt,
    })
    if (replacement === match[0]) continue
    edits.push({
      start: match.index,
      end: match.index + match[0].length,
      replacement,
    })
  }

  return {
    xml: applyEdits(xml, edits),
    relinked: edits.length,
    located,
    unresolved,
  }
}
