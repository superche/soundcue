#!/usr/bin/env node
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const [, , audioPath, outputPath] = process.argv
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultModelName = process.env.AUDIO_PATCH_WHISPER_MODEL_NAME || 'base.en'
const defaultModelPath = join(projectRoot, 'models', 'whisper', `ggml-${defaultModelName}.bin`)

if (!audioPath || !outputPath) {
  process.stderr.write('Usage: local-whisper-stt.mjs <audioPath> <outputJsonPath>\n')
  process.exit(2)
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
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

async function findCommand(candidates) {
  for (const command of candidates) {
    if (await commandExists(command)) return command
  }
  return null
}

function resolveWhisperModelPath() {
  if (process.env.AUDIO_PATCH_WHISPER_MODEL && existsSync(process.env.AUDIO_PATCH_WHISPER_MODEL)) {
    return process.env.AUDIO_PATCH_WHISPER_MODEL
  }
  if (existsSync(defaultModelPath)) return defaultModelPath
  return null
}

function normalizeWhisperPayload(payload) {
  const rawSegments = Array.isArray(payload?.segments)
    ? payload.segments
    : Array.isArray(payload?.transcription)
      ? payload.transcription.map((segment) => ({
          start: Number(segment.offsets?.from ?? 0) / 1000,
          end: Number(segment.offsets?.to ?? segment.offsets?.from ?? 0) / 1000,
          text: segment.text
        }))
      : []
  const segments = rawSegments.length
    ? rawSegments.map((segment, index) => ({
        segmentId: `seg_${String(index + 1).padStart(3, '0')}`,
        start: Number(segment.start ?? 0),
        end: Number(segment.end ?? segment.start ?? 0),
        speaker: 'Speaker',
        text: String(segment.text ?? '').trim()
      })).filter((segment) => segment.text)
    : []
  return {
    language: payload?.language ?? payload?.result?.language ?? 'auto',
    source: payload?.source ?? 'local-whisper',
    text: payload?.text ?? segments.map((segment) => segment.text).join(' '),
    segments
  }
}

async function runCustomShell() {
  const template = process.env.AUDIO_PATCH_STT_SHELL
  if (!template) return false
  const command = template
    .replaceAll('{audio}', JSON.stringify(audioPath))
    .replaceAll('{output}', JSON.stringify(outputPath))
  if (process.platform === 'win32') {
    await run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command])
  } else {
    await run('sh', ['-lc', command])
  }
  return true
}

async function runPythonWhisper() {
  const command = await findCommand(['whisper'])
  if (!command) return false
  const outDir = await mkdtemp(join(tmpdir(), 'soundcue-whisper-'))
  await run(command, [
    audioPath,
    '--model', process.env.AUDIO_PATCH_PYTHON_WHISPER_MODEL || defaultModelName,
    '--output_format', 'json',
    '--output_dir', outDir,
    '--fp16', 'False'
  ])
  const jsonPath = join(outDir, `${basename(audioPath).replace(/\.[^.]+$/, '')}.json`)
  const payload = normalizeWhisperPayload(JSON.parse(await readFile(jsonPath, 'utf8')))
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`)
  return true
}

async function runWhisperCpp() {
  const command = await findCommand(['whisper-cli', 'whisper-cli.exe'])
  if (!command) return false
  const modelPath = resolveWhisperModelPath()
  if (!modelPath) {
    throw new Error(`whisper-cli found, but no local model exists. Run "npm run stt:setup" or set AUDIO_PATCH_WHISPER_MODEL to a .bin/.gguf model.`)
  }
  const outBase = join(dirname(outputPath), basename(outputPath, '.json'))
  await run(command, ['-m', modelPath, '-f', audioPath, '-oj', '-of', outBase])
  const payload = normalizeWhisperPayload(JSON.parse(await readFile(`${outBase}.json`, 'utf8')))
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`)
  return true
}

try {
  if (await runCustomShell()) process.exit(0)
  if (await runPythonWhisper()) process.exit(0)
  if (await runWhisperCpp()) process.exit(0)
  throw new Error([
    'No local Whisper STT command found.',
    'Run "npm run stt:setup" to download the default model and get runner setup instructions.',
    'SoundCue prefers whisper.cpp whisper-cli for macOS and Windows.',
    'Alternatively set AUDIO_PATCH_STT_SHELL to a command template that writes JSON to {output}.'
  ].join(' '))
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}
