#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const [, , textPath, referenceAudioPath, outputPath] = process.argv
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const toolsRoot = join(projectRoot, 'tools', 'openvoice')
const defaultRepo = join(toolsRoot, 'OpenVoice')
const defaultPython = process.platform === 'win32'
  ? join(toolsRoot, '.venv', 'Scripts', 'python.exe')
  : join(toolsRoot, '.venv', 'bin', 'python')

if (!textPath || !referenceAudioPath || !outputPath) {
  process.stderr.write('Usage: openvoice-tts.mjs <textPath> <referenceAudioPath> <outputPath>\n')
  process.exit(2)
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

const python = process.env.AUDIO_PATCH_OPENVOICE_PYTHON || defaultPython
const repo = process.env.AUDIO_PATCH_OPENVOICE_REPO || defaultRepo
if (!existsSync(python)) {
  throw new Error(`OpenVoice Python runtime not found: ${python}. Run "npm run voice:setup -- --install".`)
}
if (!existsSync(repo)) {
  throw new Error(`OpenVoice repo not found: ${repo}. Run "npm run voice:setup -- --install".`)
}

await mkdir(dirname(outputPath), { recursive: true })
await run(python, [join(projectRoot, 'scripts', 'openvoice_provider.py'), textPath, referenceAudioPath, outputPath], {
  env: {
    ...process.env,
    AUDIO_PATCH_OPENVOICE_REPO: repo
  }
})
