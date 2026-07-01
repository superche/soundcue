import { randomUUID, createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const projectsRoot = resolve(process.env.AUDIO_PATCH_PROJECTS_DIR ?? join(process.cwd(), 'audio-patch-projects'))
const threadId = sanitizeId(process.env.AUDIO_PATCH_THREAD_ID ?? process.env.CODEX_THREAD_ID ?? 'local-thread')
const projectDir = join(projectsRoot, threadId)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const storePaths = {
  projectsRoot,
  threadId,
  projectDir,
  projectFile: join(projectDir, 'project.json'),
  assetsDir: join(projectDir, 'assets'),
  versionsDir: join(projectDir, 'versions'),
  transcriptsDir: join(projectDir, 'transcripts'),
  annotationsDir: join(projectDir, 'annotations'),
  codexRequestsDir: join(projectDir, 'codex_requests'),
  patchesDir: join(projectDir, 'patches'),
  exportDir: join(projectDir, 'export')
}

const emptyProject = {
  schemaVersion: 1,
  projectId: `proj_${threadId}`,
  threadId,
  title: 'Untitled SoundCue project',
  currentVersionId: null,
  assets: [],
  versions: [],
  annotations: [],
  codexRequests: [],
  patches: [],
  createdAt: null,
  updatedAt: null
}

export function sanitizeId(value) {
  return String(value || 'local-thread')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'local-thread'
}

function safeName(name, fallback = 'asset.bin') {
  const raw = basename(String(name || fallback))
  const ext = extname(raw) || extname(fallback) || '.bin'
  const base = raw
    .slice(0, raw.length - extname(raw).length)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${base || 'asset'}${ext}`
}

function assertChild(parent, child) {
  const rel = relative(parent, child)
  if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`)) {
    throw new Error(`Unsafe path outside project: ${child}`)
  }
}

async function ensureDirs() {
  await Promise.all([
    mkdir(storePaths.assetsDir, { recursive: true }),
    mkdir(storePaths.versionsDir, { recursive: true }),
    mkdir(storePaths.transcriptsDir, { recursive: true }),
    mkdir(storePaths.annotationsDir, { recursive: true }),
    mkdir(storePaths.codexRequestsDir, { recursive: true }),
    mkdir(storePaths.patchesDir, { recursive: true }),
    mkdir(storePaths.exportDir, { recursive: true })
  ])
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(fallback)
    throw error
  }
}

async function writeJsonAtomic(filePath, payload) {
  await mkdir(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`)
  await rename(tmp, filePath)
}

async function uniquePath(dir, requestedName) {
  await mkdir(dir, { recursive: true })
  const name = safeName(requestedName)
  const ext = extname(name)
  const base = name.slice(0, name.length - ext.length)
  let candidate = join(dir, name)
  let index = 2
  while (true) {
    try {
      await stat(candidate)
      candidate = join(dir, `${base}-${index}${ext}`)
      index += 1
    } catch (error) {
      if (error.code === 'ENOENT') return candidate
      throw error
    }
  }
}

export async function readProject() {
  await ensureDirs()
  const project = await readJson(storePaths.projectFile, emptyProject)
  if (!project.createdAt) {
    const now = new Date().toISOString()
    const seeded = {
      ...emptyProject,
      ...project,
      createdAt: now,
      updatedAt: now
    }
    await writeJsonAtomic(storePaths.projectFile, seeded)
    return hydrateProject(seeded)
  }
  return hydrateProject(project)
}

async function saveProject(project) {
  const next = {
    ...project,
    schemaVersion: 1,
    threadId,
    projectId: project.projectId || `proj_${threadId}`,
    updatedAt: new Date().toISOString()
  }
  await writeJsonAtomic(storePaths.projectFile, next)
  return hydrateProject(next)
}

async function hydrateProject(project) {
  const [versions, annotations, codexRequests, patches] = await Promise.all([
    Promise.all((project.versions ?? []).map((id) => readJson(join(storePaths.versionsDir, `${id}.json`), null))),
    Promise.all((project.annotations ?? []).map((id) => readJson(join(storePaths.annotationsDir, `${id}.json`), null))),
    Promise.all((project.codexRequests ?? []).map((id) => readJson(join(storePaths.codexRequestsDir, `${id}.json`), null))),
    Promise.all((project.patches ?? []).map((id) => readJson(join(storePaths.patchesDir, `${id}.json`), null)))
  ])
  return {
    project,
    versions: versions.filter(Boolean),
    annotations: annotations.filter(Boolean),
    codexRequests: codexRequests.filter(Boolean),
    patches: patches.filter(Boolean),
    paths: storePaths
  }
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(String(dataUrl ?? ''))
  if (!match) throw new Error('Expected dataUrl.')
  const mimeType = match[1] || 'application/octet-stream'
  const encoded = match[2]
  const isBase64 = /^data:[^,]*;base64,/i.test(dataUrl)
  const buffer = isBase64 ? Buffer.from(encoded, 'base64') : Buffer.from(decodeURIComponent(encoded))
  return { buffer, mimeType }
}

function mimeTypeForFile(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.m4a':
      return 'audio/mp4'
    case '.txt':
    case '.md':
      return 'text/plain'
    default:
      return 'application/octet-stream'
  }
}

async function hashFile(filePath) {
  const hash = createHash('sha256')
  await new Promise((resolvePromise, reject) => {
    createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', resolvePromise)
  })
  return hash.digest('hex')
}

function defaultPeaks(count = 72) {
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin(index * 0.7) * 0.45 + Math.sin(index * 0.17) * 0.3
    return Number((0.18 + Math.abs(wave) * 0.75).toFixed(3))
  })
}

function segmentsFromText(text, durationMs = 150000) {
  const clean = String(text || '').trim()
  const chunks = clean
    ? clean.split(/(?<=[.!?。！？])\s+|\n+/).map((chunk) => chunk.trim()).filter(Boolean)
    : [
        'Open with the strongest point instead of a long setup.',
        'Keep this section calm and concise for the listener.',
        'Move into the next idea with a short transition.'
      ]
  const step = Math.max(4500, Math.floor(durationMs / Math.max(1, chunks.length)))
  return chunks.map((textChunk, index) => ({
    segmentId: `seg_${String(index + 1).padStart(3, '0')}`,
    startMs: index * step,
    endMs: Math.min(durationMs, (index + 1) * step - 250),
    speaker: 'Host',
    text: textChunk
  }))
}

function transcriptFromSegments(versionId, segments) {
  return {
    transcriptId: `transcript_${versionId}`,
    versionId,
    language: 'auto',
    segments,
    createdAt: new Date().toISOString()
  }
}

async function writeSilentWav(filePath, durationSeconds = 2) {
  const sampleRate = 16000
  const channels = 1
  const bitsPerSample = 16
  const samples = Math.max(1, Math.floor(sampleRate * durationSeconds))
  const dataSize = samples * channels * (bitsPerSample / 8)
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28)
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  await writeFile(filePath, buffer)
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr })
      else reject(new Error(stderr || `${command} exited with ${code}`))
    })
  })
}

function normalizeSttTranscript(payload, versionId, durationMs) {
  if (Array.isArray(payload?.segments)) {
    const segments = payload.segments.map((segment, index) => {
      const hasMsFields = segment.startMs !== undefined || segment.endMs !== undefined
      const rawStart = Number(segment.startMs ?? segment.start ?? 0)
      const rawEnd = Number(segment.endMs ?? segment.end ?? rawStart)
      const startMs = hasMsFields ? Math.round(rawStart) : Math.round(rawStart * 1000)
      const endMs = hasMsFields ? Math.round(rawEnd) : Math.round(rawEnd * 1000)
      const clampedStartMs = Math.max(0, Math.min(durationMs - 1, startMs))
      const clampedEndMs = Math.max(clampedStartMs + 1, Math.min(durationMs, endMs))
      return {
        segmentId: segment.segmentId ?? `seg_${String(index + 1).padStart(3, '0')}`,
        startMs: clampedStartMs,
        endMs: clampedEndMs,
        speaker: segment.speaker ?? 'Speaker',
        text: String(segment.text ?? '').trim()
      }
    }).filter((segment) => segment.text && segment.endMs > segment.startMs)
    return transcriptFromSegments(versionId, segments)
  }
  if (typeof payload?.text === 'string' && payload.text.trim()) {
    return transcriptFromSegments(versionId, segmentsFromText(payload.text, durationMs))
  }
  return transcriptFromSegments(versionId, [])
}

async function transcribeAudio({ audioPath, transcriptPath, versionId, durationMs }) {
  if (!process.env.AUDIO_PATCH_STT_COMMAND) {
    return {
      status: 'unavailable',
      note: 'AUDIO_PATCH_STT_COMMAND is not configured.',
      transcript: transcriptFromSegments(versionId, [])
    }
  }

  const outputPath = `${transcriptPath}.stt.json`
  try {
    const result = await runCommand(process.env.AUDIO_PATCH_STT_COMMAND, [audioPath, outputPath], {
      env: {
        ...process.env,
        AUDIO_PATCH_VERSION_ID: versionId,
        AUDIO_PATCH_DURATION_MS: String(durationMs)
      }
    })
    const raw = await readFile(outputPath, 'utf8').catch(() => result.stdout)
    const payload = JSON.parse(raw)
    const transcript = normalizeSttTranscript(payload, versionId, durationMs)
    return {
      status: transcript.segments.length ? 'ready' : 'unavailable',
      note: transcript.segments.length ? 'Transcribed with AUDIO_PATCH_STT_COMMAND.' : 'STT adapter returned no transcript segments.',
      transcript
    }
  } catch (error) {
    return {
      status: 'failed',
      note: `STT adapter failed: ${error.message}`,
      transcript: transcriptFromSegments(versionId, [])
    }
  }
}

export async function importAudioFromDataUrl({ dataUrl, name, durationMs, peaks = [] }) {
  const parsed = parseDataUrl(dataUrl)
  const filePath = await uniquePath(storePaths.assetsDir, name || `audio-${Date.now()}.bin`)
  await writeFile(filePath, parsed.buffer)
  return createVersionFromAudioPath({
    sourcePath: filePath,
    title: name || basename(filePath),
    mimeType: parsed.mimeType,
    durationMs,
    peaks,
    source: 'browser-upload'
  })
}

export async function importAudioFromPath({ sourcePath, title, durationMs, peaks = [], source = 'mcp-local-path' }) {
  const absolutePath = resolve(sourcePath)
  const sourceStat = await stat(absolutePath)
  if (!sourceStat.isFile()) throw new Error(`sourcePath is not a file: ${absolutePath}`)
  const filePath = await uniquePath(storePaths.assetsDir, basename(absolutePath))
  await copyFile(absolutePath, filePath)
  return createVersionFromAudioPath({
    sourcePath: filePath,
    title: title || basename(filePath),
    mimeType: mimeTypeForFile(filePath),
    durationMs,
    peaks,
    source
  })
}

async function createVersionFromAudioPath({ sourcePath, title, mimeType, durationMs, peaks, source }) {
  const projectView = await readProject()
  const project = projectView.project
  const versionId = `v${(project.versions?.length ?? 0) + 1}`
  const versionPath = join(storePaths.versionsDir, `${versionId}${extname(sourcePath) || '.wav'}`)
  await copyFile(sourcePath, versionPath)
  const duration = Number(durationMs) || 150000
  const transcriptPath = join(storePaths.transcriptsDir, `${versionId}.json`)
  const transcription = await transcribeAudio({ audioPath: versionPath, transcriptPath, versionId, durationMs: duration })
  if (transcription.status !== 'failed') {
    await writeJsonAtomic(transcriptPath, transcription.transcript)
  }
  const asset = {
    assetId: `asset_${randomUUID()}`,
    name: basename(sourcePath),
    path: sourcePath,
    mimeType,
    sha256: await hashFile(sourcePath),
    source,
    createdAt: new Date().toISOString()
  }
  const version = {
    versionId,
    label: versionId === 'v1' ? 'Original' : `Version ${versionId}`,
    baseVersionId: null,
    audioPath: versionPath,
    transcriptPath,
    durationMs: duration,
    peaks: peaks?.length ? peaks : defaultPeaks(),
    transcriptStatus: transcription.status,
    transcriptNote: transcription.note,
    origin: source,
    createdAt: new Date().toISOString(),
    notes: [`Imported ${title || basename(sourcePath)}`, transcription.note]
  }
  await writeJsonAtomic(join(storePaths.versionsDir, `${versionId}.json`), version)
  const nextProject = await saveProject({
    ...project,
    title: title || project.title,
    currentVersionId: versionId,
    assets: [asset, ...(project.assets ?? [])],
    versions: [...(project.versions ?? []), versionId]
  })
  return nextProject
}

export async function createTextDraft({ title = 'Text draft', text }) {
  const projectView = await readProject()
  const project = projectView.project
  const versionId = `v${(project.versions?.length ?? 0) + 1}`
  const scriptPath = await uniquePath(storePaths.assetsDir, `${title}.md`)
  await writeFile(scriptPath, String(text || ''))
  const segments = segmentsFromText(text, Math.max(30000, String(text || '').length * 70))
  const durationMs = segments.at(-1)?.endMs ?? 30000
  const audioPath = join(storePaths.versionsDir, `${versionId}_text_draft.wav`)
  await synthesizeTextToAudio({ text, outputPath: audioPath, durationMs })
  const transcript = transcriptFromSegments(versionId, segments)
  const transcriptPath = join(storePaths.transcriptsDir, `${versionId}.json`)
  await writeJsonAtomic(transcriptPath, transcript)
  const version = {
    versionId,
    label: versionId === 'v1' ? 'Text draft' : `Text draft ${versionId}`,
    baseVersionId: null,
    audioPath,
    transcriptPath,
    durationMs,
    peaks: defaultPeaks(),
    origin: 'text-draft',
    createdAt: new Date().toISOString(),
    notes: ['Created from text. Local TTS adapter generated a placeholder unless AUDIO_PATCH_TTS_COMMAND is configured.']
  }
  await writeJsonAtomic(join(storePaths.versionsDir, `${versionId}.json`), version)
  return saveProject({
    ...project,
    title,
    currentVersionId: versionId,
    assets: [
      {
        assetId: `asset_${randomUUID()}`,
        name: basename(scriptPath),
        path: scriptPath,
        mimeType: 'text/markdown',
        sha256: await hashFile(scriptPath),
        source: 'text-input',
        createdAt: new Date().toISOString()
      },
      ...(project.assets ?? [])
    ],
    versions: [...(project.versions ?? []), versionId]
  })
}

export async function transcribeVersion({ versionId } = {}) {
  const view = await readProject()
  const project = view.project
  const targetVersionId = versionId || project.currentVersionId
  const version = view.versions.find((item) => item.versionId === targetVersionId)
  if (!version) throw new Error(`Version not found: ${targetVersionId}`)

  const transcriptPath = version.transcriptPath || join(storePaths.transcriptsDir, `${version.versionId}.json`)
  const transcription = await transcribeAudio({
    audioPath: version.audioPath,
    transcriptPath,
    versionId: version.versionId,
    durationMs: version.durationMs || 150000
  })
  if (transcription.status !== 'failed') {
    await writeJsonAtomic(transcriptPath, transcription.transcript)
  }

  const nextVersion = {
    ...version,
    transcriptPath,
    transcriptStatus: transcription.status,
    transcriptNote: transcription.note,
    updatedAt: new Date().toISOString(),
    notes: [...(version.notes ?? []), transcription.note]
  }
  await writeJsonAtomic(join(storePaths.versionsDir, `${version.versionId}.json`), nextVersion)
  return readProject()
}

async function synthesizeTextToAudio({ text, outputPath, durationMs }) {
  if (process.env.AUDIO_PATCH_TTS_COMMAND) {
    const inputPath = `${outputPath}.input.txt`
    await writeFile(inputPath, String(text || ''))
    await runCommand(process.env.AUDIO_PATCH_TTS_COMMAND, [inputPath, outputPath])
    return
  }
  await writeSilentWav(outputPath, Math.max(1.5, Math.min(12, durationMs / 1000)))
}

async function synthesizeReplacementVoice({ text, outputPath, durationMs, referenceAudioPath }) {
  if (process.env.AUDIO_PATCH_VOICE_PROVIDER === 'openvoice' || process.env.AUDIO_PATCH_VOICE_COMMAND) {
    return synthesizeWithVoiceProvider({ text, outputPath, referenceAudioPath })
  }
  return synthesizeTextToAudio({ text, outputPath, durationMs })
}

async function synthesizeWithVoiceProvider({ text, outputPath, referenceAudioPath }) {
  if (!referenceAudioPath) throw new Error('Voice provider requires a referenceAudioPath.')
  const inputPath = `${outputPath}.input.txt`
  await writeFile(inputPath, String(text || ''))
  const command = process.env.AUDIO_PATCH_VOICE_COMMAND || join(packageRoot, 'scripts', 'openvoice-tts.mjs')
  await runCommand(command, [inputPath, referenceAudioPath, outputPath], {
    env: {
      ...process.env,
      AUDIO_PATCH_VOICE_PROVIDER: process.env.AUDIO_PATCH_VOICE_PROVIDER || 'openvoice'
    }
  })
}

async function extractReferenceAudio({ baseVersion, annotation, outputPath }) {
  const startSeconds = Math.max(0, (annotation.range.startMs ?? 0) / 1000)
  const endSeconds = Math.max(startSeconds + 0.5, (annotation.range.endMs ?? annotation.range.startMs + 6000) / 1000)
  const durationSeconds = Math.min(18, Math.max(2.5, endSeconds - startSeconds))
  try {
    await runCommand('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-ss', String(startSeconds),
      '-t', String(durationSeconds),
      '-i', baseVersion.audioPath,
      '-ar', '44100',
      '-ac', '1',
      outputPath
    ])
  } catch {
    await copyFile(baseVersion.audioPath, outputPath)
  }
}

export async function createAnnotation({ targetVersionId, range, intent }) {
  const projectView = await readProject()
  const project = projectView.project
  const annotationId = `ann_${randomUUID()}`
  const annotation = {
    annotationId,
    projectId: project.projectId,
    threadId,
    targetVersionId: targetVersionId || project.currentVersionId,
    range: {
      startMs: Number(range?.startMs ?? 0),
      endMs: Number(range?.endMs ?? 0),
      segmentIds: range?.segmentIds ?? [],
      selectedText: range?.selectedText ?? ''
    },
    intent: {
      type: intent?.type ?? 'shorten',
      note: intent?.note ?? '',
      constraints: intent?.constraints ?? ['keep_meaning', 'natural_transition']
    },
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  await writeJsonAtomic(join(storePaths.annotationsDir, `${annotationId}.json`), annotation)
  return saveProject({
    ...project,
    annotations: [annotationId, ...(project.annotations ?? [])]
  })
}

export async function createCodexRequest({ annotationId } = {}) {
  const view = await readProject()
  const project = view.project
  const annotation = view.annotations.find((item) => item.annotationId === annotationId)
    ?? view.annotations.find((item) => item.targetVersionId === project.currentVersionId)
  if (!annotation) throw new Error('No annotation available to prepare an edit brief.')

  const version = view.versions.find((item) => item.versionId === annotation.targetVersionId)
  const transcript = version?.transcriptPath
    ? await readJson(version.transcriptPath, transcriptFromSegments(annotation.targetVersionId, []))
    : transcriptFromSegments(annotation.targetVersionId, [])
  const selectedSegments = (transcript.segments ?? []).filter((segment) => {
    if (annotation.range.segmentIds?.includes(segment.segmentId)) return true
    return segment.endMs > annotation.range.startMs && segment.startMs < annotation.range.endMs
  })
  const requestId = `edit_brief_${randomUUID()}`
  const contextPackage = {
    kind: 'audio_edit_brief',
    transport: 'local_project_files',
    inputs: {
      audio: {
        versionId: version?.versionId ?? annotation.targetVersionId,
        path: version?.audioPath ?? null,
        durationMs: version?.durationMs ?? null
      },
      transcript: {
        path: version?.transcriptPath ?? null,
        selectedSegments
      },
      annotation: {
        annotationId: annotation.annotationId,
        range: annotation.range,
        intent: annotation.intent
      }
    },
    expectedOutput: {
      type: 'user_approved_audio_edit',
      reviewOnly: true
    }
  }
  const request = {
    requestId,
    projectId: project.projectId,
    threadId,
    interactionMode: 'audio_edit_brief',
    annotationId: annotation.annotationId,
    targetVersionId: annotation.targetVersionId,
    audioPath: version?.audioPath ?? null,
    transcriptPath: version?.transcriptPath ?? null,
    range: annotation.range,
    intent: annotation.intent,
    contextPackage,
    status: 'brief_ready',
    prompt: [
      'SoundCue edit brief. This is a reviewed input package, not permission to edit automatically.',
      `Audio file: ${version?.audioPath ?? 'missing'}`,
      `Transcript file: ${version?.transcriptPath ?? 'missing'}`,
      `Selected range: ${formatMs(annotation.range.startMs)}-${formatMs(annotation.range.endMs)}`,
      `Edit intent: ${annotation.intent.type}`,
      annotation.intent.note ? `Edit note: ${annotation.intent.note}` : 'Edit note: none',
      `Annotation id: ${annotation.annotationId}`,
      'A later edit step must be explicitly user-approved.'
    ].join('\n'),
    createdAt: new Date().toISOString()
  }
  await writeJsonAtomic(join(storePaths.codexRequestsDir, `${requestId}.json`), request)
  const updatedAnnotation = { ...annotation, status: 'brief_ready', codexRequestId: requestId, updatedAt: new Date().toISOString() }
  await writeJsonAtomic(join(storePaths.annotationsDir, `${annotation.annotationId}.json`), updatedAnnotation)
  return saveProject({
    ...project,
    codexRequests: [requestId, ...(project.codexRequests ?? [])]
  })
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, key)
}

function normalizeSummary(summary) {
  if (Array.isArray(summary)) return summary.map((item) => String(item || '').trim()).filter(Boolean)
  if (typeof summary === 'string' && summary.trim()) return [summary.trim()]
  return []
}

function normalizeEditPlan(args = {}, annotation) {
  const plan = args.editPlan && typeof args.editPlan === 'object' ? args.editPlan : {}
  const hasCandidateTranscript = hasOwn(args, 'candidateTranscript') || hasOwn(plan, 'candidateTranscript')
  const operationType = String(args.operationType ?? plan.operationType ?? 'replace_range')
  const shouldDelete = operationType === 'delete_range' || annotation.intent.type === 'delete' || annotation.intent.type === 'cut'
  const fallbackTranscript = rewriteSelectedText(annotation.range.selectedText, annotation.intent)
  const candidateTranscript = shouldDelete
    ? ''
    : hasCandidateTranscript
      ? String(args.candidateTranscript ?? plan.candidateTranscript ?? '')
      : fallbackTranscript
  const summary = normalizeSummary(args.summary ?? plan.summary)
  const crossfadeMs = Number(args.crossfadeMs ?? plan.crossfadeMs ?? 300)
  const source = args.editPlan || hasCandidateTranscript || args.operationType || args.summary || args.crossfadeMs
    ? 'codex_approved_plan'
    : 'local_heuristic'
  return {
    source,
    operationType: shouldDelete ? 'delete_range' : 'replace_range',
    candidateTranscript,
    summary,
    rationale: plan.rationale ? String(plan.rationale) : null,
    voiceProvider: plan.voiceProvider ? String(plan.voiceProvider) : null,
    crossfadeMs: Number.isFinite(crossfadeMs) ? Math.max(0, Math.min(2000, Math.round(crossfadeMs))) : 300,
    raw: source === 'codex_approved_plan'
      ? {
          ...plan,
          ...(hasOwn(args, 'candidateTranscript') ? { candidateTranscript: args.candidateTranscript } : {}),
          ...(args.operationType ? { operationType: args.operationType } : {}),
          ...(args.summary ? { summary: args.summary } : {}),
          ...(args.crossfadeMs ? { crossfadeMs: args.crossfadeMs } : {})
        }
      : null
  }
}

export async function generatePatchCandidate(args = {}) {
  const { annotationId } = args
  const view = await readProject()
  const project = view.project
  const annotation = view.annotations.find((item) => item.annotationId === annotationId)
  if (!annotation) throw new Error(`Annotation not found: ${annotationId}`)
  const baseVersion = view.versions.find((item) => item.versionId === annotation.targetVersionId)
    ?? view.versions.find((item) => item.versionId === project.currentVersionId)
  if (!baseVersion) throw new Error('No base version available.')

  const patchId = `patch_${randomUUID()}`
  const patchDir = join(storePaths.patchesDir, patchId)
  await mkdir(patchDir, { recursive: true })
  const previewPath = join(patchDir, 'preview.wav')
  const referencePath = join(patchDir, 'reference.wav')
  const selectedDuration = Math.max(1000, annotation.range.endMs - annotation.range.startMs)
  const editPlan = normalizeEditPlan(args, annotation)
  const candidateTranscript = editPlan.candidateTranscript
  await extractReferenceAudio({ baseVersion, annotation, outputPath: referencePath })
  if (candidateTranscript && (process.env.AUDIO_PATCH_VOICE_PROVIDER === 'openvoice' || process.env.AUDIO_PATCH_VOICE_COMMAND)) {
    await synthesizeReplacementVoice({
      text: candidateTranscript,
      outputPath: previewPath,
      durationMs: Math.max(1000, Math.floor(selectedDuration * 0.62)),
      referenceAudioPath: referencePath
    })
  } else if (!candidateTranscript) {
    await writeSilentWav(previewPath, 0.2)
  } else {
    await synthesizeTextToAudio({
      text: candidateTranscript,
      outputPath: previewPath,
      durationMs: Math.max(1000, Math.floor(selectedDuration * 0.62))
    })
  }
  const patch = {
    patchId,
    projectId: project.projectId,
    threadId,
    annotationId,
    baseVersionId: baseVersion.versionId,
    operation: {
      type: editPlan.operationType,
      range: {
        startMs: annotation.range.startMs,
        endMs: annotation.range.endMs
      },
      candidateAudioPath: previewPath,
      candidateTranscript,
      crossfadeMs: editPlan.crossfadeMs,
      voiceProvider: editPlan.voiceProvider || process.env.AUDIO_PATCH_VOICE_PROVIDER || (process.env.AUDIO_PATCH_VOICE_COMMAND ? 'custom' : 'placeholder'),
      referenceAudioPath: referencePath,
      editPlan: {
        source: editPlan.source,
        rationale: editPlan.rationale,
        raw: editPlan.raw
      }
    },
    review: {
      status: 'ready',
      summary: [
        ...editPlan.summary,
        `${labelForIntent(annotation.intent.type)} candidate generated`,
        `Range ${formatMs(annotation.range.startMs)}-${formatMs(annotation.range.endMs)}`,
        `Plan source: ${editPlan.source}`,
        `Voice provider: ${editPlan.voiceProvider || process.env.AUDIO_PATCH_VOICE_PROVIDER || (process.env.AUDIO_PATCH_VOICE_COMMAND ? 'custom' : 'placeholder')}`,
        'Preview audio is local and non-destructive'
      ]
    },
    createdAt: new Date().toISOString(),
    appliedVersionId: null
  }
  await writeJsonAtomic(join(storePaths.patchesDir, `${patchId}.json`), patch)
  const updatedAnnotation = { ...annotation, status: 'patch_ready', patchId, updatedAt: new Date().toISOString() }
  await writeJsonAtomic(join(storePaths.annotationsDir, `${annotationId}.json`), updatedAnnotation)
  return saveProject({
    ...project,
    patches: [patchId, ...(project.patches ?? [])]
  })
}

function rewriteSelectedText(text, intent = {}) {
  const source = String(text || '').trim() || 'Selected audio section'
  if (intent.type === 'delete' || intent.type === 'cut') return ''
  if (intent.type === 'rewrite') return intent.note ? intent.note.replace(/^rewrite[:：]?\s*/i, '') : source
  if (intent.type === 'revoice') return source
  if (intent.type === 'keep') return source
  const words = source.split(/\s+/)
  if (words.length > 14) return `${words.slice(0, 14).join(' ')}.`
  return source
}

function labelForIntent(intent) {
  return {
    cut: 'Cut',
    delete: 'Delete',
    shorten: 'Shorten',
    rewrite: 'Rewrite',
    revoice: 'Revoice',
    keep: 'Keep',
    issue: 'Issue'
  }[intent] ?? 'Edit'
}

function formatMs(ms) {
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`
  const total = Math.floor(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export async function applyPatch({ patchId }) {
  const view = await readProject()
  const project = view.project
  const patch = view.patches.find((item) => item.patchId === patchId)
  if (!patch) throw new Error(`Patch not found: ${patchId}`)
  const baseVersion = view.versions.find((item) => item.versionId === patch.baseVersionId)
  if (!baseVersion) throw new Error(`Base version not found: ${patch.baseVersionId}`)
  const versionId = `v${(project.versions?.length ?? 0) + 1}`
  const versionPath = join(storePaths.versionsDir, `${versionId}_patched.wav`)
  await renderPatchedVersion({ baseVersion, patch, outputPath: versionPath })
  const baseTranscript = await readJson(baseVersion.transcriptPath, transcriptFromSegments(baseVersion.versionId, []))
  const nextTranscript = patchTranscript(baseTranscript, patch, versionId)
  const transcriptPath = join(storePaths.transcriptsDir, `${versionId}.json`)
  await writeJsonAtomic(transcriptPath, nextTranscript)
  const version = {
    versionId,
    label: `Edit ${versionId}`,
    baseVersionId: baseVersion.versionId,
    patchId,
    audioPath: versionPath,
    transcriptPath,
    durationMs: await probeAudioDurationMs(versionPath).catch(() => baseVersion.durationMs),
    peaks: baseVersion.peaks ?? defaultPeaks(),
    origin: 'patch-apply',
    createdAt: new Date().toISOString(),
    notes: patch.review?.summary ?? []
  }
  await writeJsonAtomic(join(storePaths.versionsDir, `${versionId}.json`), version)
  const updatedPatch = { ...patch, appliedVersionId: versionId, review: { ...patch.review, status: 'applied' } }
  await writeJsonAtomic(join(storePaths.patchesDir, `${patchId}.json`), updatedPatch)
  await copyFile(versionPath, join(storePaths.exportDir, 'final.wav')).catch(() => {})
  await writeJsonAtomic(join(storePaths.exportDir, 'edit_log.json'), {
    projectId: project.projectId,
    currentVersionId: versionId,
    appliedPatchId: patchId,
    generatedAt: new Date().toISOString(),
    versions: [...(project.versions ?? []), versionId]
  })
  return saveProject({
    ...project,
    currentVersionId: versionId,
    versions: [...(project.versions ?? []), versionId]
  })
}

async function renderPatchedVersion({ baseVersion, patch, outputPath }) {
  const range = patch.operation?.range ?? {}
  const startSeconds = Math.max(0, Number(range.startMs ?? 0) / 1000)
  const endSeconds = Math.max(startSeconds, Number(range.endMs ?? range.startMs ?? 0) / 1000)
  const patchDir = join(storePaths.patchesDir, patch.patchId)
  const renderDir = join(patchDir, `render_${randomUUID()}`)
  const parts = []
  await mkdir(renderDir, { recursive: true })

  if (startSeconds > 0.01) {
    const beforePath = join(renderDir, 'before.wav')
    await normalizeAudioPart({
      inputPath: baseVersion.audioPath,
      outputPath: beforePath,
      inputArgs: ['-t', String(startSeconds)]
    })
    parts.push(beforePath)
  }

  if (patch.operation?.candidateTranscript !== '' && patch.operation?.candidateAudioPath) {
    const replacementPath = join(renderDir, 'replacement.wav')
    await normalizeAudioPart({
      inputPath: patch.operation.candidateAudioPath,
      outputPath: replacementPath
    })
    parts.push(replacementPath)
  }

  const baseDurationSeconds = Math.max(endSeconds, (baseVersion.durationMs ?? 0) / 1000)
  if (endSeconds < baseDurationSeconds - 0.01) {
    const afterPath = join(renderDir, 'after.wav')
    await normalizeAudioPart({
      inputPath: baseVersion.audioPath,
      outputPath: afterPath,
      inputArgs: ['-ss', String(endSeconds)]
    })
    parts.push(afterPath)
  }

  if (!parts.length) {
    await writeSilentWav(outputPath, 0.2)
    return patch
  }

  const listPath = join(renderDir, 'concat.txt')
  await writeFile(listPath, parts.map((part) => `file '${part.replaceAll("'", "'\\''")}'`).join('\n'))
  await runCommand('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c:a', 'pcm_s16le',
    outputPath
  ])
  return patch
}

async function normalizeAudioPart({ inputPath, outputPath, inputArgs = [] }) {
  await runCommand('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    ...inputArgs,
    '-i', inputPath,
    '-ar', '44100',
    '-ac', '2',
    '-c:a', 'pcm_s16le',
    outputPath
  ])
}

async function probeAudioDurationMs(filePath) {
  const { stdout } = await runCommand('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath
  ])
  const seconds = Number(stdout.trim())
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Unable to probe audio duration: ${filePath}`)
  return Math.round(seconds * 1000)
}

function patchTranscript(baseTranscript, patch, versionId) {
  const segments = (baseTranscript.segments ?? []).map((segment) => {
    const overlaps = segment.endMs > patch.operation.range.startMs && segment.startMs < patch.operation.range.endMs
    if (!overlaps) return { ...segment }
    return {
      ...segment,
      text: patch.operation.candidateTranscript || '[removed]',
      patchId: patch.patchId
    }
  })
  return transcriptFromSegments(versionId, segments)
}

export async function openFolder(kind = 'project') {
  const target = kind === 'export' ? storePaths.exportDir : storePaths.projectDir
  assertChild(storePaths.projectsRoot, target)
  await mkdir(target, { recursive: true })
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  await runCommand(command, [target]).catch(() => null)
  return { path: target }
}

export async function readTranscript(versionId) {
  const view = await readProject()
  const version = view.versions.find((item) => item.versionId === versionId)
  if (!version) throw new Error(`Version not found: ${versionId}`)
  return readJson(version.transcriptPath, transcriptFromSegments(versionId, []))
}

export async function createDemoProject() {
  const view = await readProject()
  if (view.project.versions?.length) return view
  return createTextDraft({
    title: 'episode-draft',
    text: [
      'The intro currently spends too much time on background before giving listeners the main point.',
      'We should move the conclusion earlier and keep the tone calmer.',
      'After that, the episode can transition into evidence and examples.'
    ].join('\n')
  })
}
