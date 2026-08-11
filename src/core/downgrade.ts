// ---------------------------------------------------------------------------
// Porter of `.als` files from Live 12 to Live 10.
//
// It exists because the archive is v10 and new work happens in Live 12. Live
// migrates FORWARD on its own — a v10 file opens in 12 — but there is no way
// back: Live 10 will not even open a v12 file.
//
// The technique is the same as the rest of the core: string surgery over the
// original text, never DOM. Whatever is not touched comes out byte-for-byte
// identical.
//
// HARD RULE: a field whose meaning changed between versions and that this
// module cannot translate becomes a WARNING, never a guess. A wrong follow
// action does not break the file — it makes the scene fail to chain in the
// middle of a live performance, which is worse.
// ---------------------------------------------------------------------------

import { buildAliasRecord } from "./alias.js"
import { decodeTimeSignatureId, unescapeXml } from "./document.js"
import {
  applyEdits,
  escapeXml,
  findSceneRanges,
  type Edit,
} from "./surgery.js"

/** The header of a file Live 10.1.43 opens. */
const V10_HEADER =
  '<Ableton MajorVersion="5" MinorVersion="10.0_377" SchemaChangeCount="6" Creator="Ableton Live 10.1.43" Revision="0e617fc8048569557b05b35c5dcc68f74fed435a">'

const ABLETON_TAG = /<Ableton[^>]*>/

/**
 * A stable identifier for each warning. `detail` is English prose, ready to
 * print; `code` and `values` are the same message taken apart, so a consumer
 * can render it in another language without parsing English. Codes are part of
 * the public contract.
 */
export type DowngradeCode = "jump_follow_action" | "samples_outside_root"

export type DowngradeWarning = {
  readonly kind: "follow_action" | "sample_ref" | "unknown_element"
  /** English prose, ready to print. */
  readonly detail: string
  readonly code: DowngradeCode
  /** The values interpolated into `detail`, kept separate for localization. */
  readonly values: Readonly<Record<string, string | number>>
}

export type DowngradeResult =
  | {
      readonly ok: true
      readonly xml: string
      readonly scenesConverted: number
      readonly warnings: readonly DowngradeWarning[]
    }
  | { readonly ok: false; readonly error: string }

/** The version declared in the header, to decide whether there is anything to convert. */
export function majorVersionOf(xml: string): number | null {
  const match = /<Ableton[^>]*MinorVersion="(\d+)\./.exec(xml)
  return match ? Number(match[1]) : null
}

export type DowngradeOptions = {
  /**
   * The library root. v12 writes the wav's ABSOLUTE path; this root is what
   * resolves the paths that already come relative.
   */
  readonly libraryRoot: string
  /**
   * The file's creation date, in seconds since 1904 and in LOCAL time (use
   * `macCreationTime`). Without it the `<Data>` comes out empty and Live 10
   * opens the set with every clip greyed out — see `alias.ts`. It is a
   * callback because reading the disk is an effect, and this module is pure.
   */
  readonly fileCreatedAt?: (absolutePath: string) => number | null
}

export function downgradeToV10(
  rawXml: string,
  options?: DowngradeOptions
): DowngradeResult {
  const version = majorVersionOf(rawXml)
  if (version === null) return { ok: false, error: "not a Live file" }
  if (version <= 10) {
    return { ok: true, xml: rawXml, scenesConverted: 0, warnings: [] }
  }

  const warnings: DowngradeWarning[] = []
  const edits: Edit[] = []

  // BEFORE anything else: Ableton writes SINGLE-quoted attributes when the
  // value contains double quotes (`Value='"death could not"'`). Every regex
  // below assumes double quotes — without normalizing, those scene names are
  // not read, the `<Name>` is left behind inside the Scene and Live 10
  // desynchronizes. Eleven scenes of the golden pair were reported as "erased
  // by v12" when they were actually this.
  const xml = normalizeSingleQuotedAttributes(rawXml)

  const header = ABLETON_TAG.exec(xml)
  if (!header) return { ok: false, error: "header not found" }
  edits.push({
    start: header.index,
    end: header.index + header[0]!.length,
    replacement: V10_HEADER,
  })

  const scenes = convertScenes(xml)
  edits.push(...scenes.edits)

  const follow = convertFollowActions(xml)
  edits.push(...follow.edits)
  warnings.push(...follow.warnings)

  if (options) {
    const refs = convertFileRefs(
      xml,
      options.libraryRoot,
      options.fileCreatedAt
    )
    edits.push(...refs.edits)
    warnings.push(...refs.warnings)
  }

  // Direct renames: same meaning, new name. `Color` → `ColorIndex` is NOT
  // here: the index changes by context (a track takes +140, a clip stays raw)
  // and `convertColors` owns that.
  const renamed = applyEdits(xml, edits)
    // The tag opens WITH attributes in v12 (`<MainTrack SelectedToolPanel="7" …>`).
    .replace(/<MainTrack(?=[\s>])/g, "<MasterTrack")
    .replace(/<\/MainTrack>/g, "</MasterTrack>")
    .replace(/<IsSongTempoLeader /g, "<IsSongTempoMaster ")
    // v10 keeps the scenes inside <SceneNames>; v12 renamed the container to
    // <Scenes>. Live 10 looks for the old name.
    .replace(/<Scenes>/g, "<SceneNames>")
    .replace(/<\/Scenes>/g, "</SceneNames>")
    .replace(/<Scenes \/>/g, "<SceneNames />")
    .replace(/<IsContentSelectedInDocument /g, "<IsContentSelected ")
    .replace(/<ReWireDeviceMidiTargetId /g, "<ReWireSlaveMidiTargetId ")
    // Macros 0–7 exist in both; 8 through 15 were born in Live 11 and go.
    .replace(/<MacroColor\.([0-7]) /g, "<MacroColorIndex.$1 ")
    // A macro with no color: v12 writes -1, v10 writes 0 (measured on the
    // golden pair).
    .replace(
      /<MacroColorIndex\.([0-7]) Value="-1" \/>/g,
      '<MacroColorIndex.$1 Value="0" />'
    )
    // The send's on/off: v12 rebranded `Active` as `EnabledByUser`.
    .replace(/<EnabledByUser /g, "<Active ")
    .replace(/<ViewStateSessionTrackWidth /g, "<ViewStateSesstionTrackWidth ")
    .replace(
      /<AutoColorPickerForReturnAndMainTracks>/g,
      "<AutoColorPickerForReturnAndMasterTracks>"
    )
    .replace(
      /<\/AutoColorPickerForReturnAndMainTracks>/g,
      "</AutoColorPickerForReturnAndMasterTracks>"
    )
    // v12's Master→Main rename reached the routing STRINGS, not only the tags.
    // Live 10 does not know the "AudioOut/Main" destination — the route does
    // not resolve. (Curiously the display strings say "Master" even in v12.)
    .replace(/Value="AudioOut\/Main"/g, 'Value="AudioOut/Master"')
    .replace(/Value="AudioIn\/Main"/g, 'Value="AudioIn/Master"')
    // The schema version encoded in hex: v10 writes 2561 = 0x0A01 (10.1);
    // v12 leaves 3076 = 0x0C04 (12.4) in the LiveSet and in every device.
    .replace(
      /<OverwriteProtectionNumber Value="\d+" \/>/g,
      '<OverwriteProtectionNumber Value="2561" />'
    )

  const skeleton = fixMasterTrackSkeleton(convertColors(renamed))

  return {
    ok: true,
    xml: restoreV10OnlyElements(
      dropInvalidChildren(dropV12OnlyElements(skeleton))
    ),
    scenesConverted: scenes.converted,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Document skeleton
// ---------------------------------------------------------------------------

/**
 * `Attr='value'` → `Attr="value"`, escaping the inner double quotes as
 * `&quot;` — which is exactly how Live 10 writes those values. The content of
 * `<Data>`/`<Buffer>` (pure hex, no `=`) is not affected.
 */
function normalizeSingleQuotedAttributes(xml: string): string {
  return xml.replace(
    /([\w.:-]+)='([^']*)'/g,
    (_, attribute: string, value: string) =>
      `${attribute}="${value.replace(/"/g, "&quot;")}"`
  )
}

/**
 * Parents whose `Color` uses the shifted index in v10: tracks, rack chains
 * (`DrumBranch` measured on the golden pair; the siblings are the same color
 * widget) and the scenes (handled in `stripSceneFields`). A clip keeps the RAW
 * index — measured: the track with Color 22 becomes ColorIndex 162 and the
 * same-colored clip stays 22.
 */
const SHIFTED_COLOR_PARENTS: ReadonlySet<string> = new Set([
  "AudioTrack",
  "MidiTrack",
  "GroupTrack",
  "ReturnTrack",
  "MasterTrack",
  "PreHearTrack",
  "DrumBranch",
  "InstrumentBranch",
  "AudioEffectBranch",
  "MidiEffectBranch",
])

/**
 * The palette is the same in both versions, but the index is not linear — map
 * measured on the golden pair (566 scenes, keyed by Id, no positional
 * alignment):
 *
 *   v12 -1 (no color) → v10 0
 *   v12 0..59         → v10 140..199  (+140)
 *   v12 61..69        → v10 279..287  (+218)
 *
 * 60 never appeared in the archive; +218 is the continuation of the upper
 * range (v10 jumps from 199 to 278).
 */
export function v10ColorIndex(v12Color: number): number {
  if (v12Color === -1) return 0
  return v12Color >= 60 ? v12Color + 218 : v12Color + 140
}

/**
 * `Color` → `ColorIndex` with the right shift per context. A global replace
 * will not do: a track's Color takes +140 and a clip's stays raw — and only
 * the parent stack tells the two apart.
 */
function convertColors(xml: string): string {
  const edits: Edit[] = []
  const stack: string[] = []

  ELEMENT.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ELEMENT.exec(xml)) !== null) {
    const [text, close, tag, attributes, self] = match
    if (close) {
      stack.pop()
      continue
    }
    if (self && tag === "Color") {
      const value = /Value="(-?\d+)"/.exec(attributes!)
      if (value) {
        const parent = stack[stack.length - 1] ?? "#"
        const index = SHIFTED_COLOR_PARENTS.has(parent)
          ? v10ColorIndex(Number(value[1]))
          : Number(value[1])
        edits.push({
          start: match.index,
          end: match.index + text!.length,
          replacement: `<ColorIndex Value="${index}" />`,
        })
      }
    }
    if (!self) stack.push(tag!)
  }

  return applyEdits(xml, edits)
}

/**
 * Residues the by-name lists cannot reach:
 *
 * 1. v12 writes one ClipSlot PER SCENE into the FreezeSequencer of the master
 *    AND of the GroupTracks; v10 writes those lists EMPTY. THIS was the cause
 *    of the segfault (EXC_BAD_ACCESS at 0x8 during SetSongUnit, no message) —
 *    on the master, found by bisection with 5 variants in real Live 10; on
 *    the groups, by the SAME crash stack on a second real set and by
 *    comparison with a native v10 file that has groups.
 * 2. The master/prehear `EffectiveName` keeps the new name ("Main"/"0-Main");
 *    v10 writes "Master". Scoped to each one's block so a user track that
 *    happens to be called "Main" is never renamed.
 */
function fixMasterTrackSkeleton(xml: string): string {
  const withMaster = transformBlock(xml, "MasterTrack", (block) =>
    block
      .replace(/<ClipSlotList>[\s\S]*?<\/ClipSlotList>/, "<ClipSlotList />")
      .replace(
        '<EffectiveName Value="Main" />',
        '<EffectiveName Value="Master" />'
      )
  )
  // GroupTracks are flat SIBLINGS inside <Tracks> (they never nest in the XML
  // — the link is by TrackGroupId), so the non-greedy per block is safe.
  const withGroups = withMaster.replace(
    /<GroupTrack[\s>][\s\S]*?<\/GroupTrack>/g,
    (block) =>
      block.replace(
        /<ClipSlotList>[\s\S]*?<\/ClipSlotList>/g,
        "<ClipSlotList />"
      )
  )
  return transformBlock(withGroups, "PreHearTrack", (block) =>
    block.replace(
      '<EffectiveName Value="0-Main" />',
      '<EffectiveName Value="Master" />'
    )
  )
}

/** Applies `transform` only to the stretch between `<tag …>` and `</tag>`. */
function transformBlock(
  xml: string,
  tag: string,
  transform: (block: string) => string
): string {
  const open = new RegExp(`<${tag}[\\s>]`).exec(xml)
  if (!open) return xml
  const close = xml.indexOf(`</${tag}>`, open.index)
  if (close === -1) return xml
  const end = close + `</${tag}>`.length
  return (
    xml.slice(0, open.index) +
    transform(xml.slice(open.index, end)) +
    xml.slice(end)
  )
}

/**
 * The reverse path, and the most treacherous one: elements v10 REQUIRES that
 * Live 12 stopped writing. With them missing the file passes validation,
 * opens — and Live 10 dies with a message-less segfault, after the document
 * has already loaded. This is how they surfaced (against a set saved in both
 * versions):
 *
 *   NeedRefreeze ....... 45,280 in v10, 0 in v12 — one per ClipSlot
 *   MarkerDensity ...... 4,766 in v10, 0 in v12 — one per AudioClip
 *   AutoWarpTolerance .. 4,766 in v10, 0 in v12 — same
 *
 * The values are constant across the whole archive, so restoring is safe.
 */
function restoreV10OnlyElements(xml: string): string {
  return (
    xml
      // Inside ScaleInformation, v10 calls the tonic RootNote.
      .replace(/(<ScaleInformation>\s*)<Root /g, "$1<RootNote ")
      // Some v12 files DO write the track's NeedArrangerRefreeze — inserting
      // the full pair would duplicate the member and Live 10 refuses with
      // "Class AudioTrack already has member". If it is already there, only
      // the VelocityDetail goes in between the two.
      .replace(
        /(<Freeze Value="[^"]*" \/>)(?!\s*<VelocityDetail)(\s*<NeedArrangerRefreeze )/g,
        '$1<VelocityDetail Value="0" />$2'
      )
      .replace(
        /(<Freeze Value="[^"]*" \/>)(?!\s*<VelocityDetail)/g,
        '$1<VelocityDetail Value="0" /><NeedArrangerRefreeze Value="true" />'
      )
      // Only the TRACK's IsContentSelected gains the pair — the lanes' does
      // not. The tiebreaker is the <TrackDelay> right after it.
      .replace(
        /(<IsContentSelected Value="[^"]*" \/>)(\s*<TrackDelay>)/g,
        '$1<EnvelopeModePreferred Value="false" />$2'
      )
      // Document interface state. It does not change the sound, but Live 10
      // reads the whole structure and dies silently when a piece is missing.
      .replace(
        /(<\/SequencerNavigator>)(?!\s*<ViewStateLaunchPanel)/g,
        '$1<ViewStateLaunchPanel Value="true" /><ViewStateEnvelopePanel Value="true" /><ViewStateSamplePanel Value="true" /><ContentSplitterProperties><Open Value="true" /><Size Value="35" /></ContentSplitterProperties>'
      )
      .replace(
        /(<SessionReturns Value="[^"]*" \/>)(?!\s*<SessionMixer)/g,
        '$1<SessionMixer Value="1" /><SessionTrackDelay Value="0" />'
      )
      .replace(
        /(<ArrangerReturns Value="[^"]*" \/>)(?!\s*<ArrangerMixer)/g,
        '$1<ArrangerMixer Value="0" /><ArrangerTrackDelay Value="0" />'
      )
      .replace(
        /(<\/Transport>)(?!\s*<SongMasterValues)/g,
        '$1<SongMasterValues><SessionScrollerPos X="0" Y="0" /></SongMasterValues>'
      )

      .replace(
        /(<CuePointsListWrapper LomId="[^"]*" \/>)(?!\s*<ChooserBar)/g,
        '$1<ChooserBar Value="1" />'
      )
      .replace(
        /(<TrackHeaderWidth Value="[^"]*" \/>)(?!\s*<ViewStateArrangerHasDetail)/g,
        '$1<ViewStateArrangerHasDetail Value="true" /><ViewStateSessionHasDetail Value="true" /><ViewStateDetailIsSample Value="true" />'
      )
      .replace(
        /(<ViewStateSamplePanel Value="[^"]*" \/>)/g,
        '$1<ViewStateSessionMixerHeight Value="138" />'
      )
      .replace(
        /(<HasStop Value="[^"]*" \/>)(?!\s*<NeedRefreeze)/g,
        '$1<NeedRefreeze Value="true" />'
      )
      .replace(
        /(<SampleVolume Value="[^"]*" \/>)(?!\s*<MarkerDensity)/g,
        '$1<MarkerDensity Value="2" /><AutoWarpTolerance Value="4" />'
      )
      // v12 stopped writing `IsEnabled` on MIDI notes (0 of 3,786 on the
      // golden pair); v10 always writes it, right before the NoteId. A note
      // disabled in v12 would keep the attribute and is not played.
      .replace(
        /<MidiNoteEvent (?![^>]*IsEnabled)([^>]*?) NoteId=/g,
        '<MidiNoteEvent $1 IsEnabled="true" NoteId='
      )
  )
}

/**
 * Attributes v12 added to elements that already existed. Live 10 is STRICT
 * about unknown attributes: it refuses the whole file with
 * "Unknown attribute 'X'". An unknown element is worse: no message — it
 * desynchronizes the positional reader and can take Live down without warning.
 */
const V12_ONLY_ATTRIBUTES = [
  "SelectedToolPanel",
  "SelectedGeneratorName",
  "SelectedTransformationName",
  "InitUpdateAreSlicesFromOnsetsEditableAfterRead",
]

const V12_ONLY_ELEMENTS: readonly string[] = [
  "AllowedKeys",
  "AreMacroVariationsControlsVisible",
  "AreSlicesFromOnsetsEditable",
  "ArrangementClipsListWrapper",
  "ArrangerMixerCrossFade",
  "ArrangerMixerIO",
  "ArrangerMixerReturns",
  "ArrangerMixerSends",
  "ArrangerMixerTrackOptions",
  "ArrangerMixerTrackPerformanceImpactMeter",
  "ArrangerMixerVolume",
  "ArrangerTrackOptions",
  "ArrangerVolume",
  "ComplexProEnvelopeModulationTarget",
  "ComplexProFormantsModulationTarget",
  "ContentLanes",
  "ControllerLayoutCustomization",
  "ControllerLayoutRemoteable",
  "DefaultGrooveId",
  "EcoProcessing",
  "ExcludeMacroFromRandomization.0",
  "ExcludeMacroFromRandomization.1",
  "ExcludeMacroFromRandomization.10",
  "ExcludeMacroFromRandomization.11",
  "ExcludeMacroFromRandomization.12",
  "ExcludeMacroFromRandomization.13",
  "ExcludeMacroFromRandomization.14",
  "ExcludeMacroFromRandomization.15",
  "ExcludeMacroFromRandomization.2",
  "ExcludeMacroFromRandomization.3",
  "ExcludeMacroFromRandomization.4",
  "ExcludeMacroFromRandomization.5",
  "ExcludeMacroFromRandomization.6",
  "ExcludeMacroFromRandomization.7",
  "ExcludeMacroFromRandomization.8",
  "ExcludeMacroFromRandomization.9",
  "ExcludeMacroFromSnapshots.0",
  "ExcludeMacroFromSnapshots.1",
  "ExcludeMacroFromSnapshots.10",
  "ExcludeMacroFromSnapshots.11",
  "ExcludeMacroFromSnapshots.12",
  "ExcludeMacroFromSnapshots.13",
  "ExcludeMacroFromSnapshots.14",
  "ExcludeMacroFromSnapshots.15",
  "ExcludeMacroFromSnapshots.2",
  "ExcludeMacroFromSnapshots.3",
  "ExcludeMacroFromSnapshots.4",
  "ExcludeMacroFromSnapshots.5",
  "ExcludeMacroFromSnapshots.6",
  "ExcludeMacroFromSnapshots.7",
  "ExcludeMacroFromSnapshots.8",
  "ExcludeMacroFromSnapshots.9",
  "ExpressionLanes",
  "FillerKeysMapTo",
  "ForceDisplayGenericValue.10",
  "ForceDisplayGenericValue.11",
  "ForceDisplayGenericValue.12",
  "ForceDisplayGenericValue.13",
  "ForceDisplayGenericValue.14",
  "ForceDisplayGenericValue.15",
  "ForceDisplayGenericValue.8",
  "ForceDisplayGenericValue.9",
  "GroovesListWrapper",
  "HighFilterType",
  "InKey",
  "InitialSlicePointsFromOnsets",
  "IsContentSplitterOpen",
  "IsExpressionSplitterOpen",
  "IsMinimized",
  "IsTuned",
  "IsWaveformVerticalZoomActive",
  "KeepRecordMonitoringLatency",
  "KeyNoteTarget",
  "LocalFiltersJson",
  "MacroAnnotations.10",
  "MacroAnnotations.11",
  "MacroAnnotations.12",
  "MacroAnnotations.13",
  "MacroAnnotations.14",
  "MacroAnnotations.15",
  "MacroAnnotations.8",
  "MacroAnnotations.9",
  "MacroColor.10",
  "MacroColor.11",
  "MacroColor.12",
  "MacroColor.13",
  "MacroColor.14",
  "MacroColor.15",
  "MacroColor.8",
  "MacroColor.9",
  "MacroControls.10",
  "MacroControls.11",
  "MacroControls.12",
  "MacroControls.13",
  "MacroControls.14",
  "MacroControls.15",
  "MacroControls.8",
  "MacroControls.9",
  "MacroDefaults.10",
  "MacroDefaults.11",
  "MacroDefaults.12",
  "MacroDefaults.13",
  "MacroDefaults.14",
  "MacroDefaults.15",
  "MacroDefaults.8",
  "MacroDefaults.9",
  "MacroDisplayNames.10",
  "MacroDisplayNames.11",
  "MacroDisplayNames.12",
  "MacroDisplayNames.13",
  "MacroDisplayNames.14",
  "MacroDisplayNames.15",
  "MacroDisplayNames.8",
  "MacroDisplayNames.9",
  "MidiCtrl.4",
  "MidiCtrl.5",
  "MidiEditorLaneModel",
  "MidiFoldMode",
  "MixerInArrangement",
  "MixerInSession",
  "Modulation_Morph",
  "Modulation_Sixteenth",
  "Modulation_SyncedRate",
  "Modulation_Time",
  "Modulation_TimeMode",
  "Modulation_Waveform",
  "MpePitchBendRange",
  "MultiClipFocusMode",
  "MultiClipLoopBarHeight",
  "NumVisibleMacroControls",
  "OctaveEvery",
  "OctaveSource",
  "PitchClassSource",
  "PitchbendRange",
  "Pointee",
  "ResetNonautomatedMidiControllersOnClipStarts",
  "RoundRobin",
  "RoundRobinMode",
  "RoundRobinRandomSeed",
  "RoundRobinResetPeriod",
  "SelectedBreakpointValue",
  "SelectedDocumentViewInMainWindow",
  "SessionScrollPos",
  "SessionTrackOptions",
  "SessionTrackPerformanceImpactMeter",
  "SessionVolume",
  "ShouldSceneTempoAndTimeSignatureBeVisible",
  "ShowLfo",
  "SizeSmoothing",
  "StepSize",
  "TakeLanesListWrapper",
  "TransientEnvelopeModulationTarget",
  "UserTempoAutomation",
  "ViewStateArrangerMixerVolumeSectionHeight",
  "ViewStateMainWindowClipDetailOpen",
  "ViewStateMainWindowDeviceDetailOpen",
  "ViewStateMainWindowHiddenOtherDocViewTypeClipDetailOpen",
  "ViewStateMainWindowHiddenOtherDocViewTypeDeviceDetailOpen",
  "ViewStateSecondWindowClipDetailOpen",
  "ViewStateSecondWindowDeviceDetailOpen",
  "ViewStateSessionMixerVolumeSectionHeight",
  "WaveformVerticalZoomFactor",
]

/**
 * Elements v10 does not know. An unknown element is NOT safely ignored — it
 * desynchronizes the positional reader (it cost three rounds of testing to
 * discover that).
 */
const V12_ONLY_SELF_CLOSING = [
  "TakeId",
  "IsInKey",
  "SamplesToAutoWarp",
  "LinkedTrackGroupId",
  "AreTakeLanesFolded",
  "SourceHint",
  "OriginalFileSize",
  "OriginalCrc",
  "PreferredContentViewMode",
  "NoteSpellingPreference",
  "AccidentalSpellingPreference",
  "PreferFlatRootNote",
  "NoteEditorFoldScaleZoom",
  "NoteEditorFoldScaleScroll",
  "MpePitchBendUsesTuning",
  "BreakoutIsExpanded",
  "ModulationSourceCount",
]

const V12_ONLY_BLOCKS = [
  "TakeLanes",
  "MpeSettings",
  "SignalModulations",
  "NoteProbabilityGroups",
  "LinkedTrackGroups",
  "TuningSystems",
  "MacroVariations",
  // MIDI generators and transformations: an entire Live 12 feature. This is
  // where the thousands of <Pitch>, <Velocity>, <Density> that v10 does not
  // know come from.
  "NoteAlgorithms",
  "NamedKeyMidiRemoteables",
  "ExpressionGrid",
  "MacroSnapshots",
  "ProbabilityGroupIdGenerator",
]

/**
 * Elements that EXIST in v10, but not in that place. The by-name list cannot
 * solve this case — it was measured by comparing the parent→child relations
 * of the converted file with those of a v10 file of the same content.
 */
const V12_ONLY_CHILDREN: readonly string[] = [
  "AudioClip>ScaleInformation",
  "AudioSequencer>ViewData",
  "CircuitBpNoMo>MidiControllerRange",
  "CircuitLpHp>MidiControllerRange",
  "CrossFadeState>MidiControllerRange",
  "Delay>ViewData",
  "DelayLine_SmoothingMode>MidiControllerRange",
  "DelayLine_SyncedSixteenthL>MidiControllerRange",
  "DelayLine_SyncedSixteenthR>MidiControllerRange",
  "DrumGroupDevice>ViewData",
  "FreezeSequencer>ViewData",
  "GroovePool>LomId",
  // The v10 GroupTrack does NOT freeze (no Freeze/VelocityDetail/
  // NeedArrangerRefreeze — measured on a native v10 file with groups, Live
  // 10.1.3); v12 writes Freeze and NeedArrangerRefreeze on it. Dropping here
  // also keeps the restore from inserting the VelocityDetail/
  // NeedArrangerRefreeze pair afterwards.
  "GroupTrack>Freeze",
  "GroupTrack>NeedArrangerRefreeze",
  "GroupTrack>VelocityDetail",
  "LoopMode>MidiControllerRange",
  "MainSequencer>ViewData",
  "MidiClip>ScaleInformation",
  "Mixer>ViewData",
  "MixerDevice>ViewData",
  "OriginalSimpler>ViewData",
  "PortamentoMode>MidiControllerRange",
  "RateType>MidiControllerRange",
  "Reverb>ViewData",
  "RoomType>MidiControllerRange",
  "StereoMode>MidiControllerRange",
  "SustainMode>MidiControllerRange",
  "TimeSignature>MidiControllerRange",
  "Type>MidiControllerRange",
]

const ELEMENT = /<(\/?)([A-Za-z_][\w.-]*)((?:\s+[\w.:-]+="[^"]*")*)\s*(\/?)>/g

/**
 * Removes a whole element (with children) when it appears under a parent v10
 * does not know. It needs a stack: the same `<ViewData>` is legitimate in one
 * place and an intruder in another, and a regex cannot see context.
 */
function dropInvalidChildren(xml: string): string {
  const invalid = new Set(V12_ONLY_CHILDREN)
  const edits: Edit[] = []
  const stack: string[] = []
  let skipDepth: number | null = null
  let skipStart = 0

  ELEMENT.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ELEMENT.exec(xml)) !== null) {
    const [text, close, tag, , self] = match
    if (close) {
      stack.pop()
      if (skipDepth !== null && stack.length === skipDepth) {
        edits.push({
          start: skipStart,
          end: match.index + text!.length,
          replacement: "",
        })
        skipDepth = null
      }
      continue
    }

    if (skipDepth === null) {
      const parent = stack[stack.length - 1] ?? "#"
      if (invalid.has(`${parent}>${tag}`)) {
        if (self) {
          edits.push({
            start: match.index,
            end: match.index + text!.length,
            replacement: "",
          })
        } else {
          skipDepth = stack.length
          skipStart = match.index
        }
      }
    }

    if (!self) stack.push(tag!)
  }

  return applyEdits(xml, edits)
}

function dropV12OnlyElements(xml: string): string {
  let result = xml
  for (const attribute of V12_ONLY_ATTRIBUTES) {
    result = result.replace(new RegExp(`\\s${attribute}="[^"]*"`, "g"), "")
  }
  // The list was DERIVED: everything left in the converted file that exists in
  // no v10 reference file of the same content. Assuming "Live 10 ignores
  // unknown elements" was the mistake that made the first three files crash
  // without a message.
  return removeElementsByName(
    result,
    new Set([
      ...V12_ONLY_ELEMENTS,
      ...V12_ONLY_SELF_CLOSING,
      ...V12_ONLY_BLOCKS,
      "AutomationEnvelopesListWrapper",
    ])
  )
}

/**
 * Removes whole elements (with children) by name, with a STACK — a non-greedy
 * regex stops at the first close and does not survive nesting: `<TakeLanes>`
 * contains another `<TakeLanes>` in v12, and the regex version left the outer
 * `</TakeLanes>` orphaned ("mismatched tag" in Live 10 — seen on two songs in
 * the archive).
 */
function removeElementsByName(xml: string, tags: ReadonlySet<string>): string {
  const edits: Edit[] = []
  const stack: string[] = []
  let skipDepth: number | null = null
  let skipStart = 0

  const leadingWhitespaceStart = (index: number): number => {
    let start = index
    while (start > 0 && /\s/.test(xml[start - 1] ?? "")) start -= 1
    return start
  }

  ELEMENT.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ELEMENT.exec(xml)) !== null) {
    const [text, close, tag, , self] = match
    if (close) {
      stack.pop()
      if (skipDepth !== null && stack.length === skipDepth) {
        edits.push({
          start: skipStart,
          end: match.index + text!.length,
          replacement: "",
        })
        skipDepth = null
      }
      continue
    }

    if (skipDepth === null && tags.has(tag!)) {
      const start = leadingWhitespaceStart(match.index)
      if (self) {
        edits.push({
          start,
          end: match.index + text!.length,
          replacement: "",
        })
      } else {
        skipDepth = stack.length
        skipStart = start
      }
    }

    if (!self) stack.push(tag!)
  }

  return applyEdits(xml, edits)
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

const SCENE_OPEN = /<Scene Id="(\d+)">/g

/**
 * In v12 the scene keeps tempo and time signature in structured fields and
 * the name in a `<Name>`. In v10 it is the name TEXT that programs both —
 * which is why Live 12 wiped "135BPM 4/4" from the names when migrating. Here
 * the information goes back into the text, the only place Live 10 will look
 * for it.
 */
export function convertScenes(xml: string): {
  readonly edits: readonly Edit[]
  readonly converted: number
} {
  const edits: Edit[] = []
  let converted = 0

  SCENE_OPEN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SCENE_OPEN.exec(xml)) !== null) {
    const close = xml.indexOf("</Scene>", match.index)
    if (close === -1) break
    const body = xml.slice(SCENE_OPEN.lastIndex, close)

    // A nameless scene does NOT have the `<Name>` element in v12 — it is gone,
    // not empty. A scene already in the v10 shape never gets here: the opening
    // regex demands the tag ending right after the Id, and the v10 one carries
    // `Value=` before that.
    const name = readAttribute(body, "Name") ?? ""

    edits.push({
      start: match.index,
      end: SCENE_OPEN.lastIndex,
      replacement: `<Scene Id="${match[1]}" Value="${escapeXml(
        v10SceneName(name, body)
      )}">`,
    })
    edits.push(...stripSceneFields(body, SCENE_OPEN.lastIndex))
    converted += 1
  }

  return { edits, converted }
}

/**
 * Rebuilds the text Live 10 reads. v12 erased the tempo and time-signature
 * tokens from the name but LEFT the separators: `WEIGHT…WAVES;4/4;131 BPM [2]`
 * became `WEIGHT…WAVES;; [2]`. Putting them back where the `;` run is returns
 * the name exactly as Ableton writes it — checked against a pair of the same
 * set saved in both versions.
 */
export function v10SceneName(name: string, sceneBody: string): string {
  const tempo =
    readValue(sceneBody, "IsTempoEnabled") === "true"
      ? readValue(sceneBody, "Tempo")
      : null
  const signatureId =
    readValue(sceneBody, "IsTimeSignatureEnabled") === "true"
      ? readValue(sceneBody, "TimeSignatureId")
      : null
  const signature =
    signatureId === null ? null : decodeTimeSignatureId(Number(signatureId))

  // The archive's convention changes with the separator: `4/4;126 BPM` with a
  // semicolon (time signature first), `136BPM 4/4` with a space (tempo first).
  const timeSignature = signature ? `${signature.num}/${signature.den}` : null
  const semicolonTokens = [
    timeSignature,
    tempo !== null ? `${formatTempo(tempo)} BPM` : null,
  ].filter((token): token is string => token !== null)
  const spaceTokens = [
    tempo !== null ? `${formatTempo(tempo)}BPM` : null,
    timeSignature,
  ].filter((token): token is string => token !== null)
  const tokens = semicolonTokens

  if (tokens.length === 0) return name

  // Erasing the tokens left the punctuation behind — a run of `;` or of
  // spaces. Putting them back there returns the name as Ableton writes it:
  //   "WEIGHT…WAVES;; [2]"  → "WEIGHT…WAVES;4/4;131 BPM [2]"
  //   "PREROLL CLICK  ;"    → "PREROLL CLICK  4/4;126 BPM"
  //   "CLICK  (slow 3/4)"   → "CLICK 6/4 (slow 3/4)"
  //   "CLICK -  "           → "CLICK - 136BPM 4/4"
  const semicolons = /;+/.exec(name)
  if (semicolons) {
    return splice(
      name,
      semicolons,
      ";".repeat(semicolons[0]!.length - 1) + semicolonTokens.join(";")
    )
  }

  const spaces = /\s{2,}/.exec(name)
  if (spaces) {
    const width = spaces[0]!.length
    const atEnd = spaces.index + width === name.length
    // At the end nothing remains after; in the middle, one space stays on the
    // other side.
    const before = " ".repeat(
      Math.max(1, width - spaceTokens.length + (atEnd ? 1 : 0))
    )
    return splice(
      name,
      spaces,
      before + spaceTokens.join(" ") + (atEnd ? "" : " ")
    )
  }

  return `${name}${name.endsWith(" ") ? "" : " "}${spaceTokens.join(" ")}`
}

/**
 * Replaces the matched stretch, GUARANTEEING space at the borders. Without it
 * the token glues onto the name (`WHAT A BEAUTIFUL NAME4/4`) and neither Live
 * nor we recognize the time signature there — the scene would open with no
 * time signature programmed.
 */
function splice(
  text: string,
  match: RegExpExecArray,
  replacement: string
): string {
  const before = text.slice(0, match.index)
  const after = text.slice(match.index + match[0]!.length)
  // Only add a space if NEITHER side already has one — otherwise the
  // reconstruction would gain spaces the original did not have.
  const needsLeading =
    before !== "" && !/[\s;]$/.test(before) && !/^[\s;]/.test(replacement)
  const needsTrailing =
    after !== "" && !/^[\s;[]/.test(after) && !/[\s;]$/.test(replacement)
  return (
    before +
    (needsLeading ? " " : "") +
    replacement +
    (needsTrailing ? " " : "") +
    after
  )
}

function formatTempo(raw: string): string {
  const value = Number(raw)
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(2)))
}

/** The v12-only fields go; the `Color` becomes `ColorIndex`. */
function stripSceneFields(body: string, offset: number): readonly Edit[] {
  const edits: Edit[] = []

  for (const tag of [
    "Name",
    "Tempo",
    "IsTempoEnabled",
    "TimeSignatureId",
    "IsTimeSignatureEnabled",
  ]) {
    const found = new RegExp(`\\s*<${tag} Value="[^"]*" />`).exec(body)
    if (found) {
      edits.push({
        start: offset + found.index,
        end: offset + found.index + found[0]!.length,
        replacement: "",
      })
    }
  }

  const follow = /\s*<FollowAction>[\s\S]*?<\/FollowAction>/.exec(body)
  if (follow) {
    edits.push({
      start: offset + follow.index,
      end: offset + follow.index + follow[0]!.length,
      replacement: "",
    })
  }

  const color = /<Color Value="(-?\d+)" \/>/.exec(body)
  if (color) {
    edits.push({
      start: offset + color.index,
      end: offset + color.index + color[0]!.length,
      // The scene index takes the same shift as the track's: v12's Color 13
      // is v10's ColorIndex 153, and -1 (no color) becomes 0.
      replacement: `<ColorIndex Value="${v10ColorIndex(Number(color[1]))}" />`,
    })
  }

  return edits
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Text comes ESCAPED from the XML. Unescaping here is mandatory: whoever
 * writes afterwards escapes again, and without this the folder
 * `Every Little Thing_(Y&F)` would become `(Y&amp;F)` in the final file — and
 * Live would not find the audio.
 */
function readValue(body: string, tag: string): string | null {
  const match = new RegExp(`<${tag} Value="([^"]*)" />`).exec(body)
  return match ? unescapeXml(match[1]!) : null
}

/** `<Name Value="…" />` directly in the body, without descending into nested children. */
function readAttribute(body: string, tag: string): string | null {
  const match = new RegExp(`<${tag} Value="([^"]*)" />`).exec(body)
  return match ? unescapeXml(match[1]!) : null
}

// ---------------------------------------------------------------------------
// Follow actions
// ---------------------------------------------------------------------------

/**
 * The codes were NOT renumbered between the versions (checked on the
 * calibration pair: 1=Stop … 8=Other match exactly). What changed is how "no
 * action" is said:
 *
 *   v10 → `FollowActionA = 0`
 *   v12 → `FollowActionEnabled = false` (and `FollowActionA` keeps the UI
 *          default, 4/Next, with no effect at all)
 *
 * Translating that wrong does not break the file — it makes the scene fail to
 * chain in the middle of a live performance, which is far worse to discover.
 */
const NO_ACTION = 0
/** `Jump` (9) was born in Live 11 and has no v10 equivalent. */
const JUMP = 9

const FOLLOW_BLOCK = /<FollowAction>([\s\S]*?)<\/FollowAction>/g

export function convertFollowActions(xml: string): {
  readonly edits: readonly Edit[]
  readonly warnings: readonly DowngradeWarning[]
} {
  const edits: Edit[] = []
  const warnings: DowngradeWarning[] = []

  // The v12 scene also has a `<FollowAction>`, but the v10 scene has no
  // follow field at all — `convertScenes` owns it and simply discards it.
  // Without this line the two conversions would fight over the same stretch.
  const scenes = findSceneRanges(xml)
  const insideScene = (offset: number): boolean =>
    scenes.some((range) => offset >= range.start && offset < range.end)

  FOLLOW_BLOCK.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FOLLOW_BLOCK.exec(xml)) !== null) {
    if (insideScene(match.index)) continue
    const body = match[1]!
    const enabled = readValue(body, "FollowActionEnabled") !== "false"
    const declaredA = Number(readValue(body, "FollowActionA") ?? "0")
    const declaredB = Number(readValue(body, "FollowActionB") ?? "0")

    if (enabled && (declaredA === JUMP || declaredB === JUMP)) {
      warnings.push({
        kind: "follow_action",
        code: "jump_follow_action",
        values: {},
        detail:
          'a clip uses the "Jump" follow action, which does not exist in Live 10 — it became "No Action" and must be redone by hand',
      })
    }

    const actionA = !enabled || declaredA === JUMP ? NO_ACTION : declaredA
    const actionB = !enabled || declaredB === JUMP ? NO_ACTION : declaredB
    const chance = toV10Chance(
      Number(readValue(body, "FollowChanceA") ?? "100"),
      Number(readValue(body, "FollowChanceB") ?? "0")
    )

    edits.push({
      start: match.index,
      end: match.index + match[0]!.length,
      replacement: [
        `<FollowTime Value="${readValue(body, "FollowTime") ?? "4"}" />`,
        `<FollowActionA Value="${actionA}" />`,
        `<FollowActionB Value="${actionB}" />`,
        `<FollowChanceA Value="${chance.a}" />`,
        `<FollowChanceB Value="${chance.b}" />`,
      ].join(""),
    })
  }

  return { edits, warnings }
}

/**
 * v12 keeps the chance as a PERCENTAGE; v10, as an A:B ratio in integers
 * (100% becomes `1/0`). Reducing by the GCD reproduces exactly what Live 10
 * writes — that is how the calibration pair matched.
 */
export function toV10Chance(
  percentA: number,
  percentB: number
): { readonly a: number; readonly b: number } {
  const first = Math.max(0, Math.round(percentA))
  const second = Math.max(0, Math.round(percentB || 100 - first))
  const divisor = greatestCommonDivisor(first, second)
  return divisor === 0
    ? { a: 1, b: 0 }
    : { a: first / divisor, b: second / divisor }
}

function greatestCommonDivisor(left: number, right: number): number {
  return right === 0 ? left : greatestCommonDivisor(right, left % right)
}

// ---------------------------------------------------------------------------
// SampleRef
// ---------------------------------------------------------------------------

// A device preset's FileRef comes WITH an attribute (`<FileRef Id="4">`),
// which v10 does not know — hence the `[^>]*`.
const FILE_REF = /<FileRef((?:\s+[\w:-]+="[^"]*")*)\s*>([\s\S]*?)<\/FileRef>/g
const AUDIO_FILE = /\.(wav|aif|aiff|mp3|flac|ogg|m4a)$/i

/**
 * The `<Data>` of the FileRef: the alias record Live 10 uses to find the
 * file. Empty when it cannot be built (no date, or outside `/Volumes`) — the
 * set then opens with the clips greyed out, but it opens, and the warning
 * warns.
 *
 * The hex goes out in 80-character lines, as Ableton writes it.
 */
function aliasData(
  path: string,
  fileCreatedAt?: (absolutePath: string) => number | null
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

export function convertFileRefs(
  xml: string,
  libraryRoot: string,
  fileCreatedAt?: (absolutePath: string) => number | null
): {
  readonly edits: readonly Edit[]
  readonly warnings: readonly DowngradeWarning[]
} {
  const edits: Edit[] = []
  const warnings: DowngradeWarning[] = []
  const root = libraryRoot.replace(/\/+$/, "")
  const unresolved = new Set<string>()

  // TODO FileRefs in the v12 shape, including device presets': leaving a
  // `<RelativePath Value="…">` behind would make Live 10 refuse the file.
  FILE_REF.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FILE_REF.exec(xml)) !== null) {
    const offset = match.index
    // The FileRef's `Id` MUST survive: when it is a list member (a device's
    // `<OriginalFileRef>`, for instance) Live 10 refuses the file with
    // "Not all list members have Ids".
    const attributes = match[1] ?? ""
    const body = match[2]!
    // A FileRef already in the v10 shape has `<Name>`; that one is not touched.
    if (/<Name Value="/.test(body)) continue

    const absolute = readValue(body, "Path")
    if (absolute === null) continue

    // v12 writes an absolute path most of the time, but sometimes one already
    // relative to the library root — that is the normal case, not a lost file.
    const relative = !absolute.startsWith("/")
    const inside = relative || absolute.startsWith(`${root}/`)
    // A factory preset lives outside the library and that is normal; audio
    // outside it is not.
    if (!inside && AUDIO_FILE.test(absolute)) unresolved.add(absolute)

    // Always in absolute terms: the v10 relative path is measured from the
    // `.als` folder to the sample's, and for that both need the same ruler.
    const segments =
      absolute === ""
        ? []
        : (relative ? `${root}/${absolute}` : absolute)
            .split("/")
            .filter(Boolean)
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

    const absoluteDirs = segments.slice(0, -1)

    // A ref with no size or CRC goes out as v10 writes it: all zeroed and
    // `HasExtendedInfo` false (measured on the 20 empty refs of the golden
    // pair).
    const fileSize = readValue(body, "OriginalFileSize") ?? "0"
    const crc = readValue(body, "OriginalCrc") ?? "0"
    const hasExtendedInfo = fileSize !== "0" || crc !== "0"

    edits.push({
      start: offset,
      end: offset + match[0]!.length,
      replacement: [
        `<FileRef${attributes}>`,
        // NO relative path, and this is MEASURED, not chosen: all 392 FileRefs
        // of the small v10 reference set — written by Live 10 itself and one
        // that always opened — are `false`/`0`/empty list. What resolves the
        // file is the absolute `PathHint` right below.
        //
        // The porter used to write `RelativePathType=3` and Live 10 opened
        // with ALL clips greyed out; switching to `1` with the up-level
        // elements did not fix it (two tests in real Live). The relative path
        // Live writes after you locate the samples by hand is ANOTHER thing,
        // and it is no reference for whoever writes the file from scratch.
        `<HasRelativePath Value="false" />`,
        `<RelativePathType Value="0" />`,
        `<RelativePath />`,
        `<Name Value="${escapeXml(fileName)}" />`,
        `<Type Value="${readValue(body, "Type") ?? "2"}" />`,
        aliasData(segments.join("/"), fileCreatedAt),
        `<RefersToFolder Value="false" />`,
        `<SearchHint>`,
        list("PathHint", absoluteDirs),
        `<FileSize Value="${fileSize}" />`,
        `<Crc Value="${crc}" />`,
        `<MaxCrcSize Value="${hasExtendedInfo ? "16384" : "0"}" />`,
        `<HasExtendedInfo Value="${hasExtendedInfo}" />`,
        `</SearchHint>`,
        `<LivePackName Value="" />`,
        `<LivePackId Value="" />`,
        `</FileRef>`,
      ].join(""),
    })
  }

  if (unresolved.size > 0) {
    warnings.push({
      kind: "sample_ref",
      code: "samples_outside_root",
      values: {
        count: unresolved.size,
        sample: [...unresolved].slice(0, 3).join(", "),
      },
      detail: `${unresolved.size} audio file(s) outside the library root — the relative path could not be built: ${[
        ...unresolved,
      ]
        .slice(0, 3)
        .join(", ")}`,
    })
  }

  return { edits, warnings }
}
