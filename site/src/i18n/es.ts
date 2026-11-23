// Spanish, neutral Latin American, addressed as "tú". Typed as `Catalog`: a
// key missing here, or one with a different shape from `en.ts`, does not
// compile. The conventions are in the header of `en.ts`.
//
// Live's own nouns stay in English (Session, scene, clip, track, warp, follow
// action, Live Set, beat, MIDI, BPM), with these genders: el track, la scene,
// el clip, la follow action.

import type { Wording } from "../messages.js"
import type { Catalog } from "./en.js"
import { formatter } from "./format.js"

const { number, count, pick, bytes } = formatter("es")

const TOOL_TITLES = {
  pointeeIds: "Ids de automatización duplicados",
  rewarp: "Clips con warp en el tempo equivocado",
  followActions: "Follow actions desfasadas",
  mirrorTrack: "Copiar la geometría de clips entre tracks",
  relinkSamples: "Samples que apuntan a otra máquina",
}

const USE_NODE = "npm install ableton-als"

const messages: Wording = {
  orphan_pointee: ({ ids }) =>
    `La automatización de clip apunta al Id de destino ${ids}, que no existe en este set. Live se cierra al resolver esa referencia mientras carga el set.`,
  duplicate_pointee_ids: ({ count: total, ids }) =>
    `${count(total, "Id de destino de automatización se usa", "Ids de destino de automatización se usan")} más de una vez: ${ids}. Live 11 y las versiones posteriores rechazan un set con Ids repetidos. La reparación "${TOOL_TITLES.pointeeIds}" lo corrige.`,
  grid_slot_count: ({ list, track, slots, scenes }) =>
    `La lista de clip slots ${list}, ${track === "" ? "en el track master" : `en el track ${track}`}, tiene ${count(slots, "slot", "slots")} para ${count(scenes, "scene", "scenes")}. Cada lista necesita exactamente un slot por scene.`,
  grid_group_slot_count: ({ group, slots, scenes }) =>
    `El group track ${group} tiene ${count(slots, "slot propio", "slots propios")} para ${count(scenes, "scene", "scenes")}. Live se cierra al abrir un set así.`,
  xml_mismatched_close: ({ closing, open, offset }) =>
    `La etiqueta de cierre ${closing}, en el carácter ${number(offset)}, no coincide con la etiqueta abierta ${open}.`,
  xml_unclosed: ({ tags }) =>
    `Estas etiquetas siguen abiertas al final del documento: ${tags}.`,
  xml_duplicate_singleton: ({ element, parent, offset }) =>
    `${element} aparece dos veces dentro de un mismo ${parent}, en el carácter ${number(offset)}. Live rechaza un set que escribe el mismo miembro dos veces.`,
  next_pointee_missing: () =>
    "El set no tiene NextPointeeId, el contador del que sale cada Id nuevo.",
  next_pointee_too_low: ({ declared, max }) =>
    `NextPointeeId es ${declared}, pero el Id más alto ya en uso es ${max}. Live entregaría un Id que ya está ocupado.`,
  routing_orphan_tracks: ({ ids }) =>
    `Un track envía su salida al track de Id ${ids}, que no existe en este set.`,
  jump_follow_action: () =>
    "Un clip usa la follow action Jump, que Live 10 no tiene. Se cambió a ninguna acción y hay que rehacerla a mano.",
  samples_outside_root: ({ count: total, sample }) =>
    `${count(total, "archivo de audio está", "archivos de audio están")} fuera de la carpeta de la biblioteca: ${sample}. ${pick(total, "Se convirtió", "Se convirtieron")} con la ruta completa.`,
}

export const es: Catalog = {
  meta: {
    title:
      "Demo de ableton-als: inspecciona, repara y convierte archivos .als en tu navegador",
    description:
      "Suelta un Live Set (.als) para ver sus tracks, scenes y clips, buscar los daños que hacen que Live se cierre, repararlo y convertir un set de Live 12 a Live 10. Funciona por completo en tu navegador: el archivo nunca sale de tu computadora.",
  },

  header: {
    demo: "demo",
    projectLinks: "Enlaces del proyecto",
    language: "Idioma",
    toLight: "Cambiar al tema claro",
    toDark: "Cambiar al tema oscuro",
  },

  common: {
    tracks: (total) => count(total, "track", "tracks"),
    scenes: (total) => count(total, "scene", "scenes"),
    clips: (total) => count(total, "clip", "clips"),
    problems: (total) => count(total, "problema", "problemas"),
    number: (value) => number(value, 3),
    bpm: (value) => `${number(value)} BPM`,
    unnamed: "(sin nombre)",
    notStated: "no indicado",
    none: "ninguno",
    partOfTotal: (part, total) => `${number(part)} de ${number(total)}`,
  },

  landing: {
    title:
      "Inspecciona, repara y convierte Live Sets, aquí mismo en esta pestaña.",
    lead: "Suelta un archivo `.als` para ver sus tracks, scenes y clips, buscar los daños que hacen que Live lo rechace o se cierre, corregirlo y convertir un set de Live 12 en uno que Live 10 pueda abrir.",
    dropTitle: "Suelta un archivo ~.als~ en cualquier parte de esta página",
    chooseFile: "Elegir un archivo",
    openSample: "Abrir el set de ejemplo",
    openDamaged: "Abrir uno dañado",
    privacy:
      "**Tu archivo nunca sale de esta computadora.** Esta página no tiene servidor, y su política de seguridad prohíbe toda solicitud de red, así que no podría subir un set aunque lo intentara. [Cómo comprobarlo tú mismo.](verify)",
    previewLabel: "El set de ejemplo tal como lo lee esta página",
    previewCaption:
      "El set de ejemplo: guardado por Live 12 para esta página. Su audio son tonos sintetizados y no está incluido.",
    previewCaptionCounted: (tracks, scenes, clips) =>
      `El set de ejemplo tal como lo lee esta página: ${count(tracks, "track", "tracks")}, ${count(scenes, "scene", "scenes")}, ${count(clips, "clip", "clips")}. Fue guardado por Live 12 para esta página. Su audio son tonos sintetizados y no está incluido.`,
    dropVeil: "Suelta el archivo para abrirlo",
  },

  about: {
    does: {
      title: "Qué hace esta página",
      inspect:
        "La versión de Live que guardó el set, su tempo, sus tracks, scenes y clips con los colores guardados en el archivo, y cada archivo de audio al que hace referencia.",
      validate:
        "Las reglas de estructura de las que depende Live: un clip slot por scene en cada track, automatización que apunta a un destino que existe, rutas que llevan a un track que existe. Cada problema viene con un código estable y sus valores.",
      convert:
        "De Live 12 a Live 10. Live no tiene una vía de downgrade, así que la página reconstruye el archivo que espera la versión anterior, incluidos los alias records con los que Live 10 encuentra el audio.",
      repair:
        "Ids de automatización duplicados, clips con warp en el tempo equivocado, follow actions desfasadas, geometría de clip distinta entre tracks y samples que apuntan a otra máquina.",
      code: "Cada acción muestra el código que hace lo mismo con la biblioteca [ableton-als](repo), para el navegador y para Node.",
    },
    verify: {
      title: "Comprueba la afirmación de privacidad",
      network:
        "Abre las herramientas para desarrolladores de tu navegador en la pestaña Network (Red), luego abre un set y conviértelo. No aparece ninguna solicitud.",
      offline:
        "Carga esta página, apaga el Wi-Fi y úsala. Todo sigue funcionando.",
      source:
        "Mira el código fuente de la página. La etiqueta `Content-Security-Policy` al principio lleva `connect-src 'none'`, que hace que el propio navegador rechace cualquier subida.",
    },
    measured: {
      title: "Qué se midió y qué no",
      versions:
        "La conversión se midió con sets escritos por Live 10.1.43 y Live 12.4.3 en macOS. Un set convertido de 561 scenes se abrió en Live 10 sin archivos faltantes.",
      aliases:
        "Los alias records solo se construyen para audio que está en `/Volumes/`. Un set con el audio en el disco de arranque también se convierte, y Live 10 te pide ubicar el audio una vez.",
      live11:
        "Los sets de Live 11 no se convierten. Esa versión nunca se midió con un archivo real, y una suposición aquí produce un set que se abre y luego hace que Live se cierre.",
      windows:
        "No se ha comprobado ningún set creado en Windows. Si tienes uno que se comporta mal, una [issue con el archivo adjunto](issues) es el reporte más útil que existe.",
      original:
        "Conserva siempre tu archivo original. Esta página nunca lo sobrescribe.",
    },
  },

  footer: {
    license: (version) =>
      `~ableton-als~ ${version} tiene licencia MIT y es de código abierto. ~Ableton®~ y ~Live™~ son marcas comerciales de Ableton AG. Este proyecto no es oficial, no está afiliado a Ableton AG ni cuenta con su respaldo.`,
    privacy: "Sin analíticas, sin cookies, sin solicitudes a terceros.",
  },

  phases: {
    reading_file: "Leyendo el archivo…",
    building_sample: "Armando el set de ejemplo…",
    decompressing: "Descomprimiendo…",
    reading_structure: "Leyendo tracks, scenes y clips…",
    listing_files: "Listando los archivos referenciados…",
    validating: "Revisando la estructura de la que depende Live…",
    diagnosing: "Buscando reparaciones…",
    converting: "Convirtiendo al formato de Live 10…",
    repairing: "Aplicando la reparación…",
    compressing: "Comprimiendo…",
  },

  errors: {
    open: {
      empty_file:
        "Ese archivo está vacío. Elige el archivo .als que está dentro de la carpeta de tu proyecto.",
      not_gzip:
        "Eso no parece un Live Set. Un archivo .als es XML comprimido con gzip. Revisa que hayas elegido el propio .als y no la carpeta del proyecto, un pack .alp o un archivo de audio.",
      corrupt_gzip:
        "El archivo empieza como un Live Set, pero no se pudo descomprimir, así que probablemente está truncado. Cópialo de nuevo desde el disco original y vuelve a intentarlo.",
      not_a_live_set:
        "El archivo se abrió, pero no contiene un documento de Live. Puede venir de otro programa.",
      too_large: `Este set es más grande de lo que una pestaña del navegador maneja bien. Usa la biblioteca desde Node: ${USE_NODE}.`,
      crashed:
        "Algo salió mal al trabajar con el archivo. Lo más probable es que la pestaña se haya quedado sin memoria. Recarga la página e inténtalo de nuevo, o usa la biblioteca desde Node para un set de este tamaño.",
    },
    unsupportedBrowser: `Este navegador no tiene la API Compression Streams que esta página necesita. Usa una versión actual de Chrome, Edge, Firefox o Safari, o usa la biblioteca desde Node: ${USE_NODE}.`,
  },

  blocked: {
    unsupported_version: (version) =>
      `Esta herramienta no funciona con archivos de Live ${version}.`,
    untested_version: (version) =>
      `Los archivos de Live ${version} todavía no se han verificado, así que ninguna corrección funciona con ellos.`,
    colliding_pointee_ids: (ids) =>
      `La automatización apunta a un Id duplicado (${ids}), así que renumerar la uniría a la aparición equivocada.`,
    mixed_clip_durations: (scenes) =>
      `${count(scenes, "scene tiene", "scenes tienen")} clips con duraciones distintas, y sin una sola duración por fila no hay forma de saber cuándo saltar.`,
    needs_two_tracks: "El archivo no tiene dos tracks con clips.",
  },

  refusals: {
    nothing_to_change: "Nada que cambiar: el set ya coincide.",
    already_v10: "Este set ya está en el formato de Live 10.",
    unverified_version: (version) =>
      `Los sets de Live ${version} nunca se midieron con un archivo real, así que esta página no los convierte.`,
    invalid_bpm: "Escribe un BPM de destino mayor que cero.",
    no_warped_clips: "Este set no tiene clips de audio con warp para reescalar.",
    same_track: "Elige dos tracks distintos.",
    track_without_clips: (track) =>
      `El track ${track} no tiene clips. Elige un track que tenga.`,
    relative_library_root:
      "Escribe la ruta absoluta de la carpeta de la biblioteca, empezando con /",
    relink_unresolved: (files, folder) =>
      `No se pudo redirigir ninguna referencia. El documento no dice dónde ${pick(files, "queda", "quedan")} ${count(files, "archivo", "archivos")} dentro de una carpeta llamada "${folder}".`,
    relink_already_there:
      "Todas las referencias ya apuntan dentro de esa carpeta.",
    library_error: (detail) => `La biblioteca rechazó este cambio: ${detail}`,
  },

  output: {
    unchanged: "Todavía no se ha cambiado nada.",
    damaged:
      "Este set fue dañado a propósito para mostrar lo que detecta la validación. Live lo rechazaría, así que no se ofrece ningún archivo a partir de él. Abre el ejemplo sano o tu propio .als para descargar uno.",
    invalid: (problems) =>
      `El set convertido tiene ${count(problems, "problema de validación", "problemas de validación")}. Live 10 lo rechazaría o se cerraría al cargarlo, así que no se ofrece para descargar.`,
  },

  announce: {
    opened: (name) => `Archivo abierto: ${name}`,
    updated: "Listo. El set se actualizó.",
    saved: (name) => `Archivo guardado: ${name}`,
    codeCopied: "Código copiado",
    copyBlocked: "La copia fue bloqueada. Selecciona el código y cópialo.",
  },

  fileBar: {
    damagedSample: "Dañado a propósito",
    unknownVersion: "Versión desconocida",
    noProblems: "Sin problemas de estructura",
    download: "Descargar",
    openAnother: "Abrir otro archivo",
    close: "Cerrar",
    dismiss: "Descartar",
    localOnly:
      "Este set se está leyendo solo en esta computadora. No se ha subido nada.",
  },

  steps: {
    title: "Cambios hasta ahora",
    converted: "Convertido a Live 10",
    undo: "Deshacer el último",
    reset: "Volver al original",
  },

  tabs: {
    label: "Vistas",
    inspect: "Inspeccionar",
    validate: "Validar",
    convert: "Convertir",
    repair: "Reparar",
  },

  code: {
    panelLabel: "Código de esta vista",
    title: "Lo mismo en código",
    runtime: "Entorno",
    browser: "Navegador",
    node: "Node",
    copy: "Copiar",
    copied: "Copiado",
    selectAndCopy: "Selecciona y copia",
    worksWith: (version) =>
      `Funciona con la versión ${version} tal como está publicada. Cero dependencias.`,
  },

  inspect: {
    facts: {
      savedBy: "Guardado por",
      unknown: "desconocido",
      schema: "Esquema",
      transportTempo: "Tempo del transporte",
      transportNote:
        "Donde quedó el transporte, que no siempre es el tempo de la canción",
      timeSignature: "Compás",
      tracks: "Tracks",
      scenes: "Scenes",
      clips: "Clips",
      clipsNote: (audio, midi) =>
        `${number(audio)} de audio, ${number(midi)} MIDI`,
      referencedFiles: "Archivos referenciados",
      audioFiles: (total) => `${number(total)} de audio`,
      size: "Tamaño",
      xmlInside: (size) => `${bytes(size)} de XML en su interior`,
    },
    trackKinds: {
      AudioTrack: "Audio",
      MidiTrack: "MIDI",
      ReturnTrack: "Return",
      GroupTrack: "Group",
    },
    session: {
      title: "Session",
      note: "Tracks en horizontal, scenes en vertical. Cada clip se pinta con el índice de color guardado en el archivo.",
      gridLabel: "Cuadrícula de la Session",
      sceneColumn: "Scene",
      missingSlots: (track, slots, scenes) =>
        `${track} tiene ${count(slots, "slot", "slots")} para ${count(scenes, "scene", "scenes")}`,
      clipLabel: (track, scene, clip) => `${track}, scene ${scene}: ${clip}`,
      unnamedClip: "clip sin nombre",
      showAll: (scenes) => `Mostrar las ${number(scenes)} scenes`,
    },
    clip: {
      select:
        "Selecciona un clip para ver lo que el archivo dice de él. Los clips con rayas son MIDI.",
      clip: "Clip",
      track: "Track",
      scene: "Scene",
      kind: "Tipo",
      audio: "Audio",
      midi: "MIDI",
      warpedAt: "Warp a",
      timeSignature: "Compás",
      loopLength: "Duración del loop",
      beats: (total) => count(total, "beat", "beats"),
      file: "Archivo",
    },
    files: {
      title: "Archivos referenciados",
      none: "Este set no hace referencia a ningún archivo.",
      file: "Archivo",
      folder: "Carpeta",
      uses: "Usos",
      aliasRecord: "Alias record",
      aliasOnConversion: "Alias al convertir",
      notAudio: "No es audio",
      present: "Presente",
      missing: "Falta",
      canBeBuilt: "Se puede construir",
      notUnderVolumes: "Fuera de /Volumes/",
      showAll: (files) => `Mostrar los ${number(files)} archivos`,
    },
  },

  validate: {
    none: "No se encontraron problemas de estructura en este set.",
    found: (problems) =>
      `${count(problems, "problema encontrado", "problemas encontrados")}. Cada uno haría que Live rechace el set o se cierre al cargarlo.`,
    check: "Comprobación",
    looksFor: "Qué busca",
    result: "Resultado",
    passed: "Aprobada",
    rules: {
      grid: {
        name: "Cuadrícula de scenes y tracks",
        checks:
          "Cada lista de clip slots, incluidas las de freeze, tiene exactamente un slot por scene. Una diferencia hace que Live se cierre mientras carga el set.",
      },
      ids: {
        name: "Ids y destinos de automatización",
        checks:
          "La automatización de clip apunta a un destino que existe, y el asignador de Ids está por encima de todos los Ids ya usados.",
      },
      xml: {
        name: "Estructura del documento",
        checks:
          "Las etiquetas se abren y se cierran en orden, y ningún elemento que Live espera una sola vez por padre aparece dos veces.",
      },
      routing: {
        name: "Enrutamiento",
        checks:
          "Cada track que envía su señal a otro track apunta a uno que existe.",
      },
    },
    problemsTitle: "Problemas",
    codesNote:
      "El código y sus valores son estables y están pensados para que redactes el mensaje con tus palabras o en tu idioma. La frase es la redacción de esta página para ellos, en el idioma que elegiste.",
    cannotProve:
      "Estas comprobaciones detectan los daños que hacen que Live rechace el set o se cierre. No pueden probar que Live abre el set: un valor equivocado en un campo que Live conoce pasa todas las comprobaciones de estructura.",
  },

  convert: {
    intro:
      "Live no tiene una vía de downgrade: un set guardado en Live 12 no se abre en Live 10. Esto reconstruye el documento que espera la versión anterior y deja todo lo demás como estaba, byte por byte.",
    libraryFolder: "Carpeta de la biblioteca",
    libraryHint:
      "La carpeta donde está tu audio, leída del set. El audio que está fuera de ella también se convierte y aparece como advertencia.",
    button: "Convertir a Live 10",
    does: {
      title: "Qué hace la conversión",
      tempo:
        "Devuelve el tempo y el compás de cada scene al nombre de la scene, el único lugar de donde Live 10 los lee.",
      colours:
        "Recodifica los colores de tracks y scenes. Las dos versiones comparten una paleta de 70 colores y guardan sus índices de forma distinta.",
      samples:
        "Reescribe cada referencia de sample y construye el alias record de macOS que Live 10 usa para encontrar el audio.",
      elements:
        "Quita los elementos que Live 10 no conoce y restaura los que necesita, y luego valida el resultado antes de ofrecerlo.",
    },
    nothingToConvert: "Nada que convertir",
    alreadyV10: (creator) =>
      `Este set fue guardado por ${creator}. Live 10 lo abre tal como está, y las versiones más nuevas lo migran por su cuenta.`,
    live10OrOlder: "Live 10 o anterior",
    notConverted: "No convertido",
    unverified:
      "Este set fue guardado por Live 11, y esta conversión solo se ha medido con sets de Live 12. Una suposición aquí produce un archivo que pasa todas las comprobaciones y luego hace que Live 10 se cierre sin ningún mensaje, así que la página se niega a convertirlo.",
    shareLive11:
      "Si puedes compartir un set de Live 11, [abre una issue con el archivo adjunto](issues). Esa es la medición que le falta al proyecto.",
    result: {
      converted: "Convertido",
      convertedUnsafe: "Convertido, pero no es seguro abrirlo",
      summary: (scenes, warnings, problems) =>
        `${count(scenes, "scene reescrita", "scenes reescritas")}, ${count(warnings, "advertencia", "advertencias")}, ${count(problems, "problema de validación", "problemas de validación")}.`,
      download: "Descargar el set de Live 10",
      savedAs: (name) =>
        `Guardado como ${name}, nunca encima de tu original. Abre el resultado en Live 10 y revísalo antes de confiar en él.`,
      problemsTitle: "Problemas de validación en el resultado",
      warningsTitle: "Advertencias",
      warningsNote:
        "Lo que Live 10 no tiene cómo guardar, o lo que la página no pudo resolver.",
      audioTitle: "Referencias de audio",
      noAudio: "Este set no hace referencia a ningún archivo de audio.",
      aliasWritten: (withRecord, audioRefs) =>
        `Se escribió un alias record para ${number(withRecord)} de ${count(audioRefs, "referencia de audio", "referencias de audio")}. Live 10 encuentra el audio por ese registro, no por la ruta que está junto a él.`,
      offVolume: (refs) =>
        `${count(refs, "referencia está", "referencias están")} fuera de /Volumes/, y el registro para el disco de arranque nunca se midió, así que no se escribió ninguno. Live 10 te pedirá ubicar ${pick(refs, "ese archivo", "esos archivos")} una vez.`,
      changedTitle: "Qué cambió",
      elementsTitle: "Elementos agregados y quitados",
      elementsNote:
        "Live 10 rechaza los elementos que no conoce y se cierra si faltan algunos que Live 12 dejó de escribir. Contados en todo el documento.",
      element: "Elemento",
      inV12: "En el set de Live 12",
      inV10: "En el set de Live 10",
      moreElements: (names) =>
        `Y ${count(names, "nombre de elemento más cuyo conteo cambió", "nombres de elemento más cuyo conteo cambió")}.`,
      before: "Antes, como lo escribió Live 12",
      after: "Después, como lo espera Live 10",
    },
    excerpts: {
      header: "Encabezado del documento",
      scene: (scene) => `Scene ${scene}`,
      firstAudioRef: "Primera referencia de audio",
      hexChars: (total) => `(${number(total)} caracteres hex)`,
      moreLines: (lines) => count(lines, "línea más", "líneas más"),
    },
    cannot: {
      title: "Lo que una conversión no puede recuperar",
      jump: "La follow action Jump existe a partir de Live 11. Los clips que la usan quedan sin acción, con una advertencia.",
      folderRef:
        "Una referencia que apuntaba a una carpeta llega vacía desde Live 12. No hay de dónde reconstruirla.",
      longFolder:
        "Un nombre de carpeta de más de 31 caracteres se escribe completo dentro del alias record, donde Live lo acortaría. Los sets construidos así se abrieron en Live 10 con todos los clips cargados.",
      sceneColours:
        "Los colores de scene siguen el mapeo medido para tracks. Una scene con color nunca se midió directamente.",
    },
  },

  repair: {
    intro:
      "Cada reparación lee primero el set y dice qué cambiaría. Nada se aplica hasta que lo pidas, las reparaciones se acumulan sobre el mismo archivo y la última se puede deshacer.",
    tools: {
      pointeeIds: {
        title: TOOL_TITLES.pointeeIds,
        about:
          "Dos destinos de automatización o de modulación con el mismo Id hacen que Live 12 rechace el set. Esto renumera las apariciones sobrantes y mueve el asignador de Ids más allá de ellas.",
        button: "Renumerar duplicados",
      },
      rewarp: {
        title: TOOL_TITLES.rewarp,
        about:
          "Cambiar el BPM de un clip en Live mueve su warp marker y deja las ventanas de loop en la escala de beats anterior, así que el clip se desfasa. Esto reescala cada valor en beats de cada clip de audio al tempo que indiques. Los follow times son la duración de una scene y se dejan como están, así que ejecuta la reparación de follow actions después de esta.",
        button: "Reescalar clips",
      },
      followActions: {
        title: TOOL_TITLES.followActions,
        about:
          "Activa la follow action de cada clip, la desvincula de la duración del clip y ajusta su tiempo a la duración real de su scene.",
        button: "Sincronizar follow actions",
      },
      mirrorTrack: {
        title: TOOL_TITLES.mirrorTrack,
        about:
          "Copia ventanas de loop, warp markers y follow times de un track a otro, scene por scene. Cada track conserva su propio audio.",
        button: "Copiar geometría",
      },
      relinkSamples: {
        title: TOOL_TITLES.relinkSamples,
        about:
          "Un set armado en otra computadora lleva las rutas de esa computadora, y todos los clips se abren como faltantes. Esto redirige cada referencia a tu copia de la biblioteca y reconstruye su alias record.",
        button: "Reenlazar samples",
      },
    },
    status: {
      notAvailable: "No disponible",
      toFix: (pending) => `${number(pending)} por corregir`,
      onRequest: "A pedido",
      nothingToFix: "Nada que corregir",
    },
    targetBpm: "BPM de destino",
    copyFrom: "Copiar de",
    onto: "Hacia",
    pickTwo: "Elige dos tracks distintos.",
    mirrorPreview: (shared, differing, oneSided) =>
      `${count(shared, "scene tiene", "scenes tienen")} un clip en ambos tracks, y ${number(differing)} de ellas ${pick(differing, "difiere", "difieren")}. ${number(oneSided)} con un clip en un solo lado ${pick(oneSided, "se deja como está", "se dejan como están")}.`,
    relinkLabel: "Dónde está la biblioteca en esta máquina",
    relinkHint:
      "La carpeta debe tener el mismo nombre que tenía en la máquina que guardó el set. Todo lo que hay dentro conserva su lugar.",
    convertFirst:
      "Convierte primero el set a Live 10: la conversión es la que escribe estas referencias.",
    applied: "Aplicada",
    done: {
      pointeeIds: (ids) => `${count(ids, "Id renumerado", "Ids renumerados")}.`,
      rewarp: (clips) =>
        `${count(clips, "clip reescalado", "clips reescalados")}.`,
      followActions: (clips) =>
        `${count(clips, "clip sincronizado", "clips sincronizados")}.`,
      mirrorTrack: (clips) =>
        `${count(clips, "clip alineado", "clips alineados")}.`,
      relinkSamples: (refs) =>
        `${count(refs, "referencia redirigida", "referencias redirigidas")}.`,
      leftAlone: (refs) =>
        `${count(refs, "referencia quedó como estaba", "referencias quedaron como estaban")}.`,
    },
    what: "Qué",
    before: "Antes",
    after: "Después",
    moreBpms: (more) => `+${number(more)} más`,
  },

  labels: {
    automationTargets: "Destinos de automatización",
    duplicatedIds: "Ids duplicados",
    extraOccurrences: "Apariciones sobrantes",
    audioClips: "Clips de audio",
    clipsWarpedAt: "Clips con warp a",
    gridBpm: "BPM de la cuadrícula",
    masterBpm: "BPM del master",
    clips: "Clips",
    needEnable: "Falta activar",
    needUnlink: "Falta desvincular",
    needRetime: "Falta ajustar el tiempo",
    tracksWithClips: "Tracks con clips",
    sharedScenes: "Scenes que comparten ambos tracks",
    differingScenes: "Scenes que difieren",
    firstAudioRef: "Primera referencia de audio",
    refsWithAlias: "Referencias con alias record",
    audioRefsWithAlias: "Referencias de audio con alias record",
    savedBy: "Guardado por",
    schema: "Esquema",
    sceneName: (scene) => `Nombre de la scene ${scene}`,
    trackColor: (track) => `Color del track ${track}`,
  },

  messages,
}
