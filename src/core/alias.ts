// ---------------------------------------------------------------------------
// The macOS alias record that lives in the `<Data>` element of every `<FileRef>`
// in a Live 10 set.
//
// WHY THIS EXISTS: Live 10 locates audio through this blob. Not through the
// absolute `PathHint`, not through the relative path, not through `<Name>`.
// Without it a set opens with every clip greyed out ("Media files are
// missing"). Measured in both directions against real Live 10: emptying the 392
// blobs of a set that opens normally greys it out; grafting them back into a
// greyed-out set makes it open.
//
// Live 12 writes no `<Data>` at all, so a 12 -> 10 conversion has nothing to
// copy. The record has to be generated.
//
// The layout is the classic Alias Manager format (version 2), mapped byte for
// byte against real blobs — 391 originally, and 952 more from two purpose-built
// Live 10 sets plus 2,782 from a large archive. The part that matters:
// `parentCNID`, `fileCNID` and the `nlvl` fields all ship DISABLED (0xFFFF...)
// and `volumeCreated` is zero. Live does not resolve by inode — it resolves from
// the path strings carried in the tags. That is what makes generation possible
// without touching a filesystem.
//
// `fileType` and `creator` are the exception: they are NOT constants. They are
// the first eight bytes of the file's `com.apple.FinderInfo` extended attribute,
// and they are ZERO when the file carries no such attribute. Reading an xattr is
// I/O, so they arrive as optional inputs; the default reproduces the
// overwhelmingly common case (2,377 of 2,782 archive files carry
// `FF FF FF FF FF FF FF FF` there).
//
// The creation date is ignored too: a file written with a deliberately wrong
// constant date opens with all clips loaded. This is what lets the same
// generator run in a browser, which cannot read file creation dates at all.
//
// This module is PURE. It takes a path and a date and returns hex. Reading the
// filesystem is the adapter's job.
// ---------------------------------------------------------------------------

/** Seconds between 1904-01-01 (Mac epoch) and 1970-01-01 (Unix epoch). */
export const MAC_EPOCH_OFFSET = 2_082_844_800

/**
 * A creation date in the alias format: seconds since 1904, in **local** time.
 *
 * Measured: real blobs sat exactly 10,800 s (3 h, the author's UTC-3 offset)
 * behind the file's `birthtime` in UTC.
 *
 * Live ignores this value, so a constant is acceptable where no filesystem is
 * available — see `SYNTHETIC_CREATION_TIME`.
 */
export function macCreationTime(
  birthtimeSeconds: number,
  utcOffsetSeconds: number
): number {
  return Math.floor(birthtimeSeconds) + MAC_EPOCH_OFFSET + utcOffsetSeconds
}

/**
 * A deliberately meaningless creation date, for hosts with no filesystem.
 *
 * 2001-01-01T00:00:00. Chosen to be obviously synthetic: anyone inspecting a
 * produced file should be able to tell the value carries no information, rather
 * than mistake a plausible-looking timestamp for a real one.
 */
export const SYNTHETIC_CREATION_TIME = 3_061_152_000

export type AliasInput = {
  /** Absolute path to the file, starting at `/Volumes/<volume>/`. */
  readonly absolutePath: string
  /** Output of `macCreationTime`, or `SYNTHETIC_CREATION_TIME`. */
  readonly createdAt: number
  /**
   * Volume attributes. The default is the value measured on one external SSD;
   * no second volume has ever been sampled.
   */
  readonly volumeAttributes?: number
  readonly filesystemId?: number
  /**
   * Bytes 0-3 of the file's `com.apple.FinderInfo` xattr, as a big-endian
   * number. Zero when the file has no such attribute. Defaults to the disabled
   * value, which is what almost every file written by an audio tool carries.
   */
  readonly fileType?: number
  /** Bytes 4-7 of `com.apple.FinderInfo`. See `fileType`. */
  readonly creator?: number
}

export type AliasResult =
  | { readonly ok: true; readonly hex: string }
  | { readonly ok: false; readonly reason: "not_on_external_volume" }

const MAC_ROMAN_FALLBACK = 0x3f // "?"

/** Only the subset that appears in these paths; anything else becomes "?". */
function macRomanBytes(text: string): readonly number[] {
  return [...text].map((character) => {
    const code = character.codePointAt(0) ?? MAC_ROMAN_FALLBACK
    return code < 0x80 ? code : MAC_ROMAN_FALLBACK
  })
}

/**
 * The 31-character HFS name limit, and how Live fits a longer name into it.
 *
 * Measured against 72 mangled names across three Live 10 sets and an archive:
 * a name of 31 characters or fewer goes in whole; from 32 on, Live keeps a
 * prefix, inserts the literal marker `#FFFFFFFF` and re-attaches the extension,
 * always landing on exactly 30 characters. Two extension widths pin the rule to
 * a fixed TOTAL rather than a fixed prefix — `.wav`/`.mp3` keep 17 characters,
 * `.aiff` keeps 16.
 *
 * Only this field is mangled. The UTF-16 name tag and the colon-separated path
 * tag both carry the full name, and directory names are never shortened — a
 * 43-character folder appears whole in a record whose file name was mangled.
 */
const HFS_NAME_LIMIT = 31
const MANGLE_MARKER = "#FFFFFFFF"
const MANGLED_LENGTH = 30

export function hfsShortName(name: string): string {
  if (name.length <= HFS_NAME_LIMIT) return name
  const dot = name.lastIndexOf(".")
  const extension = dot > 0 ? name.slice(dot) : ""
  const kept = MANGLED_LENGTH - MANGLE_MARKER.length - extension.length
  // An extension long enough to leave no room was never observed; truncating
  // beats emitting a name longer than the field's own limit.
  if (kept < 1) return name.slice(0, MANGLED_LENGTH)
  return name.slice(0, kept) + MANGLE_MARKER + extension
}

function pascalString(text: string, size: number): readonly number[] {
  const bytes = macRomanBytes(text).slice(0, size - 1)
  return [
    bytes.length,
    ...bytes,
    ...Array.from({ length: size - 1 - bytes.length }, () => 0),
  ]
}

function uint16(value: number): readonly number[] {
  return [(value >> 8) & 0xff, value & 0xff]
}

function uint32(value: number): readonly number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]
}

function utf16Bytes(text: string): readonly number[] {
  return [...text].flatMap((character) => uint16(character.charCodeAt(0)))
}

/** A tag is `(number, length, body)`, with the body padded to two bytes. */
function tagged(number: number, body: readonly number[]): readonly number[] {
  return [
    ...uint16(number),
    ...uint16(body.length),
    ...body,
    ...(body.length % 2 === 1 ? [0] : []),
  ]
}

/**
 * Builds the alias record and returns the uppercase hex that goes inside
 * `<Data>`.
 *
 * Refuses any path not under `/Volumes/<volume>/`. The boot-volume variant of
 * this format was never measured, and guessing would produce a file that opens
 * and then finds nothing — which is precisely the defect this module exists to
 * fix. Declining is the honest failure.
 */
export function buildAliasRecord(input: AliasInput): AliasResult {
  const parts = input.absolutePath.split("/").filter(Boolean)
  if (parts.length < 4 || parts[0] !== "Volumes") {
    return { ok: false, reason: "not_on_external_volume" }
  }

  const volume = parts[1] ?? ""
  const fileName = parts[parts.length - 1] ?? ""
  const parentName = parts[parts.length - 2] ?? ""
  const mountPoint = `/Volumes/${volume}`
  const volumeRelative = `/${parts.slice(2).join("/")}`

  const fixed: readonly number[] = [
    ...uint32(0), // userType
    ...uint16(0), // recordSize — filled in at the end
    ...uint16(2), // version
    ...uint16(0), // kind: file
    ...pascalString(volume, 28),
    ...uint32(0), // volumeCreated — Live writes zero
    0x42,
    0x44, // "BD"
    ...uint16(1), // volumeType
    ...uint32(0xffffffff), // parentCNID, disabled
    ...pascalString(hfsShortName(fileName), 64),
    ...uint32(0xffffffff), // fileCNID, disabled
    ...uint32(input.createdAt),
    ...uint32(input.fileType ?? 0xffffffff),
    ...uint32(input.creator ?? 0xffffffff),
    ...uint16(0xffff), // nlvlFrom
    ...uint16(0xffff), // nlvlTo
    ...uint32(input.volumeAttributes ?? 0x00000a00),
    ...uint16(input.filesystemId ?? 0x7846),
    ...Array.from({ length: 10 }, () => 0), // reserved
  ]

  const tags: readonly number[] = [
    ...tagged(0, macRomanBytes(parentName)),
    ...tagged(2, macRomanBytes(`/:${parts.join(":")}`)),
    ...tagged(14, [...uint16(fileName.length), ...utf16Bytes(fileName)]),
    ...tagged(15, [...uint16(volume.length), ...utf16Bytes(volume)]),
    ...tagged(18, macRomanBytes(volumeRelative)),
    ...tagged(19, macRomanBytes(mountPoint)),
    ...uint16(0xffff), // tag -1: end of list
    ...uint16(0),
  ]

  const bytes = [...fixed, ...tags]
  const size = bytes.length
  bytes[4] = (size >> 8) & 0xff
  bytes[5] = size & 0xff

  return {
    ok: true,
    hex: bytes
      .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
      .join(""),
  }
}
