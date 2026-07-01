import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import {
  AudioLines,
  ChevronRight,
  Clock3,
  FileAudio,
  FolderOpen,
  Highlighter,
  ListRestart,
  Loader2,
  MessageSquare,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  Captions,
  CheckCircle2,
  Copy,
  Info,
  Languages,
  XCircle,
  WandSparkles
} from 'lucide-react'
import { createTranslator, messageExists, normalizeLocale, supportedLocales } from './i18n.js'

const intentDefinitions = [
  { id: 'shorten', icon: Scissors },
  { id: 'delete', icon: Trash2 },
  { id: 'rewrite', icon: WandSparkles },
  { id: 'revoice', icon: Sparkles },
  { id: 'keep', icon: Highlighter },
  { id: 'issue', icon: MessageSquare }
]

function getInitialLocale() {
  const stored = window.localStorage?.getItem('soundcue-locale')
  if (stored) return normalizeLocale(stored)
  return normalizeLocale(window.navigator?.language)
}

async function requestJson(url, options) {
  const response = await fetch(url, options)
  const text = await response.text()
  if (!response.ok) {
    throw new Error(text || `${response.status} ${response.statusText}`)
  }
  return text ? JSON.parse(text) : {}
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function readAudioMeta(file) {
  if (!file.type.startsWith('audio/')) return {}
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext
  if (!AudioContextCtor) return {}
  const context = new AudioContextCtor()
  try {
    const buffer = await file.arrayBuffer()
    const decoded = await context.decodeAudioData(buffer.slice(0))
    const channel = decoded.getChannelData(0)
    const bucketCount = 72
    const bucketSize = Math.max(1, Math.floor(channel.length / bucketCount))
    const peaks = Array.from({ length: bucketCount }, (_, index) => {
      let peak = 0
      const start = index * bucketSize
      const end = Math.min(channel.length, start + bucketSize)
      for (let cursor = start; cursor < end; cursor += 1) {
        peak = Math.max(peak, Math.abs(channel[cursor]))
      }
      return Number(peak.toFixed(3))
    })
    return { durationMs: Math.round(decoded.duration * 1000), peaks }
  } catch {
    return {}
  } finally {
    await context.close()
  }
}

function msLabel(ms = 0) {
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`
  const total = Math.floor(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function fileUrl(path) {
  return path ? `/api/file?path=${encodeURIComponent(path)}` : ''
}

function displayVersionLabel(version, t) {
  if (!version) return t('app.noAudio')
  return (version.label || version.versionId || t('app.noAudio')).replace(/^Patch\b/, t('preview.suggestedEdit'))
}

function displayAnnotationStatus(status, t) {
  return messageExists('en', `annotationStatus.${status}`) ? t(`annotationStatus.${status}`) : status
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall through to the textarea path when the document is not focused.
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!copied) throw new Error('Clipboard copy failed.')
}

export default function App() {
  const [locale, setLocale] = useState(getInitialLocale)
  const t = useMemo(() => createTranslator(locale), [locale])
  const intentOptions = useMemo(() => intentDefinitions.map((option) => ({
    ...option,
    label: t(`intent.${option.id}.label`),
    note: t(`intent.${option.id}.note`)
  })), [t])
  const defaultIntentNotes = useMemo(() => {
    return Object.fromEntries(intentOptions.map((option) => [option.id, option.note]))
  }, [intentOptions])
  const [view, setView] = useState(null)
  const [transcript, setTranscript] = useState({ segments: [] })
  const [mode, setMode] = useState('review')
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [selectedSegmentId, setSelectedSegmentId] = useState(null)
  const [intent, setIntent] = useState('shorten')
  const [patchNote, setPatchNote] = useState(() => createTranslator(getInitialLocale())('intent.shorten.note'))
  const [selectedPatchId, setSelectedPatchId] = useState(null)
  const [compareVersionId, setCompareVersionId] = useState(null)
  const [status, setStatus] = useState(() => createTranslator(getInitialLocale())('status.loadingProject'))
  const [runtimeStatus, setRuntimeStatus] = useState(null)
  const [runtimeLog, setRuntimeLog] = useState(null)
  const [theme, setTheme] = useState(() => {
    const stored = window.localStorage?.getItem('soundcue-theme')
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [playbackDurationMs, setPlaybackDurationMs] = useState(0)
  const [audioElement, setAudioElement] = useState(null)
  const [briefClipboardText, setBriefClipboardText] = useState('')
  const audioRef = useRef(null)
  const briefDraftRef = useRef(null)
  const noteEditedRef = useRef(false)
  const lastTimeSyncRef = useRef(0)
  const lastRenderedTimeRef = useRef(0)
  const activeSegmentIdRef = useRef(null)

  const project = view?.project
  const currentVersion = useMemo(() => {
    if (!view) return null
    return view.versions.find((version) => version.versionId === view.project.currentVersionId) ?? view.versions.at(-1)
  }, [view])
  const selectedSegment = useMemo(() => {
    return transcript.segments.find((segment) => segment.segmentId === selectedSegmentId) ?? transcript.segments[0]
  }, [selectedSegmentId, transcript])
  const selectedPatch = useMemo(() => {
    if (!view?.patches?.length) return null
    return view.patches.find((patch) => patch.patchId === selectedPatchId) ?? view.patches[0]
  }, [selectedPatchId, view])
  const editBriefsForVersion = useMemo(() => {
    if (!view || !currentVersion) return []
    return (view.codexRequests ?? []).filter((request) => request.targetVersionId === currentVersion.versionId)
  }, [currentVersion, view])
  const annotationsForVersion = useMemo(() => {
    if (!view || !currentVersion) return []
    return view.annotations.filter((annotation) => annotation.targetVersionId === currentVersion.versionId)
  }, [currentVersion, view])
  const latestAnnotation = annotationsForVersion[0] ?? null
  const latestEditBrief = editBriefsForVersion[0] ?? null
  const runtimeHasActiveJob = runtimeStatus?.activeJobs?.some((job) => ['installing', 'verifying'].includes(job.state)) ?? false

  async function refresh(nextVersionId) {
    const nextView = await requestJson('/api/project')
    if (!nextView.project.versions.length) {
      const demo = await requestJson('/api/demo', { method: 'POST' })
      setView(demo)
      return loadTranscript(demo.project.currentVersionId, demo)
    }
    setView(nextView)
    const versionId = nextVersionId ?? nextView.project.currentVersionId
    setCompareVersionId((previous) => previous ?? nextView.versions[0]?.versionId ?? null)
    await loadTranscript(versionId, nextView)
  }

  async function loadTranscript(versionId, activeView = view) {
    if (!versionId) return
    const nextTranscript = await requestJson(`/api/transcripts/${versionId}`)
    setTranscript(nextTranscript)
    setSelectedSegmentId((previous) => previous ?? nextTranscript.segments[0]?.segmentId ?? null)
    const version = activeView?.versions?.find((item) => item.versionId === versionId)
    if (version?.audioPath && audioRef.current) {
      audioRef.current.src = fileUrl(version.audioPath)
    }
  }

  useEffect(() => {
    refresh().then(() => setStatus(t('status.projectReady'))).catch((error) => setStatus(error.message))
    loadRuntimeStatus().catch((error) => setStatus(error.message))
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
    window.localStorage?.setItem('soundcue-locale', locale)
    if (!noteEditedRef.current) {
      setPatchNote(defaultIntentNotes[intent] ?? '')
    }
  }, [defaultIntentNotes, intent, locale])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage?.setItem('soundcue-theme', theme)
  }, [theme])

  useEffect(() => {
    if (!runtimeHasActiveJob) return undefined
    const timer = window.setInterval(() => {
      loadRuntimeStatus().catch((error) => setStatus(error.message))
    }, 1500)
    return () => window.clearInterval(timer)
  }, [runtimeHasActiveJob])

  useEffect(() => {
    if (!briefClipboardText || !briefDraftRef.current) return
    briefDraftRef.current.focus()
    briefDraftRef.current.select()
  }, [briefClipboardText])

  useEffect(() => {
    if (currentVersion?.audioPath && audioRef.current) {
      audioRef.current.src = fileUrl(currentVersion.audioPath)
      setCurrentTimeMs(0)
      setPlaybackDurationMs(currentVersion.durationMs ?? 0)
    }
  }, [currentVersion])

  useEffect(() => {
    const audio = audioElement
    if (!audio) return undefined
    const syncTime = () => {
      const nextTimeMs = Math.round((audio.currentTime || 0) * 1000)
      const now = window.performance.now()
      if (now - lastTimeSyncRef.current > 220 || Math.abs(nextTimeMs - lastRenderedTimeRef.current) > 1000) {
        lastTimeSyncRef.current = now
        lastRenderedTimeRef.current = nextTimeMs
        setCurrentTimeMs(nextTimeMs)
      }
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setPlaybackDurationMs(Math.round(audio.duration * 1000))
      }
      const activeSegment = transcript.segments.find((segment) => nextTimeMs >= segment.startMs && nextTimeMs < segment.endMs)
      if (activeSegment && activeSegment.segmentId !== activeSegmentIdRef.current) {
        activeSegmentIdRef.current = activeSegment.segmentId
        setSelectedSegmentId(activeSegment.segmentId)
      }
    }
    const syncDuration = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setPlaybackDurationMs(Math.round(audio.duration * 1000))
      }
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onEnded = () => setPlaying(false)
    audio.addEventListener('timeupdate', syncTime)
    audio.addEventListener('seeking', syncTime)
    audio.addEventListener('loadedmetadata', syncDuration)
    audio.addEventListener('durationchange', syncDuration)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', syncTime)
      audio.removeEventListener('seeking', syncTime)
      audio.removeEventListener('loadedmetadata', syncDuration)
      audio.removeEventListener('durationchange', syncDuration)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
    }
  }, [audioElement, transcript.segments])

  async function importAudio(file) {
    if (!file) return
    setBusy(true)
    setStatus(t('status.importingAudio'))
    try {
      const [dataUrl, meta] = await Promise.all([fileToDataUrl(file), readAudioMeta(file)])
      const nextView = await requestJson('/api/import-audio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataUrl, name: file.name, mimeType: file.type, ...meta })
      })
      setView(nextView)
      await loadTranscript(nextView.project.currentVersionId, nextView)
      setStatus(nextView.versions.at(-1)?.transcriptStatus === 'ready' ? t('status.importedAndTranscribed') : t('status.importedNoAdapter'))
    } catch (error) {
      setStatus(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function createTextDraftFromPrompt() {
    const text = window.prompt(t('prompt.textDraft'))
    if (!text?.trim()) return
    setBusy(true)
    setStatus(t('status.creatingTextDraft'))
    try {
      const nextView = await requestJson('/api/import-text', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'episode-draft', text })
      })
      setView(nextView)
      await loadTranscript(nextView.project.currentVersionId, nextView)
      setStatus(t('status.scriptDraftCreated'))
    } catch (error) {
      setStatus(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function transcribeCurrentVersion() {
    if (!currentVersion) return
    setBusy(true)
    setStatus(t('status.transcribingCurrent'))
    try {
      const nextView = await requestJson('/api/transcribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ versionId: currentVersion.versionId })
      })
      setView(nextView)
      await loadTranscript(nextView.project.currentVersionId, nextView)
      const updatedVersion = nextView.versions.find((version) => version.versionId === currentVersion.versionId)
      setStatus(updatedVersion?.transcriptStatus === 'ready'
        ? t('status.transcriptUpdated')
        : updatedVersion?.transcriptNote ?? t('status.transcriptionNotConfigured'))
    } catch (error) {
      setStatus(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function loadRuntimeStatus() {
    const payload = await requestJson('/api/runtime')
    setRuntimeStatus(payload)
    return payload
  }

  async function installRuntime(runtimeId) {
    setBusy(true)
    setStatus(t('status.startingInstall'))
    try {
      const job = await requestJson(`/api/runtime/${runtimeId}/install`, { method: 'POST' })
      setStatus(`${job.phase}: ${job.step}`)
      await loadRuntimeStatus()
    } catch (error) {
      setStatus(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function cancelRuntime(runtimeId) {
    setStatus(t('status.cancellingInstall'))
    try {
      await requestJson(`/api/runtime/${runtimeId}/cancel`, { method: 'POST' })
      await loadRuntimeStatus()
      setStatus(t('status.installCancelled'))
    } catch (error) {
      setStatus(error.message)
    }
  }

  async function viewRuntimeLog(runtimeId) {
    try {
      const payload = await requestJson(`/api/runtime/${runtimeId}/log`)
      setRuntimeLog(payload)
    } catch (error) {
      setRuntimeLog({ runtimeId, text: error.message })
    }
  }


  async function createAnnotation() {
    if (!selectedSegment || !currentVersion) return
    setBusy(true)
    setStatus(t('status.creatingAnnotation'))
    try {
      const nextView = await requestJson('/api/annotations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetVersionId: currentVersion.versionId,
          range: {
            startMs: selectedSegment.startMs,
            endMs: selectedSegment.endMs,
            segmentIds: [selectedSegment.segmentId],
            selectedText: selectedSegment.text
          },
          intent: {
            type: intent,
            note: patchNote,
            constraints: ['keep_meaning', 'natural_transition']
          }
        })
      })
      setView(nextView)
      setStatus(t('status.annotationSaved'))
    } catch (error) {
      setStatus(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function prepareEditBrief() {
    const annotation = latestAnnotation
    if (!annotation) return
    setBusy(true)
    setStatus(t('status.preparingBrief'))
    try {
      const nextView = await requestJson('/api/edit-briefs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ annotationId: annotation.annotationId })
      })
      setView(nextView)
      setStatus(t('status.briefSaved'))
    } catch (error) {
      setStatus(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function copyEditBrief() {
    const brief = latestEditBrief
    const annotation = latestAnnotation
    if (!brief || !annotation) return
    const selectedText = brief.contextPackage?.inputs?.transcript?.selectedSegments
      ?.map((segment) => `[${msLabel(segment.startMs ?? segment.start * 1000)}] ${segment.text}`)
      ?.join('\n')
      || annotation.range.selectedText
      || selectedSegment?.text
      || ''
    const audioPath = brief.contextPackage?.inputs?.audio?.path ?? brief.audioPath ?? currentVersion?.audioPath ?? ''
    const transcriptPath = brief.contextPackage?.inputs?.transcript?.path ?? brief.transcriptPath ?? currentVersion?.transcriptPath ?? ''
    const briefText = [
      t('brief.title'),
      '',
      t('brief.guard'),
      '',
      `${t('brief.brief')}: ${brief.requestId}`,
      `${t('brief.project')}: ${brief.projectId ?? project.projectId}`,
      `${t('brief.version')}: ${annotation.targetVersionId}`,
      `${t('brief.audio')}: ${audioPath}`,
      `${t('brief.transcript')}: ${transcriptPath}`,
      `${t('brief.range')}: ${msLabel(annotation.range.startMs)} - ${msLabel(annotation.range.endMs)}`,
      `${t('brief.intent')}: ${t(`intent.${annotation.intent.type}.label`)}`,
      `${t('brief.note')}: ${annotation.intent.note || t('brief.none')}`,
      '',
      t('brief.selectedTranscript'),
      selectedText || t('brief.noSelectedTranscript'),
      '',
      t('brief.nextStepTitle'),
      t('brief.nextStep')
    ].join('\n')
    try {
      await writeClipboardText(briefText)
      setBriefClipboardText('')
      setStatus(t('status.briefCopied'))
    } catch (error) {
      setBriefClipboardText(briefText)
      setStatus(t('status.composerDraftSelected', { message: error.message }))
    }
  }

  async function applySelectedPatch() {
    if (!selectedPatch) return
    setBusy(true)
    setStatus(t('status.creatingEditedVersion'))
    try {
      const nextView = await requestJson(`/api/patches/${selectedPatch.patchId}/apply`, { method: 'POST' })
      setView(nextView)
      await loadTranscript(nextView.project.currentVersionId, nextView)
      setMode('review')
      setStatus(t('status.editedVersionSaved'))
    } catch (error) {
      setStatus(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function openFolder(kind) {
    setStatus(t('status.openingFolder', { kind }))
    try {
      const result = await requestJson('/api/open-folder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind })
      })
      setStatus(result.path)
    } catch (error) {
      setStatus(error.message)
    }
  }

  function togglePlay(src) {
    const audio = audioRef.current
    if (!audio) return
    if (src && audio.src !== new URL(src, window.location.href).href) {
      audio.src = src
    }
    if (audio.paused) {
      audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    } else {
      audio.pause()
      setPlaying(false)
    }
  }

  const seekAudio = useCallback((timeSeconds) => {
    if (audioRef.current) audioRef.current.currentTime = timeSeconds
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((current) => current === 'dark' ? 'light' : 'dark')
  }, [])

  const toggleLocale = useCallback(() => {
    setLocale((current) => current === 'en' ? 'zh-CN' : 'en')
  }, [])

  const selectIntent = useCallback((nextIntent) => {
    if (nextIntent === intent) return
    setIntent(nextIntent)
    noteEditedRef.current = false
    setPatchNote(defaultIntentNotes[nextIntent] ?? '')
  }, [intent])

  if (!view || !project) {
    return (
      <main className="app-shell loading-shell">
        <Loader2 className="spin" size={20} />
        <span>{status}</span>
      </main>
    )
  }

  const selectedIntent = intentOptions.find((item) => item.id === intent)
  const audioSrc = currentVersion?.audioPath ? fileUrl(currentVersion.audioPath) : ''
  const activeRange = selectedSegment
    ? `${msLabel(selectedSegment.startMs)} - ${msLabel(selectedSegment.endMs)}`
    : t('drawer.noSelection')

  return (
    <main className="app-shell" data-theme={theme}>
      <section className="plugin-panel" aria-label="SoundCue">
        <header className="panel-header">
          <div className="title-cluster">
              <div className="app-icon"><AudioLines size={18} /></div>
            <div>
              <h1>SoundCue</h1>
              <p>{t('app.conversation')} · {project.currentVersionId ?? t('app.noVersion')}</p>
            </div>
          </div>
          <div className="header-actions">
            <div className="segmented">
              <button className={mode === 'review' ? 'active' : ''} onClick={() => setMode('review')}>{t('nav.review')}</button>
              <button className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>{t('nav.suggestedEdit')}</button>
              <button className={mode === 'runtime' ? 'active' : ''} onClick={() => setMode('runtime')}>{t('nav.settings')}</button>
            </div>
            <button className="icon-action" onClick={() => openFolder('project')} title={t('app.openProjectFolder')}>
              <FolderOpen size={17} />
            </button>
            <button
              className="icon-action language-action"
              onClick={toggleLocale}
              title={locale === 'en' ? t('app.switchToChinese') : t('app.switchToEnglish')}
              aria-label={locale === 'en' ? t('app.switchToChinese') : t('app.switchToEnglish')}
            >
              <Languages size={16} />
            </button>
            <button className="icon-action" onClick={toggleTheme} title={theme === 'dark' ? t('app.useLightMode') : t('app.useDarkMode')}>
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </header>

        <section className="import-row">
          <label className="import-button">
            <Upload size={15} />
            {t('actions.importAudio')}
            <input type="file" accept="audio/*" onChange={(event) => importAudio(event.target.files?.[0])} />
          </label>
          <button className="quiet-button" onClick={transcribeCurrentVersion} disabled={busy || !currentVersion?.audioPath}>
            <Captions size={15} />
            {t('actions.transcribe')}
          </button>
          <button className="quiet-button" onClick={() => refresh()}>
            <RotateCcw size={15} />
            {t('actions.refresh')}
          </button>
          <span className="status-line">{busy && <Loader2 className="spin" size={14} />} {status}</span>
        </section>

        <section className="content-grid" data-drawer={drawerOpen ? 'open' : 'closed'}>
          <div className="main-view">
            {mode === 'review' ? (
              <TranscriptView
                t={t}
                transcript={transcript}
                transcriptStatus={currentVersion?.transcriptStatus}
                transcriptNote={currentVersion?.transcriptNote}
                selectedSegmentId={selectedSegmentId}
                annotations={annotationsForVersion}
                onSelect={setSelectedSegmentId}
              />
            ) : mode === 'runtime' ? (
              <RuntimeView
                t={t}
                locale={locale}
                setLocale={setLocale}
                runtimeStatus={runtimeStatus}
                runtimeLog={runtimeLog}
                onRefresh={loadRuntimeStatus}
                onInstall={installRuntime}
                onCancel={cancelRuntime}
                onViewLog={viewRuntimeLog}
                onCloseLog={() => setRuntimeLog(null)}
              />
            ) : (
              <PatchPreview
                t={t}
                patch={selectedPatch}
                versions={view.versions}
                currentVersion={currentVersion}
                compareVersionId={compareVersionId}
                setCompareVersionId={setCompareVersionId}
                onPreviewOriginal={() => togglePlay(currentVersion?.audioPath ? fileUrl(currentVersion.audioPath) : '')}
                onPreviewPatch={() => togglePlay(selectedPatch?.operation?.candidateAudioPath ? fileUrl(selectedPatch.operation.candidateAudioPath) : '')}
                onApply={applySelectedPatch}
              />
            )}
          </div>

          <aside className="drawer">
            <button className="drawer-toggle" onClick={() => setDrawerOpen(!drawerOpen)}>
              <ChevronRight size={16} />
            </button>
            {drawerOpen && (
              <div className="drawer-body">
                <div className="drawer-head">
                  <MessageSquare size={16} />
                  <strong>{t('drawer.editNotes')}</strong>
                </div>
                <div className="selection-card">
                  <span>{t('drawer.selectedRange')}</span>
                  <strong>{activeRange}</strong>
                  <p>{selectedSegment?.text ?? t('drawer.selectSegment')}</p>
                </div>
                <div className="intent-grid">
                  {intentOptions.map((option) => {
                    const Icon = option.icon
                    return (
                      <button
                        key={option.id}
                        className={intent === option.id ? 'intent active' : 'intent'}
                        onClick={() => selectIntent(option.id)}
                      >
                        <Icon size={15} />
                        {option.label}
                      </button>
                    )
                  })}
                </div>
                <label className="note-field">
                  <span>{t('drawer.editNote')}</span>
                  <textarea
                    value={patchNote}
                    onChange={(event) => {
                      noteEditedRef.current = true
                      setPatchNote(event.target.value)
                    }}
                  />
                </label>
                <button className="primary-button" onClick={createAnnotation} disabled={busy || !selectedSegment}>
                  <MessageSquare size={16} />
                  {t('actions.saveAnnotation')}
                </button>
                {latestAnnotation && (
                  <div className="handoff-card" data-state={latestEditBrief ? 'sent' : 'ready'}>
                    <span>{t('drawer.editBrief')}</span>
                    <p>{latestEditBrief ? t('drawer.briefSaved') : t('drawer.briefReady')}</p>
                    <div className="handoff-items">
                      <small><FileAudio size={13} /> {t('drawer.audioVersion', { version: latestAnnotation.targetVersionId })}</small>
                      <small><Clock3 size={13} /> {msLabel(latestAnnotation.range.startMs)} - {msLabel(latestAnnotation.range.endMs)}</small>
                      <small><Captions size={13} /> {t('drawer.transcriptSegment')}</small>
                      <small><MessageSquare size={13} /> {t(`intent.${latestAnnotation.intent.type}.label`)}</small>
                    </div>
                    {latestEditBrief && <code>{latestEditBrief.requestId}</code>}
                  </div>
                )}
                <div className="brief-actions">
                  <button className="secondary-button" onClick={prepareEditBrief} disabled={busy || !latestAnnotation}>
                    <FileAudio size={16} />
                    {latestEditBrief ? t('actions.updateBrief') : t('actions.prepareBrief')}
                  </button>
                  <button className="secondary-button" onClick={copyEditBrief} disabled={!latestEditBrief}>
                    <Copy size={16} />
                    {t('actions.copyBrief')}
                  </button>
                </div>
                {briefClipboardText && (
                  <label className="brief-draft">
                    <span>{t('drawer.composerDraft')}</span>
                    <textarea ref={briefDraftRef} value={briefClipboardText} readOnly />
                  </label>
                )}
                <div className="comment-list">
                  {annotationsForVersion.map((annotation) => (
                    <article key={annotation.annotationId} className="comment-card">
                      <span>{t(`intent.${annotation.intent.type}.label`)}</span>
                      <p>{annotation.intent.note || annotation.range.selectedText}</p>
                      <small>{msLabel(annotation.range.startMs)} · {displayAnnotationStatus(annotation.status, t)}</small>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </section>

        <footer className="player">
          <audio
            ref={(node) => {
              audioRef.current = node
              setAudioElement(node)
            }}
          />
          <button className="play-button" onClick={() => togglePlay(currentVersion?.audioPath ? fileUrl(currentVersion.audioPath) : '')}>
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <div className="player-meta">
            <strong>{msLabel(currentTimeMs)} / {msLabel(playbackDurationMs || currentVersion?.durationMs || 0)}</strong>
            <span>{activeRange} · {selectedIntent?.label ?? t('preview.suggestedEdit')} · {displayVersionLabel(currentVersion, t)}</span>
          </div>
          <Waveform
            src={audioSrc}
            mediaElement={audioElement}
            peaks={currentVersion?.peaks}
            selected={selectedSegment}
            durationMs={currentVersion?.durationMs}
            onSeek={seekAudio}
            theme={theme}
          />
          <div className="player-actions">
            <button className="mini-button" onClick={() => selectedPatch && togglePlay(fileUrl(selectedPatch.operation.candidateAudioPath))}>
              {t('actions.previewEdit')}
            </button>
            <button className="apply-button" onClick={applySelectedPatch} disabled={!selectedPatch || selectedPatch.review?.status === 'applied'}>
              {t('actions.createVersion')}
            </button>
          </div>
        </footer>
      </section>
    </main>
  )
}

function RuntimeView({ t, locale, setLocale, runtimeStatus, runtimeLog, onRefresh, onInstall, onCancel, onViewLog, onCloseLog }) {
  const runtimes = runtimeStatus?.runtimes ?? []
  return (
    <div className="runtime-view">
      <div className="doc-header">
        <h2>{t('settings.title')}</h2>
        <button className="mini-button" onClick={onRefresh}>
          <RotateCcw size={14} />
          {t('actions.refresh')}
        </button>
      </div>
      <section className="settings-section">
        <div>
          <strong>{t('settings.language')}</strong>
          <p>{t('settings.languageBody')}</p>
        </div>
        <div className="language-options" role="group" aria-label={t('settings.language')}>
          {supportedLocales.map((option) => (
            <button
              key={option.id}
              className={locale === option.id ? 'active' : ''}
              onClick={() => setLocale(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>
      <section className="runtime-intro">
        <Info size={16} />
        <p>{t('settings.runtimeIntro')}</p>
      </section>
      {!runtimeStatus && (
        <section className="runtime-loading">
          <Loader2 className="spin" size={18} />
          <span>{t('settings.checkingTools')}</span>
        </section>
      )}
      <div className="runtime-grid">
        {runtimes.map((runtime) => (
          <RuntimeCard
            key={runtime.id}
            t={t}
            runtime={runtime}
            onInstall={() => onInstall(runtime.id)}
            onCancel={() => onCancel(runtime.id)}
            onViewLog={() => onViewLog(runtime.id)}
          />
        ))}
      </div>
      {runtimeLog && (
        <section className="runtime-log">
          <div className="runtime-log-head">
            <div>
              <span>{t('settings.installLog')}</span>
              <strong>{runtimeLog.runtimeId}</strong>
            </div>
            <button className="mini-button" onClick={onCloseLog}>{t('actions.close')}</button>
          </div>
          {runtimeLog.logPath && <code>{runtimeLog.logPath}</code>}
          <pre>{runtimeLog.text || t('settings.noLog')}</pre>
        </section>
      )}
    </div>
  )
}

function RuntimeCard({ t, runtime, onInstall, onCancel, onViewLog }) {
  const job = runtime.job
  const isWorking = job && ['installing', 'verifying'].includes(job.state)
  const isReady = ['ready', 'enabled', 'external_configured'].includes(runtime.state)
  const Icon = runtimeStateIcon(runtime.state, isWorking)
  const runtimeTitle = t(`runtime.card.${runtime.id}.title`) || runtime.title
  const runtimeDescription = t(`runtime.card.${runtime.id}.description`) || runtime.description
  const runtimeInstallLabel = t(`runtime.card.${runtime.id}.installLabel`)
  const runtimeManualSetup = t(`runtime.card.${runtime.id}.manualSetup`)
  const actionLabel = runtime.state === 'failed' ? t('actions.repair') : (runtimeInstallLabel.startsWith('runtime.') ? runtime.installLabel : runtimeInstallLabel) || t('actions.install')
  return (
    <article className="runtime-card" data-state={isWorking ? 'installing' : runtime.state}>
      <div className="runtime-card-head">
        <div>
          <strong>{runtimeTitle.startsWith('runtime.') ? runtime.title : runtimeTitle}</strong>
          <span>{t(`runtime.level.${runtime.level}`)}</span>
        </div>
        <span className="runtime-state">
          <Icon className={isWorking ? 'spin' : ''} size={16} />
          {isWorking ? job.phase : runtimeStateLabel(runtime.state, t)}
        </span>
      </div>
      <p>{runtimeDescription.startsWith('runtime.') ? runtime.description : runtimeDescription}</p>
      {runtime.warning && <p className="runtime-warning">{runtime.warning}</p>}
      <dl className="runtime-meta">
        <div>
          <dt>{t('runtime.meta.detail')}</dt>
          <dd>{runtime.detail}</dd>
        </div>
        {runtime.version && (
          <div>
            <dt>{t('runtime.meta.version')}</dt>
            <dd>{runtime.version}</dd>
          </div>
        )}
        {runtime.configuredPath && (
          <div>
            <dt>{t('runtime.meta.path')}</dt>
            <dd>{runtime.configuredPath}</dd>
          </div>
        )}
        {runtime.sizeBytes && (
          <div>
            <dt>{t('runtime.meta.size')}</dt>
            <dd>{formatBytes(runtime.sizeBytes)}</dd>
          </div>
        )}
      </dl>
      {isWorking && (
        <div className="install-progress" role="status" aria-live="polite">
          <div className="progress-line">
            <span>{job.step}</span>
            <small>{formatElapsed(job.elapsedMs)}</small>
          </div>
          <div className="progress-track">
            <span style={{ width: job.progress ? `${Math.round(job.progress * 100)}%` : undefined }} />
          </div>
          <p>{runtime.id === 'voice-openvoice' ? t('runtime.progress.openvoice') : t('runtime.progress.default')}</p>
        </div>
      )}
      {job?.state === 'failed' && (
        <div className="runtime-error">
          <XCircle size={15} />
          <span>{job.error || t('runtime.progress.failed')}</span>
        </div>
      )}
      <div className="runtime-actions">
        {runtime.installable && !isReady && (
          <button className="primary-button" onClick={onInstall} disabled={isWorking}>
            {isWorking ? <Loader2 className="spin" size={15} /> : null}
            {isWorking ? t('actions.installing') : actionLabel}
          </button>
        )}
        {isWorking && (
          <button className="secondary-button" onClick={onCancel}>
            {t('actions.cancel')}
          </button>
        )}
        <button className="secondary-button" onClick={onViewLog}>
          {t('actions.viewLogs')}
        </button>
      </div>
      {runtime.manualSetup && !isReady && (
        <small className="manual-setup">{runtimeManualSetup.startsWith('runtime.') ? runtime.manualSetup : runtimeManualSetup}</small>
      )}
    </article>
  )
}

function runtimeStateIcon(state, working) {
  if (working) return Loader2
  if (['ready', 'enabled', 'external_configured'].includes(state)) return CheckCircle2
  if (state === 'failed') return XCircle
  return Info
}

function runtimeStateLabel(state, t) {
  return messageExists('en', `runtime.state.${state}`) ? t(`runtime.state.${state}`) : state
}

function formatBytes(bytes) {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatElapsed(ms = 0) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`
}

const TranscriptSegment = memo(function TranscriptSegment({ segment, active, hasAnnotation, onSelect }) {
  return (
    <button
      className={active ? 'segment active' : 'segment'}
      onClick={() => onSelect(segment.segmentId)}
    >
      <span className="timestamp"><Clock3 size={13} />{msLabel(segment.startMs)}</span>
      <p>{segment.text}</p>
      {hasAnnotation && <span className="anchor-dot" />}
    </button>
  )
})

const TranscriptView = memo(function TranscriptView({ t, transcript, transcriptStatus, transcriptNote, selectedSegmentId, annotations, onSelect }) {
  const hasSegments = transcript.segments.length > 0
  const annotatedSegmentIds = useMemo(() => {
    return new Set(annotations.flatMap((annotation) => annotation.range.segmentIds ?? []))
  }, [annotations])
  return (
    <div className="transcript-doc">
      <div className="doc-header">
        <h2>{t('transcript.title')}</h2>
        <span>{hasSegments ? t('transcript.segments', { count: transcript.segments.length }) : transcriptStatusLabel(transcriptStatus, t)}</span>
      </div>
      {!hasSegments && (
        <section className="empty-transcript">
          <FileAudio size={20} />
          <h3>{transcriptStatusLabel(transcriptStatus, t)}</h3>
          <p>{transcriptNote || t('transcript.emptyHint')}</p>
        </section>
      )}
      {transcript.segments.map((segment) => {
        return (
          <TranscriptSegment
            key={segment.segmentId}
            segment={segment}
            active={segment.segmentId === selectedSegmentId}
            hasAnnotation={annotatedSegmentIds.has(segment.segmentId)}
            onSelect={onSelect}
          />
        )
      })}
    </div>
  )
})

function transcriptStatusLabel(status, t) {
  return messageExists('en', `transcript.status.${status}`) ? t(`transcript.status.${status}`) : t('transcript.status.fallback')
}

function PatchPreview({ t, patch, versions, currentVersion, compareVersionId, setCompareVersionId, onPreviewOriginal, onPreviewPatch, onApply }) {
  if (!patch) {
    return (
      <div className="empty-preview">
        <ListRestart size={22} />
        <h2>{t('preview.emptyTitle')}</h2>
        <p>{t('preview.emptyBody')}</p>
      </div>
    )
  }
  const baseVersion = versions.find((version) => version.versionId === compareVersionId)
    ?? versions.find((version) => version.versionId === patch.baseVersionId)
    ?? currentVersion
  return (
    <div className="patch-preview">
      <div className="doc-header mr-header">
        <div>
          <h2>{t('preview.title')}</h2>
          <span className="status-pill">{patch.review?.status ?? 'ready'}</span>
        </div>
        <label>
          {t('preview.compareWith')}
          <select value={compareVersionId ?? ''} onChange={(event) => setCompareVersionId(event.target.value)}>
            {versions.map((version) => (
              <option key={version.versionId} value={version.versionId}>{version.versionId} · {displayVersionLabel(version, t)}</option>
            ))}
          </select>
        </label>
      </div>
      <section className="mr-summary">
        <span>{t('preview.summary')}</span>
        <strong>{patch.review?.summary?.[0] ?? t('preview.summaryReady')}</strong>
        <ul>
          {(patch.review?.summary ?? []).map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>
      <div className="ab-grid">
        <PreviewCard
          t={t}
          title={`${t('preview.original')} · ${baseVersion?.versionId ?? patch.baseVersionId}`}
          subtitle={displayVersionLabel(baseVersion, t)}
          src={baseVersion?.audioPath ? fileUrl(baseVersion.audioPath) : ''}
          onPlay={onPreviewOriginal}
        />
        <PreviewCard
          t={t}
          title={t('preview.suggestedEdit')}
          subtitle={t('preview.candidateAudio')}
          src={patch.operation?.candidateAudioPath ? fileUrl(patch.operation.candidateAudioPath) : ''}
          onPlay={onPreviewPatch}
          accent
        />
      </div>
      <section className="transcript-change">
        <span>{t('preview.transcriptChange')}</span>
        <p>{patch.operation.candidateTranscript || t('preview.removedSection')}</p>
      </section>
      <div className="preview-actions">
        <button className="secondary-button">{t('actions.reviseNote')}</button>
        <button className="primary-button" onClick={onApply} disabled={patch.review?.status === 'applied'}>
          {t('actions.createVersion')}
        </button>
      </div>
    </div>
  )
}

function PreviewCard({ t, title, subtitle, src, accent = false }) {
  const audioRef = useRef(null)
  const [audioElement, setAudioElement] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [durationMs, setDurationMs] = useState(1000)

  useEffect(() => {
    const audio = audioElement
    if (!audio) return undefined
    const syncTime = () => setCurrentTimeMs(Math.round((audio.currentTime || 0) * 1000))
    const syncDuration = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDurationMs(Math.round(audio.duration * 1000))
    }
    const onPlayEvent = () => setPlaying(true)
    const onPauseEvent = () => setPlaying(false)
    audio.addEventListener('timeupdate', syncTime)
    audio.addEventListener('loadedmetadata', syncDuration)
    audio.addEventListener('durationchange', syncDuration)
    audio.addEventListener('play', onPlayEvent)
    audio.addEventListener('pause', onPauseEvent)
    audio.addEventListener('ended', onPauseEvent)
    return () => {
      audio.removeEventListener('timeupdate', syncTime)
      audio.removeEventListener('loadedmetadata', syncDuration)
      audio.removeEventListener('durationchange', syncDuration)
      audio.removeEventListener('play', onPlayEvent)
      audio.removeEventListener('pause', onPauseEvent)
      audio.removeEventListener('ended', onPauseEvent)
    }
  }, [audioElement])

  function toggle() {
    if (!audioRef.current || !src) return
    if (audioRef.current.paused) audioRef.current.play().catch(() => setPlaying(false))
    else audioRef.current.pause()
  }

  return (
    <article className={accent ? 'preview-card accent' : 'preview-card'}>
      <div className="preview-card-head">
        <div>
          <strong>{title}</strong>
          <span>{subtitle ?? t('preview.localPreview')} · {msLabel(currentTimeMs)} / {msLabel(durationMs)}</span>
        </div>
        <button onClick={toggle} disabled={!src}>{playing ? <Pause size={16} /> : <Play size={16} />}{playing ? t('actions.pause') : t('actions.play')}</button>
      </div>
      <audio
        ref={(node) => {
          audioRef.current = node
          setAudioElement(node)
        }}
        src={src}
      />
      <Waveform
        src={src}
        mediaElement={audioElement}
        durationMs={durationMs}
        onSeek={(timeSeconds) => {
          if (audioRef.current) audioRef.current.currentTime = timeSeconds
        }}
      />
    </article>
  )
}

function Waveform({ src, mediaElement, peaks = [], selected, durationMs = 1, onSeek, theme = document.documentElement.dataset.theme || 'dark' }) {
  const containerRef = useRef(null)
  const regionsRef = useRef(null)
  const readyRef = useRef(false)
  const onSeekRef = useRef(onSeek)
  const fallbackPeaks = useMemo(() => peaks?.length ? peaks : Array.from({ length: 72 }, (_, index) => 0.25 + Math.abs(Math.sin(index * 0.5)) * 0.65), [peaks])
  const startPct = selected ? Math.max(0, Math.min(100, (selected.startMs / durationMs) * 100)) : 18
  const endPct = selected ? Math.max(startPct + 1, Math.min(100, (selected.endMs / durationMs) * 100)) : 38

  useEffect(() => {
    onSeekRef.current = onSeek
  }, [onSeek])

  useEffect(() => {
    if (!containerRef.current || !src) return undefined
    const regions = RegionsPlugin.create()
    regionsRef.current = regions
    readyRef.current = false
    const styles = getComputedStyle(document.documentElement)
    const waveColor = styles.getPropertyValue('--wave').trim() || '#737373'
    const progressColor = styles.getPropertyValue('--wave-progress').trim() || '#111111'
    const cursorColor = styles.getPropertyValue('--wave-cursor').trim() || '#111111'
    const wavesurfer = WaveSurfer.create({
      container: containerRef.current,
      url: src,
      media: mediaElement || undefined,
      height: 44,
      normalize: true,
      fillParent: true,
      cursorWidth: 1,
      cursorColor,
      waveColor,
      progressColor,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      plugins: [regions]
    })

    wavesurfer.on('ready', () => {
      readyRef.current = true
    })
    wavesurfer.on('interaction', (timeSeconds) => {
      onSeekRef.current?.(timeSeconds)
    })
    return () => {
      readyRef.current = false
      regionsRef.current = null
      wavesurfer.destroy()
    }
  }, [src, mediaElement, theme])

  useEffect(() => {
    const regions = regionsRef.current
    if (!regions || !src || !selected) return undefined
    const updateRegion = () => {
      regions.clearRegions()
      regions.addRegion({
        start: Math.max(0, selected.startMs / 1000),
        end: Math.max(selected.startMs / 1000 + 0.1, selected.endMs / 1000),
        color: 'rgba(79, 139, 255, 0.2)',
        drag: false,
        resize: false
      })
    }
    if (readyRef.current) updateRegion()
    else window.setTimeout(updateRegion, 0)
    return undefined
  }, [src, selected?.segmentId, selected?.startMs, selected?.endMs])

  if (src) {
    return <div ref={containerRef} className="waveform waveform-wavesurfer" />
  }

  const values = fallbackPeaks
  return (
    <div className="waveform" style={{ '--start': `${startPct}%`, '--end': `${endPct}%` }}>
      {values.map((value, index) => (
        <span key={index} style={{ height: `${Math.max(14, value * 44)}px` }} />
      ))}
      <div className="selection-range" />
    </div>
  )
}
