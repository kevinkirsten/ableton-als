// English: the default language and the source of truth. The other catalogs
// are typed as `Catalog`, so a key missing there, or one with a different
// shape, does not compile.
//
// Conventions every catalog follows:
//
// - A value is a string, or a function when a number or a name goes into the
//   sentence. Functions take numbers and strings only and never call a method
//   on a string argument, which lets the tests call every one of them blindly.
//   The exception is `messages`, typed by the library's own value shapes.
// - Entries marked RICH are read by `rich()` in `ui/dom.ts`:
//   `code`, **strong**, ~kept as written~ and [link text](target), where the
//   target is a name from `LINKS`, never a URL.
// - Live's own nouns stay in English in every language, because that is what
//   people see in Live: Session, scene, clip, track, warp, follow action,
//   Live Set, MIDI, BPM. So do `.als`, alias record and Id.
// - No em dash, no en dash, no exclamation mark.

import type { OpenError, Phase } from "../engine.js"
import type { Wording } from "../messages.js"
import { formatter } from "./format.js"

const { number, count, pick, bytes } = formatter("en")

const TOOL_TITLES = {
  pointeeIds: "Duplicate automation Ids",
  rewarp: "Clips warped at the wrong tempo",
  followActions: "Follow actions out of step",
  mirrorTrack: "Copy clip geometry between tracks",
  relinkSamples: "Samples that point at another machine",
}

const USE_NODE = "npm install ableton-als"

const messages: Wording = {
  orphan_pointee: ({ ids }) =>
    `Clip automation points at target Id ${ids}, which does not exist in this set. Live crashes resolving it while the set loads.`,
  duplicate_pointee_ids: ({ count: total, ids }) =>
    `${number(total)} automation target ${pick(total, "Id is", "Ids are")} used more than once: ${ids}. Live 11 and later refuse a set whose Ids are not unique. The repair "${TOOL_TITLES.pointeeIds}" fixes this.`,
  grid_slot_count: ({ list, track, slots, scenes }) =>
    `Clip slot list ${list}, on ${track === "" ? "the master track" : `track ${track}`}, has ${count(slots, "slot", "slots")} for ${count(scenes, "scene", "scenes")}. Every list needs exactly one slot per scene.`,
  grid_group_slot_count: ({ group, slots, scenes }) =>
    `Group track ${group} has ${count(slots, "slot", "slots")} of its own for ${count(scenes, "scene", "scenes")}. Live crashes opening a set like this.`,
  xml_mismatched_close: ({ closing, open, offset }) =>
    `The closing tag ${closing} at character ${number(offset)} does not match the open tag ${open}.`,
  xml_unclosed: ({ tags }) =>
    `These tags are still open at the end of the document: ${tags}.`,
  xml_duplicate_singleton: ({ element, parent, offset }) =>
    `${element} appears twice inside one ${parent}, at character ${number(offset)}. Live refuses a set that writes the same member twice.`,
  next_pointee_missing: () =>
    "The set has no NextPointeeId, the counter every new Id is taken from.",
  next_pointee_too_low: ({ declared, max }) =>
    `NextPointeeId is ${declared}, but the highest Id already in use is ${max}. Live would hand out an Id that is taken.`,
  routing_orphan_tracks: ({ ids }) =>
    `A track sends its output into track Id ${ids}, which does not exist in this set.`,
  jump_follow_action: () =>
    "A clip uses the follow action Jump, which Live 10 does not have. It was set to no action and has to be redone by hand.",
  samples_outside_root: ({ count: total, sample }) =>
    `${number(total)} audio ${pick(total, "file sits", "files sit")} outside the library folder: ${sample}. ${pick(total, "It was", "They were")} converted with ${pick(total, "its", "their")} full path.`,
}

export const en = {
  meta: {
    title:
      "ableton-als demo: inspect, repair and convert .als files in your browser",
    description:
      "Drop a Live Set (.als) to see its tracks, scenes and clips, check it for the damage that crashes Live, repair it, and convert a Live 12 set to Live 10. Runs entirely in your browser: the file never leaves your computer.",
  },

  header: {
    demo: "demo",
    projectLinks: "Project links",
    language: "Language",
    toLight: "Switch to the light theme",
    toDark: "Switch to the dark theme",
  },

  common: {
    tracks: (total: number) => count(total, "track", "tracks"),
    scenes: (total: number) => count(total, "scene", "scenes"),
    clips: (total: number) => count(total, "clip", "clips"),
    problems: (total: number) => count(total, "problem", "problems"),
    /** A count or a BPM on its own, as this language writes numbers. */
    number: (value: number) => number(value, 3),
    bpm: (value: number) => `${number(value)} BPM`,
    unnamed: "(unnamed)",
    notStated: "not stated",
    none: "none",
    /** "3 of 55". */
    partOfTotal: (part: number, total: number) =>
      `${number(part)} of ${number(total)}`,
  },

  landing: {
    title: "Inspect, repair and convert Live Sets, right in this tab.",
    /** RICH */
    lead: "Drop an `.als` file to see its tracks, scenes and clips, check it for the damage that makes Live refuse or crash, fix it, and turn a Live 12 set into one Live 10 can open.",
    /** RICH */
    dropTitle: "Drop an ~.als~ file anywhere on this page",
    chooseFile: "Choose a file",
    openSample: "Open the sample set",
    openDamaged: "Open a damaged one",
    /** RICH */
    privacy:
      "**Your file never leaves this computer.** This page has no server, and its security policy forbids every network request, so it could not upload a set if it tried. [How to check that yourself.](verify)",
    previewLabel: "The sample set as this page reads it",
    /** Shown until the page has read the sample. */
    previewCaption:
      "The sample set: saved by Live 12 for this page. Its audio is synthesized tones and is not included.",
    previewCaptionCounted: (tracks: number, scenes: number, clips: number) =>
      `The sample set as this page reads it: ${count(tracks, "track", "tracks")}, ${count(scenes, "scene", "scenes")}, ${count(clips, "clip", "clips")}. It was saved by Live 12 for this page. Its audio is synthesized tones and is not included.`,
    dropVeil: "Drop the file to open it",
  },

  about: {
    does: {
      title: "What this page does",
      inspect:
        "The Live version that saved the set, its tempo, tracks, scenes and clips with the colours stored in the file, and every audio file it references.",
      validate:
        "The structural rules Live depends on: one clip slot per scene in every track, automation that points at a real target, routes that lead to a real track. Each problem comes with a stable code and its values.",
      convert:
        "Live 12 to Live 10. Live has no downgrade path, so the page rebuilds the file the older version expects, including the alias records Live 10 finds audio by.",
      repair:
        "Duplicate automation Ids, clips warped at the wrong tempo, follow actions out of step, clip geometry that differs between tracks, and samples that point at another machine.",
      /** RICH */
      code: "Every action shows the code that does the same thing with the [ableton-als](repo) library, for the browser and for Node.",
    },
    verify: {
      title: "Check the privacy claim",
      network:
        "Open your browser's developer tools on the Network tab, then open a set and convert it. No request appears.",
      offline:
        "Load this page, turn Wi-Fi off, and use it. Everything still works.",
      /** RICH */
      source:
        "View the page source. The `Content-Security-Policy` tag at the top carries `connect-src 'none'`, which makes the browser itself refuse any upload.",
    },
    measured: {
      title: "What was measured, and what was not",
      versions:
        "Conversion was measured against sets written by Live 10.1.43 and Live 12.4.3 on macOS. A converted 561-scene set opened in Live 10 with no missing files.",
      /** RICH */
      aliases:
        "Alias records are built only for audio under `/Volumes/`. A set whose audio sits on the startup disk still converts, and Live 10 asks you to locate the audio once.",
      live11:
        "Live 11 sets are not converted. That version has never been measured against a real file, and a guess here produces a set that opens and then crashes.",
      /** RICH */
      windows:
        "No Windows-authored set has been checked. If you have one that misbehaves, an [issue with the file attached](issues) is the most useful report there is.",
      original: "Always keep your original file. This page never overwrites it.",
    },
  },

  footer: {
    /** RICH. `version` is the library version and commit. */
    license: (version: string) =>
      `~ableton-als~ ${version} is MIT licensed and open source. ~Ableton®~ and ~Live™~ are trademarks of Ableton AG. This project is unofficial, unaffiliated with and unendorsed by Ableton AG.`,
    privacy: "No analytics, no cookies, no third-party requests.",
  },

  /** What the worker is doing, shown while it works. */
  phases: {
    reading_file: "Reading the file…",
    building_sample: "Building the sample set…",
    decompressing: "Decompressing…",
    reading_structure: "Reading tracks, scenes and clips…",
    listing_files: "Listing referenced files…",
    validating: "Checking the structure Live depends on…",
    diagnosing: "Looking for repairs…",
    converting: "Converting to the Live 10 format…",
    repairing: "Applying the repair…",
    compressing: "Compressing…",
  } satisfies Record<Phase, string>,

  errors: {
    open: {
      empty_file:
        "That file is empty. Pick the .als file inside your project folder.",
      not_gzip:
        "That does not look like a Live Set. An .als file is gzip-compressed XML. Check that you picked the .als itself and not a project folder, an .alp pack or an audio file.",
      corrupt_gzip:
        "The file starts like a Live Set but could not be decompressed, so it is probably truncated. Copy it again from the original disk and retry.",
      not_a_live_set:
        "The file opened, but there is no Live document inside. It may come from another program.",
      too_large: `This set is larger than a browser tab handles well. Use the library from Node instead: ${USE_NODE}.`,
      crashed:
        "Something went wrong while working on the file, most likely the tab ran out of memory. Reload the page and try again, or use the library from Node for a set this size.",
    } satisfies Record<OpenError | "crashed", string>,
    unsupportedBrowser: `This browser lacks the Compression Streams API this page needs. Use a current Chrome, Edge, Firefox or Safari, or use the library from Node: ${USE_NODE}.`,
  },

  /** Why a repair cannot run on this set. */
  blocked: {
    unsupported_version: (version: number | string) =>
      `This tool does not run on Live ${version} files.`,
    untested_version: (version: number | string) =>
      `Live ${version} files have not been verified yet, so no fix runs on them.`,
    colliding_pointee_ids: (ids: string) =>
      `Automation points at a duplicated Id (${ids}), so renumbering would attach it to the wrong occurrence.`,
    mixed_clip_durations: (scenes: number) =>
      `${count(scenes, "scene has", "scenes have")} clips with different durations, and without one duration per row there is no way to tell when to jump.`,
    needs_two_tracks: "The file does not have two tracks with clips.",
  },

  /** Why an action was refused. The set is unchanged. */
  refusals: {
    nothing_to_change: "Nothing to change: the set already agrees.",
    already_v10: "This set is already in the Live 10 format.",
    unverified_version: (version: number) =>
      `Live ${version} sets have never been measured against a real file, so this page does not convert them.`,
    invalid_bpm: "Enter a target BPM above zero.",
    no_warped_clips: "This set has no warped audio clips to rescale.",
    same_track: "Pick two different tracks.",
    track_without_clips: (track: string) =>
      `Track ${track} has no clips. Pick a track that has some.`,
    relative_library_root:
      "Enter the absolute path of the library folder, starting with /",
    relink_unresolved: (files: number, folder: string) =>
      `No reference could be re-rooted. The document does not say where ${count(files, "file sits", "files sit")} inside a folder named "${folder}".`,
    relink_already_there: "Every reference already points inside that folder.",
    /** `detail` is the library's own English prose: it gave no code. */
    library_error: (detail: string) => `The library refused this change: ${detail}`,
  },

  /** Why the result is not offered as a file. */
  output: {
    unchanged: "Nothing has been changed yet.",
    damaged:
      "This set was damaged on purpose to show what validation catches. Live would refuse it, so no file is offered from it. Open the healthy sample or your own .als to download one.",
    invalid: (problems: number) =>
      `The converted set has ${count(problems, "validation problem", "validation problems")}. Live 10 would refuse it or crash loading it, so it is not offered for download.`,
  },

  announce: {
    opened: (name: string) => `Opened ${name}`,
    updated: "Done. The set was updated.",
    saved: (name: string) => `Saved ${name}`,
    codeCopied: "Code copied",
    copyBlocked: "Copy was blocked. Select the code and copy it.",
  },

  fileBar: {
    damagedSample: "Damaged on purpose",
    unknownVersion: "Unknown version",
    noProblems: "No structural problems",
    download: "Download",
    openAnother: "Open another file",
    close: "Close",
    dismiss: "Dismiss",
    localOnly:
      "This set is being read on this computer only. Nothing has been uploaded.",
  },

  steps: {
    title: "Changes so far",
    converted: "Converted to Live 10",
    undo: "Undo last",
    reset: "Back to the original",
  },

  tabs: {
    label: "Views",
    inspect: "Inspect",
    validate: "Validate",
    convert: "Convert",
    repair: "Repair",
  },

  code: {
    panelLabel: "Code for this view",
    title: "The same thing in code",
    runtime: "Runtime",
    browser: "Browser",
    node: "Node",
    copy: "Copy",
    copied: "Copied",
    selectAndCopy: "Select and copy",
    worksWith: (version: string) =>
      `Works with version ${version} as published. Zero dependencies.`,
  },

  inspect: {
    facts: {
      savedBy: "Saved by",
      unknown: "unknown",
      schema: "Schema",
      transportTempo: "Transport tempo",
      transportNote: "Where the transport was left, not always the song's tempo",
      timeSignature: "Time signature",
      tracks: "Tracks",
      scenes: "Scenes",
      clips: "Clips",
      clipsNote: (audio: number, midi: number) =>
        `${number(audio)} audio, ${number(midi)} MIDI`,
      referencedFiles: "Referenced files",
      audioFiles: (total: number) => `${number(total)} audio`,
      size: "Size",
      xmlInside: (size: number) => `${bytes(size)} of XML inside`,
    },
    trackKinds: {
      AudioTrack: "Audio",
      MidiTrack: "MIDI",
      ReturnTrack: "Return",
      GroupTrack: "Group",
    },
    session: {
      title: "Session",
      note: "Tracks across, scenes down. Each clip is painted with the colour index stored in the file.",
      gridLabel: "Session grid",
      sceneColumn: "Scene",
      missingSlots: (track: string, slots: number, scenes: number) =>
        `${track} has ${count(slots, "slot", "slots")} for ${count(scenes, "scene", "scenes")}`,
      clipLabel: (track: string, scene: number, clip: string) =>
        `${track}, scene ${scene}: ${clip}`,
      unnamedClip: "unnamed clip",
      showAll: (scenes: number) => `Show all ${number(scenes)} scenes`,
    },
    clip: {
      select:
        "Select a clip to see what the file says about it. Striped clips are MIDI.",
      clip: "Clip",
      track: "Track",
      scene: "Scene",
      kind: "Kind",
      audio: "Audio",
      midi: "MIDI",
      warpedAt: "Warped at",
      timeSignature: "Time signature",
      loopLength: "Loop length",
      beats: (total: number) => count(total, "beat", "beats"),
      file: "File",
    },
    files: {
      title: "Referenced files",
      none: "This set references no files.",
      file: "File",
      folder: "Folder",
      uses: "Uses",
      aliasRecord: "Alias record",
      aliasOnConversion: "Alias on conversion",
      notAudio: "Not audio",
      present: "Present",
      missing: "Missing",
      canBeBuilt: "Can be built",
      notUnderVolumes: "Not under /Volumes/",
      showAll: (files: number) => `Show all ${number(files)} files`,
    },
  },

  validate: {
    none: "No structural problems found in this set.",
    found: (problems: number) =>
      `${count(problems, "problem", "problems")} found. Each one would make Live refuse the set or crash while loading it.`,
    check: "Check",
    looksFor: "What it looks for",
    result: "Result",
    passed: "Passed",
    rules: {
      grid: {
        name: "Scene and track grid",
        checks:
          "Every clip slot list, freeze lists included, holds exactly one slot per scene. A mismatch crashes Live while the set loads.",
      },
      ids: {
        name: "Ids and automation targets",
        checks:
          "Clip automation points at a target that exists, and the Id allocator sits above every Id already used.",
      },
      xml: {
        name: "Document structure",
        checks:
          "Tags open and close in order, and no element Live expects once per parent appears twice.",
      },
      routing: {
        name: "Routing",
        checks:
          "Every track that routes into another track points at one that exists.",
      },
    },
    problemsTitle: "Problems",
    codesNote:
      "The code and its values are stable and meant for your own wording or language. The sentence is this page's wording of them, in the language you picked.",
    cannotProve:
      "These checks catch damage Live refuses or crashes on. They cannot prove Live opens the set: a wrong value in a field Live knows passes every structural check.",
  },

  convert: {
    intro:
      "Live has no downgrade path: a set saved in Live 12 will not open in Live 10. This rebuilds the document the older version expects and leaves everything it does not need to touch byte for byte as it was.",
    libraryFolder: "Library folder",
    libraryHint:
      "The folder your audio lives under, read from the set. Audio outside it converts too and is listed as a warning.",
    button: "Convert to Live 10",
    does: {
      title: "What the conversion does",
      tempo:
        "Moves each scene's tempo and time signature back into the scene name, the only place Live 10 reads them from.",
      colours:
        "Re-encodes track and scene colours. Both versions share one palette of 70 colours and store its indices differently.",
      samples:
        "Rewrites every sample reference and builds the macOS alias record Live 10 uses to find the audio.",
      elements:
        "Removes the elements Live 10 does not know and restores the ones it needs, then validates the result before offering it.",
    },
    nothingToConvert: "Nothing to convert",
    alreadyV10: (creator: string) =>
      `This set was saved by ${creator}. Live 10 opens it as it is, and newer versions migrate it forward on their own.`,
    /** Stands in for the creator when the file does not state one. */
    live10OrOlder: "Live 10 or older",
    notConverted: "Not converted",
    unverified:
      "This set was saved by Live 11, and this conversion has only been measured on Live 12 sets. A guess here produces a file that passes every check and then crashes Live 10 with no message, so the page declines.",
    /** RICH */
    shareLive11:
      "If you can share a Live 11 set, [open an issue with the file attached](issues). That is the measurement the project is missing.",
    result: {
      converted: "Converted",
      convertedUnsafe: "Converted, but not safe to open",
      summary: (scenes: number, warnings: number, problems: number) =>
        `${count(scenes, "scene", "scenes")} rewritten, ${count(warnings, "warning", "warnings")}, ${count(problems, "validation problem", "validation problems")}.`,
      download: "Download the Live 10 set",
      /** `name` is the file name, shown in the middle of the sentence. */
      savedAs: (name: string) =>
        `Saved as ${name}, never over your original. Open the result in Live 10 and check it before you rely on it.`,
      problemsTitle: "Validation problems in the result",
      warningsTitle: "Warnings",
      warningsNote:
        "What Live 10 has no way to store, or what the page could not work out.",
      audioTitle: "Audio references",
      noAudio: "This set references no audio files.",
      aliasWritten: (withRecord: number, audioRefs: number) =>
        `An alias record was written for ${number(withRecord)} of ${count(audioRefs, "audio reference", "audio references")}. Live 10 finds audio by that record, not by the path next to it.`,
      offVolume: (refs: number) =>
        `${count(refs, "reference is", "references are")} not under /Volumes/, and the record for the startup disk has never been measured, so none was written. Live 10 will ask you to locate ${pick(refs, "that file", "those files")} once.`,
      changedTitle: "What changed",
      elementsTitle: "Elements added and removed",
      elementsNote:
        "Live 10 refuses elements it does not know and crashes without some that Live 12 stopped writing. Counted across the whole document.",
      element: "Element",
      inV12: "In the Live 12 set",
      inV10: "In the Live 10 set",
      moreElements: (names: number) =>
        `And ${number(names)} more element ${pick(names, "name", "names")} whose count changed.`,
      before: "Before, as Live 12 wrote it",
      after: "After, as Live 10 expects it",
    },
    excerpts: {
      header: "Document header",
      scene: (scene: number) => `Scene ${scene}`,
      firstAudioRef: "First audio reference",
      /** Follows a hex payload that was cut short. */
      hexChars: (total: number) => `(${number(total)} hex chars)`,
      /** Closes an excerpt that was cut short. */
      moreLines: (lines: number) =>
        `${number(lines)} more ${pick(lines, "line", "lines")}`,
    },
    cannot: {
      title: "What a conversion cannot bring back",
      jump: "Follow action Jump exists from Live 11 on. Clips using it are set to no action, with a warning.",
      folderRef:
        "A reference that pointed at a folder arrives from Live 12 empty. There is nothing to rebuild it from.",
      longFolder:
        "A folder name longer than 31 characters is written in full inside the alias record, where Live would shorten it. Sets built this way opened in Live 10 with every clip loaded.",
      sceneColours:
        "Scene colours follow the measured track mapping. A coloured scene was never measured directly.",
    },
  },

  repair: {
    intro:
      "Each repair reads the set first and says what it would change. Nothing is applied until you ask, repairs stack on the same file, and the last one can be undone.",
    tools: {
      pointeeIds: {
        title: TOOL_TITLES.pointeeIds,
        about:
          "Two automation or modulation targets sharing one Id make Live 12 refuse the set. This renumbers the extra occurrences and moves the Id allocator past them.",
        button: "Renumber duplicates",
      },
      rewarp: {
        title: TOOL_TITLES.rewarp,
        about:
          "Changing a clip's BPM in Live moves its warp marker and leaves the loop windows in the old beat scale, so the clip drifts. This rescales every beat value of every audio clip to the tempo you give. Follow times are a scene length and are left alone, so run the follow action repair after this one.",
        button: "Rescale clips",
      },
      followActions: {
        title: TOOL_TITLES.followActions,
        about:
          "Enables each clip's follow action, unlinks it from the clip length, and sets its time to the real length of its scene.",
        button: "Sync follow actions",
      },
      mirrorTrack: {
        title: TOOL_TITLES.mirrorTrack,
        about:
          "Copies loop windows, warp markers and follow times from one track onto another, scene by scene. Each track keeps its own audio.",
        button: "Copy geometry",
      },
      relinkSamples: {
        title: TOOL_TITLES.relinkSamples,
        about:
          "A set put together on another computer carries that computer's paths, and every clip opens missing. This re-roots each reference at your copy of the library and rebuilds its alias record.",
        button: "Relink samples",
      },
    },
    status: {
      notAvailable: "Not available",
      toFix: (pending: number) => `${number(pending)} to fix`,
      onRequest: "On request",
      nothingToFix: "Nothing to fix",
    },
    targetBpm: "Target BPM",
    copyFrom: "Copy from",
    onto: "Onto",
    pickTwo: "Pick two different tracks.",
    mirrorPreview: (shared: number, differing: number, oneSided: number) =>
      `${count(shared, "scene has", "scenes have")} a clip on both tracks, and ${number(differing)} of them ${pick(differing, "differs", "differ")}. ${number(oneSided)} with a clip on one side only ${pick(oneSided, "is", "are")} left alone.`,
    relinkLabel: "Where the library is on this machine",
    relinkHint:
      "The folder must have the same name it had on the machine that saved the set. Everything inside keeps its place.",
    convertFirst:
      "Convert the set to Live 10 first: the conversion writes these references.",
    applied: "Applied",
    /** What a repair changed, said from the count the library returns. */
    done: {
      pointeeIds: (ids: number) => `${count(ids, "Id", "Ids")} renumbered.`,
      rewarp: (clips: number) => `${count(clips, "clip", "clips")} rescaled.`,
      followActions: (clips: number) =>
        `${count(clips, "clip", "clips")} synced.`,
      mirrorTrack: (clips: number) =>
        `${count(clips, "clip", "clips")} aligned.`,
      relinkSamples: (refs: number) =>
        `${count(refs, "reference", "references")} re-rooted.`,
      leftAlone: (refs: number) =>
        `${count(refs, "reference was", "references were")} left as ${pick(refs, "it was", "they were")}.`,
    },
    what: "What",
    before: "Before",
    after: "After",
    /** Follows the BPM list when it was cut short: "+3 more". */
    moreBpms: (more: number) => `+${number(more)} more`,
  },

  /** Row labels of the before and after tables, and of each repair's facts. */
  labels: {
    automationTargets: "Automation targets",
    duplicatedIds: "Duplicated Ids",
    extraOccurrences: "Extra occurrences",
    audioClips: "Audio clips",
    clipsWarpedAt: "Clips warped at",
    gridBpm: "Grid BPM",
    masterBpm: "Master BPM",
    clips: "Clips",
    needEnable: "Need enabling",
    needUnlink: "Need unlinking",
    needRetime: "Need retiming",
    tracksWithClips: "Tracks with clips",
    sharedScenes: "Scenes both tracks share",
    differingScenes: "Scenes that differ",
    firstAudioRef: "First audio reference",
    refsWithAlias: "References with an alias record",
    audioRefsWithAlias: "Audio references with an alias record",
    savedBy: "Saved by",
    schema: "Schema",
    sceneName: (scene: number) => `Scene ${scene} name`,
    trackColor: (track: string) => `Colour of track ${track}`,
  },

  /** The library's validation problems and conversion warnings, by code. */
  messages,
}

export type Catalog = typeof en
