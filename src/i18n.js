export const supportedLocales = [
  { id: 'en', label: 'English' },
  { id: 'zh-CN', label: '中文' }
]

const messages = {
  en: {
    app: {
      conversation: 'This conversation',
      noVersion: 'no version',
      noAudio: 'No audio',
      openProjectFolder: 'Open project folder',
      useLightMode: 'Use light mode',
      useDarkMode: 'Use dark mode',
      switchToChinese: 'Switch to Chinese',
      switchToEnglish: 'Switch to English'
    },
    nav: {
      review: 'Review',
      suggestedEdit: 'Suggested Edit',
      settings: 'Settings'
    },
    actions: {
      importAudio: 'Import audio',
      transcribe: 'Transcribe',
      refresh: 'Refresh',
      previewEdit: 'Preview edit',
      createVersion: 'Create version',
      saveAnnotation: 'Save annotation',
      prepareBrief: 'Prepare edit brief',
      updateBrief: 'Update brief',
      copyBrief: 'Copy brief',
      reviseNote: 'Revise note',
      install: 'Install',
      repair: 'Repair',
      installing: 'Installing',
      cancel: 'Cancel',
      viewLogs: 'View logs',
      close: 'Close',
      play: 'Play',
      pause: 'Pause'
    },
    status: {
      loadingProject: 'Loading project',
      projectReady: 'Project ready',
      importingAudio: 'Importing and transcribing audio',
      importedAndTranscribed: 'Audio imported and transcribed',
      importedNoAdapter: 'Audio imported; transcription is not configured',
      creatingTextDraft: 'Creating text draft',
      scriptDraftCreated: 'Script draft created',
      transcribingCurrent: 'Transcribing current version',
      transcriptUpdated: 'Transcript updated',
      transcriptionNotConfigured: 'Transcription is not configured',
      startingInstall: 'Starting runtime install',
      cancellingInstall: 'Cancelling install',
      installCancelled: 'Install cancelled',
      creatingAnnotation: 'Creating annotation',
      annotationSaved: 'Annotation saved',
      preparingBrief: 'Preparing edit brief',
      briefSaved: 'Edit brief saved. Review it before running any edit.',
      briefCopied: 'Edit brief copied. Paste it into the composer when ready.',
      composerDraftSelected: '{message} Composer draft selected.',
      creatingEditedVersion: 'Creating edited version',
      editedVersionSaved: 'Edited audio saved as a new version',
      openingFolder: 'Opening {kind} folder'
    },
    intent: {
      shorten: {
        label: 'Shorten',
        note: 'Shorten this part and make the tone calmer.'
      },
      delete: {
        label: 'Delete',
        note: 'Remove this section and keep the transition natural.'
      },
      rewrite: {
        label: 'Rewrite',
        note: 'Rewrite this section to be clearer while preserving the meaning.'
      },
      revoice: {
        label: 'Revoice',
        note: 'Regenerate this line with a steadier delivery and matching voice.'
      },
      keep: {
        label: 'Keep',
        note: 'Keep this section, but mark it for review context.'
      },
      issue: {
        label: 'Issue',
        note: 'Flag this section as an issue. Do not edit it yet.'
      }
    },
    drawer: {
      editNotes: 'Edit Notes',
      selectedRange: 'Selected range',
      selectSegment: 'Select a transcript segment.',
      editNote: 'Edit note',
      editBrief: 'Edit brief',
      briefReady: 'Prepare a local brief with the selected audio range and edit note.',
      briefSaved: 'Saved locally. Use this brief as the reviewed input for a later edit step.',
      audioVersion: 'Audio version {version}',
      transcriptSegment: 'Transcript segment',
      composerDraft: 'Composer draft',
      noSelection: 'No selection'
    },
    transcript: {
      title: 'Transcript Review',
      segments: '{count} segments',
      emptyHint: 'Configure AUDIO_PATCH_STT_COMMAND to transcribe imported audio automatically.',
      status: {
        ready: 'Transcribed',
        pending: 'Transcription pending',
        unavailable: 'Transcription not configured',
        failed: 'Transcription failed',
        fallback: 'Transcript unavailable'
      }
    },
    preview: {
      emptyTitle: 'No suggested edit yet',
      emptyBody: 'Create an annotation in Review, then prepare an edit brief.',
      title: 'Suggested Edit',
      compareWith: 'Compare with',
      summary: 'Summary',
      summaryReady: 'Suggested edit ready',
      original: 'Original',
      suggestedEdit: 'Suggested edit',
      candidateAudio: 'Candidate audio',
      transcriptChange: 'Transcript change',
      removedSection: '[removed section]',
      localPreview: 'local preview'
    },
    settings: {
      title: 'Settings',
      language: 'Language',
      languageBody: 'Choose the language used by SoundCue. Briefs copied to the composer will match this language.',
      runtimeIntro: 'Install only what the current workflow needs. All built-in tools run locally; OpenVoice is optional and larger than the transcript/audio layers.',
      checkingTools: 'Checking local tools',
      installLog: 'Install log',
      noLog: 'No log yet.'
    },
    runtime: {
      level: {
        required: 'Required',
        recommended: 'Recommended',
        optional: 'Optional'
      },
      state: {
        missing: 'Missing',
        planning: 'Planning',
        waiting_for_user: 'Waiting',
        installing: 'Installing',
        verifying: 'Verifying',
        ready: 'Ready',
        enabled: 'Enabled',
        disabled: 'Disabled',
        external_configured: 'External',
        failed: 'Failed'
      },
      meta: {
        detail: 'Detail',
        version: 'Version',
        path: 'Path',
        size: 'Size'
      },
      card: {
        core: {
          title: 'Core',
          description: 'SoundCue UI, local project files, annotations, edit briefs, and version review.'
        },
        'audio-tools': {
          title: 'Audio tools',
          description: 'FFmpeg and FFprobe for probing, slicing, rendering, and export.',
          installLabel: 'Install FFmpeg',
          manualSetup: 'Install FFmpeg and FFprobe, then make both commands available on PATH.'
        },
        transcript: {
          title: 'Transcript',
          description: 'Local whisper.cpp runner plus the default ggml-base.en model.',
          installLabel: 'Install Whisper',
          manualSetup: 'Install whisper.cpp, make whisper-cli available on PATH, then run npm run stt:setup.'
        },
        'voice-openvoice': {
          title: 'Voice provider',
          description: 'OpenVoice local voice replacement. Large optional install; podcast review works without it.',
          installLabel: 'Install OpenVoice',
          manualSetup: 'Run npm run voice:setup, then npm run voice:check. Enable with AUDIO_PATCH_VOICE_PROVIDER=openvoice.'
        }
      },
      progress: {
        openvoice: 'Creating a local Python voice runtime. This can take several minutes.',
        default: 'Installing and verifying local tooling on this machine.',
        failed: 'Install failed.'
      }
    },
    annotationStatus: {
      draft: 'draft',
      sent_to_codex: 'sent',
      brief_ready: 'brief',
      patch_ready: 'ready',
      applied: 'applied'
    },
    prompt: {
      textDraft: 'Paste a script draft. SoundCue will create a text-first version and synthesize placeholder audio unless TTS is configured.'
    },
    brief: {
      title: '# SoundCue Edit Brief',
      guard: 'Use this as context only. Do not modify audio files or project files unless I explicitly ask in the composer.',
      brief: 'Brief',
      project: 'Project',
      version: 'Version',
      audio: 'Audio',
      transcript: 'Transcript',
      range: 'Range',
      intent: 'Intent',
      note: 'Note',
      none: 'none',
      selectedTranscript: 'Selected transcript:',
      noSelectedTranscript: '[No selected transcript text]',
      nextStepTitle: 'Next step:',
      nextStep: 'Help me reason about the edit. If I approve, propose the exact edit plan first; do not apply it automatically.'
    }
  },
  'zh-CN': {
    app: {
      conversation: '当前对话',
      noVersion: '无版本',
      noAudio: '暂无音频',
      openProjectFolder: '打开项目文件夹',
      useLightMode: '切换到浅色模式',
      useDarkMode: '切换到深色模式',
      switchToChinese: '切换到中文',
      switchToEnglish: '切换到英文'
    },
    nav: {
      review: '审阅',
      suggestedEdit: '建议修改',
      settings: '设置'
    },
    actions: {
      importAudio: '导入音频',
      transcribe: '转写',
      refresh: '刷新',
      previewEdit: '试听修改',
      createVersion: '生成新版本',
      saveAnnotation: '保存批注',
      prepareBrief: '生成编辑说明',
      updateBrief: '更新编辑说明',
      copyBrief: '复制说明',
      reviseNote: '修改批注',
      install: '安装',
      repair: '修复',
      installing: '安装中',
      cancel: '取消',
      viewLogs: '查看日志',
      close: '关闭',
      play: '播放',
      pause: '暂停'
    },
    status: {
      loadingProject: '正在加载项目',
      projectReady: '项目已就绪',
      importingAudio: '正在导入并转写音频',
      importedAndTranscribed: '音频已导入并完成转写',
      importedNoAdapter: '音频已导入，但尚未配置转写工具',
      creatingTextDraft: '正在创建文本草稿',
      scriptDraftCreated: '文本草稿已创建',
      transcribingCurrent: '正在转写当前版本',
      transcriptUpdated: '转写已更新',
      transcriptionNotConfigured: '尚未配置转写工具',
      startingInstall: '正在启动运行环境安装',
      cancellingInstall: '正在取消安装',
      installCancelled: '安装已取消',
      creatingAnnotation: '正在创建批注',
      annotationSaved: '批注已保存',
      preparingBrief: '正在生成编辑说明',
      briefSaved: '编辑说明已保存。执行修改前请先审阅。',
      briefCopied: '编辑说明已复制。需要时粘贴到 Codex 输入框。',
      composerDraftSelected: '{message} 已选中编辑说明草稿。',
      creatingEditedVersion: '正在生成修改后的新版本',
      editedVersionSaved: '已将修改后的音频保存为新版本',
      openingFolder: '正在打开{kind}文件夹'
    },
    intent: {
      shorten: {
        label: '缩短',
        note: '把这一段缩短一些，语气更平稳。'
      },
      delete: {
        label: '删除',
        note: '删除这一段，并保持前后衔接自然。'
      },
      rewrite: {
        label: '改写',
        note: '在保留原意的前提下，把这一段说得更清楚。'
      },
      revoice: {
        label: '重配音',
        note: '用更稳定的表达重新生成这一句，并尽量匹配原声线。'
      },
      keep: {
        label: '保留',
        note: '这一段先保留，仅作为审阅上下文标记。'
      },
      issue: {
        label: '问题',
        note: '标记这一段存在问题，先不要直接修改。'
      }
    },
    drawer: {
      editNotes: '编辑批注',
      selectedRange: '选中片段',
      selectSegment: '请选择一段转写文本。',
      editNote: '批注说明',
      editBrief: '编辑说明',
      briefReady: '根据选中的音频范围和批注，生成一份本地编辑说明。',
      briefSaved: '已保存到本地。后续修改时，请把这份说明作为审阅后的输入。',
      audioVersion: '音频版本 {version}',
      transcriptSegment: '转写片段',
      composerDraft: '输入框草稿',
      noSelection: '未选择片段'
    },
    transcript: {
      title: '转写审阅',
      segments: '{count} 段',
      emptyHint: '配置 AUDIO_PATCH_STT_COMMAND 后，导入音频即可自动转写。',
      status: {
        ready: '已转写',
        pending: '等待转写',
        unavailable: '未配置转写',
        failed: '转写失败',
        fallback: '暂无转写'
      }
    },
    preview: {
      emptyTitle: '还没有建议修改',
      emptyBody: '先在审阅页保存批注，再生成编辑说明。',
      title: '建议修改',
      compareWith: '对比版本',
      summary: '修改摘要',
      summaryReady: '建议修改已生成',
      original: '原始版本',
      suggestedEdit: '建议修改',
      candidateAudio: '候选音频',
      transcriptChange: '转写变化',
      removedSection: '[已删除片段]',
      localPreview: '本地预览'
    },
    settings: {
      title: '设置',
      language: '语言',
      languageBody: '选择 SoundCue 的界面语言。复制到 Codex 输入框的编辑说明也会使用同一种语言。',
      runtimeIntro: '只安装当前流程真正需要的工具。内置工具都在本机运行；OpenVoice 是可选项，体积也比转写和音频工具更大。',
      checkingTools: '正在检查本地工具',
      installLog: '安装日志',
      noLog: '暂无日志。'
    },
    runtime: {
      level: {
        required: '必需',
        recommended: '推荐',
        optional: '可选'
      },
      state: {
        missing: '未安装',
        planning: '规划中',
        waiting_for_user: '等待操作',
        installing: '安装中',
        verifying: '验证中',
        ready: '已就绪',
        enabled: '已启用',
        disabled: '已停用',
        external_configured: '外部工具',
        failed: '失败'
      },
      meta: {
        detail: '详情',
        version: '版本',
        path: '路径',
        size: '大小'
      },
      card: {
        core: {
          title: '核心能力',
          description: 'SoundCue 界面、本地项目文件、批注、编辑说明和版本审阅。'
        },
        'audio-tools': {
          title: '音频工具',
          description: '使用 FFmpeg 和 FFprobe 做音频探测、切片、渲染和导出。',
          installLabel: '安装 FFmpeg',
          manualSetup: '安装 FFmpeg 和 FFprobe，并确保两个命令都可以在 PATH 中访问。'
        },
        transcript: {
          title: '转写',
          description: '本地 whisper.cpp 运行器，以及默认的 ggml-base.en 模型。',
          installLabel: '安装 Whisper',
          manualSetup: '安装 whisper.cpp，让 whisper-cli 可在 PATH 中访问，然后运行 npm run stt:setup。'
        },
        'voice-openvoice': {
          title: '声音提供方',
          description: 'OpenVoice 本地声音替换能力。安装包较大；仅做播客审阅时可以不安装。',
          installLabel: '安装 OpenVoice',
          manualSetup: '运行 npm run voice:setup，再运行 npm run voice:check。通过 AUDIO_PATCH_VOICE_PROVIDER=openvoice 启用。'
        }
      },
      progress: {
        openvoice: '正在创建本地 Python 声音运行环境，可能需要几分钟。',
        default: '正在本机安装并验证工具。',
        failed: '安装失败。'
      }
    },
    annotationStatus: {
      draft: '草稿',
      sent_to_codex: '已发送',
      brief_ready: '说明已就绪',
      patch_ready: '可审阅',
      applied: '已应用'
    },
    prompt: {
      textDraft: '粘贴一份文稿。SoundCue 会创建一个文本优先的版本；如果尚未配置 TTS，则会生成占位音频。'
    },
    brief: {
      title: '# SoundCue 编辑说明',
      guard: '这份内容只作为上下文。除非我在输入框里明确要求，否则不要修改音频文件或项目文件。',
      brief: '说明',
      project: '项目',
      version: '版本',
      audio: '音频',
      transcript: '转写',
      range: '范围',
      intent: '意图',
      note: '批注',
      none: '无',
      selectedTranscript: '选中的转写：',
      noSelectedTranscript: '[没有选中的转写文本]',
      nextStepTitle: '下一步：',
      nextStep: '先帮我分析这个修改。如果我认可，请先给出准确的编辑计划；不要自动执行修改。'
    }
  }
}

export function normalizeLocale(locale) {
  return String(locale || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

function readPath(source, path) {
  return path.split('.').reduce((current, key) => current?.[key], source)
}

function interpolate(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => values?.[key] ?? '')
}

export function createTranslator(locale) {
  const normalized = normalizeLocale(locale)
  const dictionary = messages[normalized] ?? messages.en
  return function t(path, values = {}) {
    const template = readPath(dictionary, path) ?? readPath(messages.en, path) ?? path
    return interpolate(template, values)
  }
}

export function messageExists(locale, path) {
  return readPath(messages[normalizeLocale(locale)] ?? messages.en, path) != null
}
