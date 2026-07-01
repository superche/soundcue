#!/usr/bin/env node
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const modelName = process.env.AUDIO_PATCH_WHISPER_MODEL_NAME || 'base.en'
const modelDir = join(projectRoot, 'models', 'whisper')
const modelPath = join(modelDir, `ggml-${modelName}.bin`)
const modelUrl = process.env.AUDIO_PATCH_WHISPER_MODEL_URL
  || `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${modelName}.bin`

function run(command, argsForCommand, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, argsForCommand, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
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

async function downloadModel() {
  if (existsSync(modelPath)) {
    console.log(`Model already exists: ${modelPath}`)
    return
  }
  if (args.has('--check')) {
    console.log(`Model missing: ${modelPath}`)
    return
  }

  await mkdir(modelDir, { recursive: true })
  console.log(`Downloading ${modelName} model to ${modelPath}`)
  const response = await fetch(modelUrl)
  if (!response.ok) throw new Error(`Model download failed: ${response.status} ${response.statusText}`)
  if (!response.body) throw new Error('Model download returned no response body.')

  await new Promise((resolvePromise, reject) => {
    const file = createWriteStream(modelPath)
    Readable.fromWeb(response.body).pipe(file)
    file.on('finish', resolvePromise)
    file.on('error', reject)
  })
  console.log(`Model ready: ${modelPath}`)
}

async function setupRunner() {
  if (await commandExists('whisper-cli') || await commandExists('whisper-cli.exe')) {
    console.log('whisper-cli found.')
    return
  }

  if (process.platform === 'darwin') {
    if (args.has('--install-runner')) {
      if (!(await commandExists('brew'))) {
        throw new Error('Homebrew is required to install whisper.cpp automatically on macOS.')
      }
      console.log('Installing whisper.cpp with Homebrew.')
      await run('brew', ['install', 'whisper-cpp'], { stdio: 'inherit' })
      return
    }
    console.log('whisper-cli not found. On macOS, run: brew install whisper-cpp')
    console.log('Or run: npm run stt:setup -- --install-runner')
    return
  }

  if (process.platform === 'win32') {
    console.log('whisper-cli.exe not found. On Windows, install a whisper.cpp build and add whisper-cli.exe to PATH.')
    console.log('Then run: npm run stt:check')
    return
  }

  console.log('whisper-cli not found. Install whisper.cpp for your platform and add whisper-cli to PATH.')
}

await downloadModel()
await setupRunner()
console.log('')
console.log('Use this dev server command after setup:')
console.log('  npm run dev:local-stt')
console.log('')
console.log('Adapter command:')
console.log('  AUDIO_PATCH_STT_COMMAND=./scripts/local-whisper-stt.mjs')
