// Brazilian Portuguese. Typed as `Catalog`: a key missing here, or one with a
// different shape from `en.ts`, does not compile. The conventions are in the
// header of `en.ts`.
//
// Live's own nouns stay in English (Session, scene, clip, track, warp, follow
// action, Live Set, beat, MIDI, BPM), with the genders Brazilian producers
// give them: a track, a scene, o clip, a follow action.

import type { Wording } from "../messages.js"
import type { Catalog } from "./en.js"
import { formatter } from "./format.js"

const { number, count, pick, bytes } = formatter("pt-BR")

const TOOL_TITLES = {
  pointeeIds: "Ids de automação duplicados",
  rewarp: "Clips com warp no andamento errado",
  followActions: "Follow actions fora de sincronia",
  mirrorTrack: "Copiar a geometria de clips entre tracks",
  relinkSamples: "Samples que apontam para outra máquina",
}

const USE_NODE = "npm install ableton-als"

const messages: Wording = {
  orphan_pointee: ({ ids }) =>
    `A automação de clip aponta para o Id de alvo ${ids}, que não existe neste set. O Live fecha sozinho ao resolver essa referência enquanto o set carrega.`,
  duplicate_pointee_ids: ({ count: total, ids }) =>
    `${count(total, "Id de alvo de automação é usado", "Ids de alvo de automação são usados")} mais de uma vez: ${ids}. O Live 11 e as versões seguintes recusam um set com Ids repetidos. O reparo "${TOOL_TITLES.pointeeIds}" corrige isso.`,
  grid_slot_count: ({ list, track, slots, scenes }) =>
    `A lista de clip slots ${list}, ${track === "" ? "na track master" : `na track ${track}`}, tem ${count(slots, "slot", "slots")} para ${count(scenes, "scene", "scenes")}. Cada lista precisa de exatamente um slot por scene.`,
  grid_group_slot_count: ({ group, slots, scenes }) =>
    `A group track ${group} tem ${count(slots, "slot próprio", "slots próprios")} para ${count(scenes, "scene", "scenes")}. O Live fecha sozinho ao abrir um set assim.`,
  xml_mismatched_close: ({ closing, open, offset }) =>
    `A tag de fechamento ${closing}, no caractere ${number(offset)}, não corresponde à tag aberta ${open}.`,
  xml_unclosed: ({ tags }) =>
    `Estas tags continuam abertas no fim do documento: ${tags}.`,
  xml_duplicate_singleton: ({ element, parent, offset }) =>
    `${element} aparece duas vezes dentro de um mesmo ${parent}, no caractere ${number(offset)}. O Live recusa um set que escreve o mesmo membro duas vezes.`,
  next_pointee_missing: () =>
    "O set não tem NextPointeeId, o contador de onde sai cada Id novo.",
  next_pointee_too_low: ({ declared, max }) =>
    `NextPointeeId é ${declared}, mas o maior Id já em uso é ${max}. O Live entregaria um Id que já está ocupado.`,
  routing_orphan_tracks: ({ ids }) =>
    `Uma track envia a saída para a track de Id ${ids}, que não existe neste set.`,
  jump_follow_action: () =>
    "Um clip usa a follow action Jump, que o Live 10 não tem. Ela foi trocada por nenhuma ação e precisa ser refeita à mão.",
  samples_outside_root: ({ count: total, sample }) =>
    `${count(total, "arquivo de áudio fica", "arquivos de áudio ficam")} fora da pasta da biblioteca: ${sample}. ${pick(total, "Ele foi convertido", "Eles foram convertidos")} com o caminho completo.`,
}

export const ptBR: Catalog = {
  meta: {
    title:
      "Demo do ableton-als: inspecione, repare e converta arquivos .als no navegador",
    description:
      "Solte um Live Set (.als) para ver tracks, scenes e clips, procurar os danos que derrubam o Live, reparar o arquivo e converter um set do Live 12 para o Live 10. Roda inteiro no navegador: o arquivo nunca sai do seu computador.",
  },

  header: {
    demo: "demo",
    projectLinks: "Links do projeto",
    language: "Idioma",
    toLight: "Mudar para o tema claro",
    toDark: "Mudar para o tema escuro",
  },

  common: {
    tracks: (total) => count(total, "track", "tracks"),
    scenes: (total) => count(total, "scene", "scenes"),
    clips: (total) => count(total, "clip", "clips"),
    problems: (total) => count(total, "problema", "problemas"),
    number: (value) => number(value, 3),
    bpm: (value) => `${number(value)} BPM`,
    unnamed: "(sem nome)",
    notStated: "não informado",
    none: "nenhum",
    partOfTotal: (part, total) => `${number(part)} de ${number(total)}`,
  },

  landing: {
    title: "Inspecione, repare e converta Live Sets, direto nesta aba.",
    lead: "Solte um arquivo `.als` para ver tracks, scenes e clips, procurar os danos que fazem o Live recusar o arquivo ou fechar sozinho, corrigir o que aparecer e transformar um set do Live 12 em um set que o Live 10 abre.",
    dropTitle: "Solte um arquivo ~.als~ em qualquer lugar desta página",
    chooseFile: "Escolher um arquivo",
    openSample: "Abrir o set de exemplo",
    openDamaged: "Abrir um set danificado",
    privacy:
      "**Seu arquivo nunca sai deste computador.** Esta página não tem servidor, e a política de segurança dela proíbe qualquer requisição de rede, então ela não conseguiria enviar um set nem se tentasse. [Como conferir isso você mesmo.](verify)",
    previewLabel: "O set de exemplo como esta página o lê",
    previewCaption:
      "O set de exemplo: salvo pelo Live 12 para esta página. O áudio dele são tons sintetizados e não vem junto.",
    previewCaptionCounted: (tracks, scenes, clips) =>
      `O set de exemplo como esta página o lê: ${count(tracks, "track", "tracks")}, ${count(scenes, "scene", "scenes")}, ${count(clips, "clip", "clips")}. Ele foi salvo pelo Live 12 para esta página. O áudio dele são tons sintetizados e não vem junto.`,
    dropVeil: "Solte o arquivo para abrir",
  },

  about: {
    does: {
      title: "O que esta página faz",
      inspect:
        "A versão do Live que salvou o set, o andamento, as tracks, scenes e clips com as cores gravadas no arquivo, e cada arquivo de áudio que ele referencia.",
      validate:
        "As regras de estrutura de que o Live depende: um clip slot por scene em cada track, automação que aponta para um alvo que existe, rotas que levam a uma track que existe. Cada problema vem com um código estável e os valores dele.",
      convert:
        "Do Live 12 para o Live 10. O Live não tem caminho de downgrade, então a página reconstrói o arquivo que a versão antiga espera, incluindo os alias records que o Live 10 usa para achar o áudio.",
      repair:
        "Ids de automação duplicados, clips com warp no andamento errado, follow actions fora de sincronia, geometria de clip diferente entre tracks e samples que apontam para outra máquina.",
      code: "Cada ação mostra o código que faz a mesma coisa com a biblioteca [ableton-als](repo), para o navegador e para o Node.",
    },
    verify: {
      title: "Confira a afirmação de privacidade",
      network:
        "Abra as ferramentas de desenvolvedor do navegador na aba Network (Rede), depois abra um set e converta. Nenhuma requisição aparece.",
      offline:
        "Carregue esta página, desligue o Wi-Fi e use. Tudo continua funcionando.",
      source:
        "Veja o código-fonte da página. A tag `Content-Security-Policy` no topo traz `connect-src 'none'`, que faz o próprio navegador recusar qualquer envio.",
    },
    measured: {
      title: "O que foi medido e o que não foi",
      versions:
        "A conversão foi medida com sets escritos pelo Live 10.1.43 e pelo Live 12.4.3 no macOS. Um set convertido de 561 scenes abriu no Live 10 sem nenhum arquivo faltando.",
      aliases:
        "Os alias records só são construídos para áudio em `/Volumes/`. Um set com o áudio no disco de inicialização também é convertido, e o Live 10 pede que você localize o áudio uma vez.",
      live11:
        "Sets do Live 11 não são convertidos. Essa versão nunca foi medida com um arquivo real, e um palpite aqui produz um set que abre e depois derruba o Live.",
      windows:
        "Nenhum set criado no Windows foi verificado. Se você tem um que se comporta mal, uma [issue com o arquivo anexado](issues) é o relato mais útil que existe.",
      original:
        "Guarde sempre o seu arquivo original. Esta página nunca o sobrescreve.",
    },
  },

  footer: {
    license: (version) =>
      `~ableton-als~ ${version} tem licença MIT e código aberto. ~Ableton®~ e ~Live™~ são marcas comerciais da Ableton AG. Este projeto não é oficial, não tem vínculo com a Ableton AG e não é endossado por ela.`,
    privacy: "Sem analytics, sem cookies, sem requisições a terceiros.",
  },

  phases: {
    reading_file: "Lendo o arquivo…",
    building_sample: "Montando o set de exemplo…",
    decompressing: "Descompactando…",
    reading_structure: "Lendo tracks, scenes e clips…",
    listing_files: "Listando os arquivos referenciados…",
    validating: "Verificando a estrutura de que o Live depende…",
    diagnosing: "Procurando reparos…",
    converting: "Convertendo para o formato do Live 10…",
    repairing: "Aplicando o reparo…",
    compressing: "Compactando…",
  },

  errors: {
    open: {
      empty_file:
        "Esse arquivo está vazio. Escolha o arquivo .als que fica dentro da pasta do seu projeto.",
      not_gzip:
        "Isso não parece um Live Set. Um arquivo .als é XML compactado com gzip. Confira se você escolheu o próprio .als, e não a pasta do projeto, um pack .alp ou um arquivo de áudio.",
      corrupt_gzip:
        "O arquivo começa como um Live Set, mas não pôde ser descompactado, então provavelmente está truncado. Copie o arquivo de novo do disco original e tente outra vez.",
      not_a_live_set:
        "O arquivo abriu, mas não há um documento do Live dentro dele. Ele pode ter vindo de outro programa.",
      too_large: `Este set é maior do que uma aba de navegador aguenta bem. Use a biblioteca pelo Node: ${USE_NODE}.`,
      crashed:
        "Algo deu errado durante o trabalho no arquivo. O mais provável é que a aba tenha ficado sem memória. Recarregue a página e tente de novo, ou use a biblioteca pelo Node para um set desse tamanho.",
    },
    unsupportedBrowser: `Este navegador não tem a API Compression Streams, de que esta página precisa. Use uma versão atual do Chrome, Edge, Firefox ou Safari, ou use a biblioteca pelo Node: ${USE_NODE}.`,
  },

  blocked: {
    unsupported_version: (version) =>
      `Esta ferramenta não roda em arquivos do Live ${version}.`,
    untested_version: (version) =>
      `Arquivos do Live ${version} ainda não foram verificados, então nenhuma correção roda neles.`,
    colliding_pointee_ids: (ids) =>
      `A automação aponta para um Id duplicado (${ids}), então renumerar ligaria essa automação à ocorrência errada.`,
    mixed_clip_durations: (scenes) =>
      `${count(scenes, "scene tem", "scenes têm")} clips com durações diferentes, e sem uma duração única por linha não há como saber quando pular.`,
    needs_two_tracks: "O arquivo não tem duas tracks com clips.",
  },

  refusals: {
    nothing_to_change: "Nada a mudar: o set já está de acordo.",
    already_v10: "Este set já está no formato do Live 10.",
    unverified_version: (version) =>
      `Sets do Live ${version} nunca foram medidos com um arquivo real, então esta página não os converte.`,
    invalid_bpm: "Informe um BPM de destino maior que zero.",
    no_warped_clips: "Este set não tem clips de áudio com warp para reescalar.",
    same_track: "Escolha duas tracks diferentes.",
    track_without_clips: (track) =>
      `A track ${track} não tem clips. Escolha uma track que tenha.`,
    relative_library_root:
      "Informe o caminho absoluto da pasta da biblioteca, começando com /",
    relink_unresolved: (files, folder) =>
      `Nenhuma referência pôde ser reapontada. O documento não diz onde ${count(files, "arquivo fica", "arquivos ficam")} dentro de uma pasta chamada "${folder}".`,
    relink_already_there:
      "Todas as referências já apontam para dentro dessa pasta.",
    library_error: (detail) => `A biblioteca recusou esta mudança: ${detail}`,
  },

  output: {
    unchanged: "Nada foi alterado ainda.",
    damaged:
      "Este set foi danificado de propósito para mostrar o que a validação pega. O Live recusaria o arquivo, então nenhum download é oferecido a partir dele. Abra o exemplo saudável ou o seu próprio .als para baixar.",
    invalid: (problems) =>
      `O set convertido tem ${count(problems, "problema de validação", "problemas de validação")}. O Live 10 recusaria esse set ou fecharia sozinho ao carregá-lo, então ele não é oferecido para download.`,
  },

  announce: {
    opened: (name) => `Arquivo aberto: ${name}`,
    updated: "Pronto. O set foi atualizado.",
    saved: (name) => `Arquivo salvo: ${name}`,
    codeCopied: "Código copiado",
    copyBlocked: "A cópia foi bloqueada. Selecione o código e copie.",
  },

  fileBar: {
    damagedSample: "Danificado de propósito",
    unknownVersion: "Versão desconhecida",
    noProblems: "Sem problemas de estrutura",
    download: "Baixar",
    openAnother: "Abrir outro arquivo",
    close: "Fechar",
    dismiss: "Dispensar",
    localOnly:
      "Este set está sendo lido só neste computador. Nada foi enviado.",
  },

  steps: {
    title: "Mudanças até agora",
    converted: "Convertido para o Live 10",
    undo: "Desfazer a última",
    reset: "Voltar ao original",
  },

  tabs: {
    label: "Visões",
    inspect: "Inspecionar",
    validate: "Validar",
    convert: "Converter",
    repair: "Reparar",
  },

  code: {
    panelLabel: "Código desta visão",
    title: "A mesma coisa em código",
    runtime: "Ambiente",
    browser: "Navegador",
    node: "Node",
    copy: "Copiar",
    copied: "Copiado",
    selectAndCopy: "Selecione e copie",
    worksWith: (version) =>
      `Funciona com a versão ${version} como publicada. Zero dependências.`,
  },

  inspect: {
    facts: {
      savedBy: "Salvo por",
      unknown: "desconhecido",
      schema: "Esquema",
      transportTempo: "Andamento do transporte",
      transportNote:
        "Onde o transporte foi deixado, que nem sempre é o andamento da música",
      timeSignature: "Fórmula de compasso",
      tracks: "Tracks",
      scenes: "Scenes",
      clips: "Clips",
      clipsNote: (audio, midi) =>
        `${number(audio)} de áudio, ${number(midi)} MIDI`,
      referencedFiles: "Arquivos referenciados",
      audioFiles: (total) => `${number(total)} de áudio`,
      size: "Tamanho",
      xmlInside: (size) => `${bytes(size)} de XML dentro`,
    },
    trackKinds: {
      AudioTrack: "Áudio",
      MidiTrack: "MIDI",
      ReturnTrack: "Return",
      GroupTrack: "Group",
    },
    session: {
      title: "Session",
      note: "Tracks na horizontal, scenes na vertical. Cada clip é pintado com o índice de cor gravado no arquivo.",
      gridLabel: "Grade da Session",
      sceneColumn: "Scene",
      missingSlots: (track, slots, scenes) =>
        `${track} tem ${count(slots, "slot", "slots")} para ${count(scenes, "scene", "scenes")}`,
      clipLabel: (track, scene, clip) => `${track}, scene ${scene}: ${clip}`,
      unnamedClip: "clip sem nome",
      showAll: (scenes) => `Mostrar todas as ${number(scenes)} scenes`,
    },
    clip: {
      select:
        "Selecione um clip para ver o que o arquivo diz sobre ele. Clips listrados são MIDI.",
      clip: "Clip",
      track: "Track",
      scene: "Scene",
      kind: "Tipo",
      audio: "Áudio",
      midi: "MIDI",
      warpedAt: "Warp em",
      timeSignature: "Fórmula de compasso",
      loopLength: "Duração do loop",
      beats: (total) => count(total, "beat", "beats"),
      file: "Arquivo",
    },
    files: {
      title: "Arquivos referenciados",
      none: "Este set não referencia nenhum arquivo.",
      file: "Arquivo",
      folder: "Pasta",
      uses: "Usos",
      aliasRecord: "Alias record",
      aliasOnConversion: "Alias na conversão",
      notAudio: "Não é áudio",
      present: "Presente",
      missing: "Ausente",
      canBeBuilt: "Pode ser construído",
      notUnderVolumes: "Fora de /Volumes/",
      showAll: (files) => `Mostrar todos os ${number(files)} arquivos`,
    },
  },

  validate: {
    none: "Nenhum problema de estrutura encontrado neste set.",
    found: (problems) =>
      `${count(problems, "problema encontrado", "problemas encontrados")}. Cada um faria o Live recusar o set ou fechar sozinho ao carregá-lo.`,
    check: "Verificação",
    looksFor: "O que ela procura",
    result: "Resultado",
    passed: "Passou",
    rules: {
      grid: {
        name: "Grade de scenes e tracks",
        checks:
          "Cada lista de clip slots, incluindo as de freeze, tem exatamente um slot por scene. Uma diferença derruba o Live enquanto o set carrega.",
      },
      ids: {
        name: "Ids e alvos de automação",
        checks:
          "A automação de clip aponta para um alvo que existe, e o alocador de Ids está acima de todos os Ids já usados.",
      },
      xml: {
        name: "Estrutura do documento",
        checks:
          "As tags abrem e fecham em ordem, e nenhum elemento que o Live espera uma única vez por pai aparece duas vezes.",
      },
      routing: {
        name: "Roteamento",
        checks:
          "Toda track que roteia para outra track aponta para uma que existe.",
      },
    },
    problemsTitle: "Problemas",
    codesNote:
      "O código e os valores dele são estáveis e servem para você redigir a mensagem com as suas palavras ou no seu idioma. A frase é a redação desta página para eles, no idioma que você escolheu.",
    cannotProve:
      "Estas verificações pegam os danos que fazem o Live recusar o set ou fechar sozinho. Elas não provam que o Live abre o set: um valor errado em um campo que o Live conhece passa por todas as verificações de estrutura.",
  },

  convert: {
    intro:
      "O Live não tem caminho de downgrade: um set salvo no Live 12 não abre no Live 10. Isto reconstrói o documento que a versão antiga espera e deixa todo o resto como estava, byte a byte.",
    libraryFolder: "Pasta da biblioteca",
    libraryHint:
      "A pasta onde fica o seu áudio, lida do set. O áudio fora dela também é convertido e aparece como aviso.",
    button: "Converter para o Live 10",
    does: {
      title: "O que a conversão faz",
      tempo:
        "Leva o andamento e a fórmula de compasso de cada scene de volta para o nome da scene, o único lugar de onde o Live 10 os lê.",
      colours:
        "Recodifica as cores de tracks e scenes. As duas versões usam a mesma paleta de 70 cores e gravam os índices de formas diferentes.",
      samples:
        "Reescreve cada referência de sample e constrói o alias record do macOS que o Live 10 usa para achar o áudio.",
      elements:
        "Remove os elementos que o Live 10 não conhece e restaura os que ele exige, depois valida o resultado antes de oferecê-lo.",
    },
    nothingToConvert: "Nada a converter",
    alreadyV10: (creator) =>
      `Este set foi salvo por ${creator}. O Live 10 o abre como está, e as versões mais novas fazem a migração sozinhas.`,
    live10OrOlder: "Live 10 ou anterior",
    notConverted: "Não convertido",
    unverified:
      "Este set foi salvo pelo Live 11, e esta conversão só foi medida em sets do Live 12. Um palpite aqui produz um arquivo que passa em todas as verificações e depois derruba o Live 10 sem nenhuma mensagem, então a página se recusa a converter.",
    shareLive11:
      "Se você puder compartilhar um set do Live 11, [abra uma issue com o arquivo anexado](issues). Essa é a medição que falta ao projeto.",
    result: {
      converted: "Convertido",
      convertedUnsafe: "Convertido, mas não é seguro abrir",
      summary: (scenes, warnings, problems) =>
        `${count(scenes, "scene reescrita", "scenes reescritas")}, ${count(warnings, "aviso", "avisos")}, ${count(problems, "problema de validação", "problemas de validação")}.`,
      download: "Baixar o set do Live 10",
      savedAs: (name) =>
        `Salvo como ${name}, nunca por cima do seu original. Abra o resultado no Live 10 e confira antes de depender dele.`,
      problemsTitle: "Problemas de validação no resultado",
      warningsTitle: "Avisos",
      warningsNote:
        "O que o Live 10 não tem como guardar, ou o que a página não conseguiu resolver.",
      audioTitle: "Referências de áudio",
      noAudio: "Este set não referencia nenhum arquivo de áudio.",
      aliasWritten: (withRecord, audioRefs) =>
        `Um alias record foi escrito para ${number(withRecord)} de ${count(audioRefs, "referência de áudio", "referências de áudio")}. O Live 10 acha o áudio por esse registro, e não pelo caminho que fica ao lado dele.`,
      offVolume: (refs) =>
        `${count(refs, "referência está", "referências estão")} fora de /Volumes/, e o registro para o disco de inicialização nunca foi medido, então nenhum foi escrito. O Live 10 vai pedir que você localize ${pick(refs, "esse arquivo", "esses arquivos")} uma vez.`,
      changedTitle: "O que mudou",
      elementsTitle: "Elementos adicionados e removidos",
      elementsNote:
        "O Live 10 recusa elementos que não conhece e fecha sozinho sem alguns que o Live 12 parou de escrever. Contados no documento inteiro.",
      element: "Elemento",
      inV12: "No set do Live 12",
      inV10: "No set do Live 10",
      moreElements: (names) =>
        `E mais ${count(names, "nome de elemento cuja contagem mudou", "nomes de elemento cuja contagem mudou")}.`,
      before: "Antes, como o Live 12 escreveu",
      after: "Depois, como o Live 10 espera",
    },
    excerpts: {
      header: "Cabeçalho do documento",
      scene: (scene) => `Scene ${scene}`,
      firstAudioRef: "Primeira referência de áudio",
      hexChars: (total) => `(${number(total)} caracteres hex)`,
      moreLines: (lines) => `mais ${count(lines, "linha", "linhas")}`,
    },
    cannot: {
      title: "O que uma conversão não traz de volta",
      jump: "A follow action Jump existe a partir do Live 11. Clips que a usam ficam sem ação, com um aviso.",
      folderRef:
        "Uma referência que apontava para uma pasta chega vazia do Live 12. Não há de onde reconstruí-la.",
      longFolder:
        "Um nome de pasta com mais de 31 caracteres é escrito inteiro dentro do alias record, onde o Live o encurtaria. Sets construídos assim abriram no Live 10 com todos os clips carregados.",
      sceneColours:
        "As cores de scene seguem o mapeamento medido para tracks. Uma scene colorida nunca foi medida diretamente.",
    },
  },

  repair: {
    intro:
      "Cada reparo lê o set primeiro e diz o que mudaria. Nada é aplicado até você pedir, os reparos se acumulam no mesmo arquivo e o último pode ser desfeito.",
    tools: {
      pointeeIds: {
        title: TOOL_TITLES.pointeeIds,
        about:
          "Dois alvos de automação ou de modulação com o mesmo Id fazem o Live 12 recusar o set. Isto renumera as ocorrências extras e move o alocador de Ids para depois delas.",
        button: "Renumerar duplicados",
      },
      rewarp: {
        title: TOOL_TITLES.rewarp,
        about:
          "Mudar o BPM de um clip no Live move o warp marker e deixa as janelas de loop na escala antiga de beats, então o clip sai do lugar. Isto reescala cada valor em beats de cada clip de áudio para o andamento que você informar. Os follow times são a duração de uma scene e ficam como estão, então rode o reparo de follow actions depois deste.",
        button: "Reescalar clips",
      },
      followActions: {
        title: TOOL_TITLES.followActions,
        about:
          "Ativa a follow action de cada clip, desvincula essa ação da duração do clip e ajusta o tempo dela para a duração real da scene.",
        button: "Sincronizar follow actions",
      },
      mirrorTrack: {
        title: TOOL_TITLES.mirrorTrack,
        about:
          "Copia janelas de loop, warp markers e follow times de uma track para outra, scene por scene. Cada track mantém o próprio áudio.",
        button: "Copiar geometria",
      },
      relinkSamples: {
        title: TOOL_TITLES.relinkSamples,
        about:
          "Um set montado em outro computador carrega os caminhos daquele computador, e todos os clips abrem como ausentes. Isto reaponta cada referência para a sua cópia da biblioteca e reconstrói o alias record dela.",
        button: "Religar samples",
      },
    },
    status: {
      notAvailable: "Indisponível",
      toFix: (pending) => `${number(pending)} a corrigir`,
      onRequest: "Sob demanda",
      nothingToFix: "Nada a corrigir",
    },
    targetBpm: "BPM de destino",
    copyFrom: "Copiar de",
    onto: "Para",
    pickTwo: "Escolha duas tracks diferentes.",
    mirrorPreview: (shared, differing, oneSided) =>
      `${count(shared, "scene tem", "scenes têm")} clip nas duas tracks, e ${number(differing)} ${pick(differing, "delas difere", "delas diferem")}. ${number(oneSided)} com clip em um lado só ${pick(oneSided, "fica como está", "ficam como estão")}.`,
    relinkLabel: "Onde a biblioteca está nesta máquina",
    relinkHint:
      "A pasta precisa ter o mesmo nome que tinha na máquina que salvou o set. Tudo o que está dentro dela continua no lugar.",
    convertFirst:
      "Converta o set para o Live 10 primeiro: é a conversão que escreve essas referências.",
    applied: "Aplicado",
    done: {
      pointeeIds: (ids) => `${count(ids, "Id renumerado", "Ids renumerados")}.`,
      rewarp: (clips) =>
        `${count(clips, "clip reescalado", "clips reescalados")}.`,
      followActions: (clips) =>
        `${count(clips, "clip sincronizado", "clips sincronizados")}.`,
      mirrorTrack: (clips) =>
        `${count(clips, "clip alinhado", "clips alinhados")}.`,
      relinkSamples: (refs) =>
        `${count(refs, "referência reapontada", "referências reapontadas")}.`,
      leftAlone: (refs) =>
        `${count(refs, "referência ficou como estava", "referências ficaram como estavam")}.`,
    },
    what: "O quê",
    before: "Antes",
    after: "Depois",
    moreBpms: (more) => `+${number(more)} outros`,
  },

  labels: {
    automationTargets: "Alvos de automação",
    duplicatedIds: "Ids duplicados",
    extraOccurrences: "Ocorrências extras",
    audioClips: "Clips de áudio",
    clipsWarpedAt: "Clips com warp em",
    gridBpm: "BPM da grade",
    masterBpm: "BPM do master",
    clips: "Clips",
    needEnable: "Falta ativar",
    needUnlink: "Falta desvincular",
    needRetime: "Falta ajustar o tempo",
    tracksWithClips: "Tracks com clips",
    sharedScenes: "Scenes que as duas tracks têm",
    differingScenes: "Scenes que diferem",
    firstAudioRef: "Primeira referência de áudio",
    refsWithAlias: "Referências com alias record",
    audioRefsWithAlias: "Referências de áudio com alias record",
    savedBy: "Salvo por",
    schema: "Esquema",
    sceneName: (scene) => `Nome da scene ${scene}`,
    trackColor: (track) => `Cor da track ${track}`,
  },

  messages,
}
