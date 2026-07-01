import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = resolve(
  process.env.SOUNDCUE_RUNTIME_DIR
    ?? (process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'SoundCue', 'runtimes')
      : process.platform === 'win32'
        ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'SoundCue', 'runtimes')
        : join(homedir(), '.local', 'share', 'soundcue', 'runtimes'))
)
const logDir = join(runtimeRoot, 'logs')
const statePath = join(runtimeRoot, 'runtime-state.json')
const projectModelPath = join(packageRoot, 'models', 'whisper', `ggml-${process.env.AUDIO_PATCH_WHISPER_MODEL_NAME || 'base.en'}.bin`)
const openVoiceRoot = join(packageRoot, 'tools', 'openvoice')
const openVoiceRepo = join(openVoiceRoot, 'OpenVoice')
const openVoicePython = process.platform === 'win32'
  ? join(openVoiceRoot, '.venv', 'Scripts', 'python.exe')
  : join(openVoiceRoot, '.venv', 'bin', 'python')
const openVoiceCheckpoints = join(openVoiceRepo, 'checkpoints_v2')

const jobs = new Map()

function runtimeDefinitions() {
  return [
    {
      id: 'core',
      title: 'Core',
      level: 'required',
      installable: false,
      description: 'SoundCue UI, local project files, annotations, edit briefs, and version review.',
      localOnly: true
    },
    {
      id: 'audio-tools',
      title: 'Audio tools',
      level: 'required',
      installable: true,
      description: 'FFmpeg and FFprobe for probing, slicing, rendering, and export.',
      installLabel: 'Install FFmpeg',
      manualSetup: manualAudioToolsSetup()
    },
    {
      id: 'transcript',
      title: 'Transcript',
      level: 'recommended',
      installable: true,
      description: 'Local whisper.cpp runner plus the default ggml-base.en model.',
      installLabel: 'Install Whisper',
      manualSetup: 'Install whisper.cpp, make whisper-cli available on PATH, then run npm run stt:setup.'
    },
    {
      id: 'voice-openvoice',
      title: 'Voice provider',
      level: 'optional',
      installable: true,
      description: 'OpenVoice local voice replacement. Large optional install; podcast review works without it.',
      installLabel: 'Install OpenVoice',
      warning: 'Optional and large. Python packages and checkpoints can take several minutes.',
      manualSetup: 'Run npm run voice:setup, then npm run voice:check. Enable with AUDIO_PATCH_VOICE_PROVIDER=openvoice.'
    }
  ]
}

function manualAudioToolsSetup() {
  if (process.platform === 'darwin') return 'Install Homebrew, then run brew install ffmpeg.'
  if (process.platform === 'win32') return 'Install FFmpeg with winget install Gyan.FFmpeg, then restart the terminal so ffmpeg is on PATH.'
  return 'Install FFmpeg with your system package manager, then verify ffmpeg and ffprobe are on PATH.'
}

function run(command, args, options = {}) {
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

async function commandExists(command) {
  try {
    if (process.platform === 'win32') {
      await run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `where ${command} >nul 2>nul`])
    } else {
      await run('sh', ['-lc', `command -v ${JSON.stringify(command)} >/dev/null 2>&1`])
    }
    return true
  } catch {
    return false
  }
}

async function firstLine(command, args) {
  try {
    const { stdout, stderr } = await run(command, args)
    return String(stdout || stderr).split('\n').find(Boolean) ?? null
  } catch {
    return null
  }
}

async function sizeOf(path) {
  try {
    const info = await stat(path)
    return info.size
  } catch {
    return null
  }
}

async function readState() {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'))
  } catch {
    return {}
  }
}

async function writeState(nextState) {
  await mkdir(runtimeRoot, { recursive: true })
  await writeFile(statePath, `${JSON.stringify(nextState, null, 2)}\n`)
}

function phaseFromOutput(line, fallback) {
  const text = line.toLowerCase()
  if (text.includes('brew install') || text.includes('installing ffmpeg')) return 'Installing FFmpeg'
  if (text.includes('downloading') && text.includes('model')) return 'Downloading Whisper model'
  if (text.includes('whisper-cli')) return 'Checking Whisper runner'
  if (text.includes('git clone') || text.includes('cloning')) return 'Cloning OpenVoice'
  if (text.includes('venv')) return 'Creating Python environment'
  if (text.includes('pip install') || text.includes('installing collected packages')) return 'Installing Python packages'
  if (text.includes('checkpoint')) return 'Downloading OpenVoice checkpoints'
  if (text.includes('model ready') || text.includes('ready')) return 'Verifying runtime'
  return fallback
}

function installCommandFor(runtimeId) {
  if (runtimeId === 'audio-tools') {
    if (process.platform === 'darwin') return ['brew', ['install', 'ffmpeg']]
    if (process.platform === 'win32') return ['winget', ['install', '--id', 'Gyan.FFmpeg', '-e']]
    return ['sh', ['-lc', 'sudo apt-get update && sudo apt-get install -y ffmpeg']]
  }
  if (runtimeId === 'transcript') {
    return [process.execPath, [join(packageRoot, 'scripts', 'setup-local-stt.mjs'), '--install-runner']]
  }
  if (runtimeId === 'voice-openvoice') {
    return [process.execPath, [join(packageRoot, 'scripts', 'setup-openvoice.mjs'), '--install']]
  }
  throw new Error(`Runtime is not installable: ${runtimeId}`)
}

async function statusForRuntime(definition, persistedState) {
  if (definition.id === 'core') {
    return {
      ...definition,
      state: 'ready',
      detail: 'Bundled with the plugin.',
      lastVerifiedAt: new Date().toISOString()
    }
  }
  if (definition.id === 'audio-tools') {
    const [ffmpegReady, ffprobeReady] = await Promise.all([commandExists('ffmpeg'), commandExists('ffprobe')])
    const version = ffmpegReady ? await firstLine('ffmpeg', ['-version']) : null
    return {
      ...definition,
      state: ffmpegReady && ffprobeReady ? 'ready' : 'missing',
      detail: ffmpegReady && ffprobeReady ? 'ffmpeg and ffprobe are on PATH.' : 'ffmpeg or ffprobe is missing.',
      version,
      configuredPath: process.env.FFMPEG_PATH || 'PATH',
      lastVerifiedAt: persistedState[definition.id]?.lastVerifiedAt ?? null
    }
  }
  if (definition.id === 'transcript') {
    const customCommand = process.env.AUDIO_PATCH_STT_COMMAND
    const whisperReady = await commandExists('whisper-cli') || await commandExists('whisper-cli.exe')
    const modelSize = await sizeOf(projectModelPath)
    const ready = Boolean(customCommand) || (whisperReady && modelSize)
    return {
      ...definition,
      state: ready ? (customCommand ? 'external_configured' : 'ready') : 'missing',
      detail: customCommand
        ? `Using AUDIO_PATCH_STT_COMMAND: ${customCommand}`
        : ready
          ? 'whisper-cli and default model are available.'
          : 'Local Whisper runner or default model is missing.',
      version: whisperReady ? await firstLine(process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli', ['--help']) : null,
      configuredPath: customCommand || projectModelPath,
      sizeBytes: modelSize,
      lastVerifiedAt: persistedState[definition.id]?.lastVerifiedAt ?? null
    }
  }
  if (definition.id === 'voice-openvoice') {
    const providerEnabled = process.env.AUDIO_PATCH_VOICE_PROVIDER === 'openvoice'
    const customCommand = process.env.AUDIO_PATCH_VOICE_COMMAND
    const ready = existsSync(openVoiceRepo)
      && existsSync(openVoicePython)
      && existsSync(join(openVoiceCheckpoints, 'converter', 'checkpoint.pth'))
    return {
      ...definition,
      state: customCommand ? 'external_configured' : ready ? (providerEnabled ? 'enabled' : 'ready') : 'missing',
      detail: customCommand
        ? `Using AUDIO_PATCH_VOICE_COMMAND: ${customCommand}`
        : ready
          ? providerEnabled ? 'OpenVoice is installed and enabled for this dev server.' : 'OpenVoice is installed. Start with npm run dev:openvoice to enable it.'
          : 'OpenVoice code, Python environment, or checkpoints are missing.',
      configuredPath: customCommand || openVoiceRoot,
      lastVerifiedAt: persistedState[definition.id]?.lastVerifiedAt ?? null
    }
  }
  return { ...definition, state: 'missing' }
}

function serializeJob(job) {
  return {
    runtimeId: job.runtimeId,
    state: job.state,
    phase: job.phase,
    step: job.step,
    detail: job.detail,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    elapsedMs: Date.now() - Date.parse(job.startedAt),
    progress: job.progress,
    logPath: job.logPath,
    error: job.error ?? null,
    cancellable: job.state === 'installing'
  }
}

export async function readRuntimeStatus() {
  const persistedState = await readState()
  const runtimes = await Promise.all(runtimeDefinitions().map((definition) => statusForRuntime(definition, persistedState)))
  const activeJobs = Array.from(jobs.values()).map(serializeJob)
  return {
    runtimeRoot,
    generatedAt: new Date().toISOString(),
    runtimes: runtimes.map((runtime) => ({
      ...runtime,
      job: activeJobs.find((job) => job.runtimeId === runtime.id) ?? null
    })),
    activeJobs
  }
}

export async function installRuntime(runtimeId) {
  if (jobs.has(runtimeId)) return serializeJob(jobs.get(runtimeId))
  const definition = runtimeDefinitions().find((item) => item.id === runtimeId)
  if (!definition?.installable) throw new Error(`Runtime is not installable: ${runtimeId}`)
  await mkdir(logDir, { recursive: true })
  const logPath = join(logDir, `${runtimeId}-${Date.now()}.log`)
  const [command, args] = installCommandFor(runtimeId)
  const job = {
    runtimeId,
    state: 'installing',
    phase: 'Planning install',
    step: definition.installLabel,
    detail: definition.description,
    progress: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    logPath,
    child: null,
    error: null
  }
  jobs.set(runtimeId, job)
  await appendFile(logPath, [
    `SoundCue runtime install: ${definition.title}`,
    `Command: ${command} ${args.join(' ')}`,
    `Started: ${job.startedAt}`,
    ''
  ].join('\n'))

  const child = spawn(command, args, {
    cwd: packageRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env
  })
  job.child = child
  const writeLog = async (chunk, streamName) => {
    const text = chunk.toString()
    const lines = text.split(/\r?\n/).filter(Boolean)
    const latest = lines.at(-1)
    if (latest) {
      job.phase = phaseFromOutput(latest, job.phase)
      job.step = latest.slice(0, 180)
    }
    await appendFile(logPath, lines.map((line) => `[${streamName}] ${line}`).join('\n') + (lines.length ? '\n' : ''))
  }
  child.stdout?.on('data', (chunk) => { void writeLog(chunk, 'stdout') })
  child.stderr?.on('data', (chunk) => { void writeLog(chunk, 'stderr') })
  child.on('error', async (error) => {
    job.state = 'failed'
    job.error = error.message
    job.endedAt = new Date().toISOString()
    await appendFile(logPath, `\nInstall failed: ${error.message}\n`)
  })
  child.on('close', async (code) => {
    job.endedAt = new Date().toISOString()
    if (code === 0) {
      job.state = 'verifying'
      job.phase = 'Verifying runtime'
      const state = await readState()
      state[runtimeId] = { lastVerifiedAt: new Date().toISOString(), lastLogPath: logPath }
      await writeState(state)
      job.state = 'ready'
      job.step = 'Ready'
      await appendFile(logPath, `\nInstall finished: ${job.endedAt}\n`)
    } else {
      job.state = 'failed'
      job.error = `${command} exited with ${code}`
      await appendFile(logPath, `\nInstall failed: ${job.error}\n`)
    }
  })
  return serializeJob(job)
}

export function cancelRuntimeInstall(runtimeId) {
  const job = jobs.get(runtimeId)
  if (!job || job.state !== 'installing') return null
  job.child?.kill('SIGTERM')
  job.state = 'failed'
  job.error = 'Cancelled by user.'
  job.endedAt = new Date().toISOString()
  return serializeJob(job)
}

export async function readRuntimeLog(runtimeId) {
  const job = jobs.get(runtimeId)
  const state = await readState()
  const logPath = job?.logPath ?? state[runtimeId]?.lastLogPath
  if (!logPath) return { runtimeId, logPath: null, text: '' }
  const text = await readFile(logPath, 'utf8').catch((error) => `Log unavailable: ${error.message}`)
  return { runtimeId, logPath, text }
}
