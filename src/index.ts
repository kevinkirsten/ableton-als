// Core entry point. Everything exported here is pure, dependency-free, and runs
// unchanged in Node, Deno, Bun, Workers and the browser. Nothing here may import
// `node:*` or any package — CI enforces it.

export {
  buildAliasRecord,
  hfsShortName,
  macCreationTime,
  MAC_EPOCH_OFFSET,
  SYNTHETIC_CREATION_TIME,
  type AliasInput,
  type AliasResult,
} from "./core/alias.js"

export {
  clipWarpBpm,
  collectClips,
  detectVersion,
  fixPointeeIds,
  inspectFollowActions,
  inspectPointeeIds,
  inspectRewarp,
  isUntestedVersion,
  listTrackNames,
  mirrorTrackGeometry,
  previewMirror,
  rewarpClips,
  supportsTool,
  syncFollowActions,
  TOOL_SUPPORT,
  type AlsVersion,
  type ClipRef,
  type FollowReport,
  type MirrorPreview,
  type PointeeReport,
  type RewarpReport,
  type ToolId,
  type ToolOutcome,
} from "./core/tools.js"

export {
  decodeTimeSignatureId,
  gridIsConsistent,
  parseAlsDocument,
  parseHeader,
  parseMasterTempo,
  parseScenes,
  parseTracks,
  readSceneTempo,
  unescapeXml,
  type AlsClip,
  type AlsDocument,
  type AlsHeader,
  type AlsSampleRef,
  type AlsScene,
  type AlsTimeSignature,
  type AlsTrack,
  type SceneSchemaVersion,
  type SceneTempo,
} from "./core/document.js"

export {
  applyEdits,
  clipColorIndex,
  describeClipSlotLists,
  emptyClipSlot,
  escapeXml,
  findClipSlotLists,
  findSceneRanges,
  insertSceneRows,
  maxElementId,
  removeScenes,
  withClipColorIndex,
  withElementId,
  withElementValue,
  withNextPointeeId,
  type ClipSlotListInfo,
  type Edit,
  type InsertRowsResult,
  type Range,
  type RemoveScenesResult,
  type SceneRow,
} from "./core/surgery.js"

export {
  collectPointeeRoles,
  collectRoleIds,
  remapClipEnvelopes,
  trackSegment,
  type RemapResult,
} from "./core/clip-envelopes.js"

export {
  convertFileRefs,
  convertFollowActions,
  convertScenes,
  downgradeToV10,
  majorVersionOf,
  toV10Chance,
  v10ColorIndex,
  v10SceneName,
  type DowngradeOptions,
  type DowngradeResult,
  type DowngradeWarning,
} from "./core/downgrade.js"

export {
  clipColorHex,
  isNeutralLiveColor,
  liveColorHex,
  paletteIndexFromFileColor,
} from "./core/live-palette.js"

export {
  validateGeneratedSet,
  type ValidationProblem,
} from "./core/validate.js"
