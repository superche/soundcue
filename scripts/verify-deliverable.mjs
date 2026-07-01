#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const sampleAudio = join(projectRoot, 'samples', 'podcastfillers', 'clips', '00020.wav')

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
      env: { ...process.env, ...(options.env ?? {}) }
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr })
      else reject(new Error(stderr || `${command} exited with ${code}`))
    })
    if (options.input) child.stdin.end(options.input)
    else child.stdin.end()
  })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function verifyManifest() {
  const manifest = await readJson(join(projectRoot, '.codex-plugin', 'plugin.json'))
  assert(manifest.name === 'soundcue', 'plugin manifest name must be soundcue')
  assert(manifest.skills === './skills/', 'plugin manifest must expose skills')
  assert(manifest.mcpServers === './.mcp.json', 'plugin manifest must point to .mcp.json')
  const mcpConfig = await readJson(join(projectRoot, '.mcp.json'))
  assert(mcpConfig.mcpServers?.audio_patch_mcp, '.mcp.json must define audio_patch_mcp')
}

async function verifyMcpTools() {
  const request = [
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}',
    ''
  ].join('\n')
  const { stdout } = await run('npm', ['run', 'start:mcp'], { input: request })
  assert(stdout.includes('read_audio_patch_project'), 'MCP tools must include read_audio_patch_project')
  assert(stdout.includes('apply_audio_patch'), 'MCP tools must include apply_audio_patch')
}

async function verifyRuntimeStatus() {
  const { readRuntimeStatus } = await import('../lib/runtimeManager.mjs')
  const status = await readRuntimeStatus()
  const requiredIds = new Set(['core', 'audio-tools', 'transcript', 'voice-openvoice'])
  for (const runtime of status.runtimes) requiredIds.delete(runtime.id)
  assert(requiredIds.size === 0, `missing runtime cards: ${Array.from(requiredIds).join(', ')}`)
  const core = status.runtimes.find((runtime) => runtime.id === 'core')
  assert(core?.state === 'ready', 'core runtime must be ready')
}

async function verifyMarketplaceInstall() {
  const marketplaceRoot = join(projectRoot, 'build', 'soundcue-marketplace')
  const codexHome = await mkdtemp(join(tmpdir(), 'soundcue-codex-home-'))
  await run('npm', ['run', 'build'])
  await run(process.execPath, [join(projectRoot, 'scripts', 'package-marketplace.mjs'), marketplaceRoot])
  try {
    const env = { CODEX_HOME: codexHome }
    const addMarketplace = await run('codex', ['plugin', 'marketplace', 'add', marketplaceRoot, '--json'], { env })
    assert(addMarketplace.stdout.includes('soundcue-local') || addMarketplace.stdout.includes(marketplaceRoot), 'Codex must add local SoundCue marketplace')

    const available = await run('codex', ['plugin', 'list', '--available', '--json'], { env })
    assert(available.stdout.includes('soundcue@soundcue-local'), 'SoundCue must be visible as an available marketplace plugin')

    const install = await run('codex', ['plugin', 'add', 'soundcue@soundcue-local', '--json'], { env })
    assert(install.stdout.includes('soundcue@soundcue-local'), 'Codex must install soundcue from the local marketplace')

    const installed = await run('codex', ['plugin', 'list', '--json'], { env })
    assert(installed.stdout.includes('"enabled":true') || installed.stdout.includes('"enabled": true'), 'Installed SoundCue plugin must be enabled')
    assert(installed.stdout.includes('soundcue@soundcue-local'), 'Installed plugin list must include soundcue@soundcue-local')
  } finally {
    if (!process.env.SOUNDCUE_KEEP_VERIFY_PROJECT) {
      await rm(codexHome, { recursive: true, force: true })
    }
  }
}

function httpGet(url) {
  return new Promise((resolvePromise, reject) => {
    const req = request(url, { method: 'GET', timeout: 5000 }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolvePromise({ statusCode: res.statusCode, body }))
    })
    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`HTTP timeout: ${url}`))
    })
    req.on('error', reject)
    req.end()
  })
}

async function waitForHttp(url) {
  const deadline = Date.now() + 6000
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const response = await httpGet(url)
      if (response.statusCode >= 200 && response.statusCode < 500) return response
    } catch (error) {
      lastError = error
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }
  throw lastError ?? new Error(`HTTP endpoint did not become ready: ${url}`)
}

async function verifyPackagedPluginRuntime() {
  const pluginRoot = join(projectRoot, 'build', 'soundcue-marketplace', 'plugins', 'soundcue')
  const port = 44321
  const mcpRequest = [
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}',
    ''
  ].join('\n')
  const mcp = await run('bash', ['./scripts/start-mcp.sh'], { cwd: pluginRoot, input: mcpRequest })
  assert(mcp.stdout.includes('open_soundcue_ui'), 'Packaged MCP must expose open_soundcue_ui')
  assert(mcp.stdout.includes('Create SoundCue Edited Version'), 'Packaged MCP must expose derived-version creation')

  const child = spawn(process.execPath, [join(pluginRoot, 'scripts', 'start-ui.mjs'), `--port=${port}`], {
    cwd: pluginRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SOUNDCUE_PORT: String(port),
      AUDIO_PATCH_PROJECTS_DIR: join(tmpdir(), `soundcue-packaged-projects-${randomUUID()}`),
      AUDIO_PATCH_THREAD_ID: `packaged-${randomUUID()}`
    }
  })
  let logs = ''
  child.stdout?.on('data', (chunk) => { logs += chunk })
  child.stderr?.on('data', (chunk) => { logs += chunk })
  try {
    const root = await waitForHttp(`http://127.0.0.1:${port}/`)
    assert(root.body.includes('SoundCue'), 'Packaged UI server must serve the SoundCue app shell')
    const runtime = await httpGet(`http://127.0.0.1:${port}/api/runtime`)
    assert(runtime.statusCode === 200, 'Packaged UI server must expose runtime API')
    assert(runtime.body.includes('audio-tools'), 'Packaged runtime API must include audio-tools')
  } finally {
    child.kill('SIGTERM')
  }
  assert(!logs.includes('Error:'), `Packaged UI server should not log startup errors: ${logs}`)
}

async function verifyAudioJourney() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'soundcue-deliverable-'))
  const threadId = `verify-${randomUUID()}`
  process.env.AUDIO_PATCH_PROJECTS_DIR = tempRoot
  process.env.AUDIO_PATCH_THREAD_ID = threadId
  process.env.AUDIO_PATCH_STT_COMMAND = './scripts/mock-stt.mjs'
  const {
    applyPatch,
    createAnnotation,
    generatePatchCandidate,
    importAudioFromPath
  } = await import(`../lib/audioPatchStore.mjs?verify=${Date.now()}`)

  try {
    let view = await importAudioFromPath({ sourcePath: sampleAudio, title: 'deliverable-sample' })
    const baseVersion = view.versions.at(-1)
    const baseHashBefore = sha256(await readFile(baseVersion.audioPath))
    view = await createAnnotation({
      targetVersionId: baseVersion.versionId,
      range: {
        startMs: 0,
        endMs: 1200,
        segmentIds: ['seg_001'],
        selectedText: 'This intro is too wordy for a cold open.'
      },
      intent: {
        type: 'shorten',
        note: 'Shorten this part and keep the tone calm.'
      }
    })
    const annotation = view.annotations[0]
    const approvedCandidateTranscript = 'This intro is concise.'
    view = await generatePatchCandidate({
      annotationId: annotation.annotationId,
      editPlan: {
        operationType: 'replace_range',
        candidateTranscript: approvedCandidateTranscript,
        summary: ['Use the approved concise intro.'],
        rationale: 'The user approved this exact replacement before generating audio.',
        crossfadeMs: 180
      }
    })
    const patch = view.patches[0]
    assert(patch.operation?.candidateAudioPath, 'suggested edit must include candidate audio')
    assert(patch.operation?.candidateTranscript === approvedCandidateTranscript, 'suggested edit must use the approved edit plan transcript')
    assert(patch.operation?.editPlan?.source === 'codex_approved_plan', 'suggested edit must record approved plan source')
    view = await applyPatch({ patchId: patch.patchId })
    const derivedVersion = view.versions.at(-1)
    const baseHashAfter = sha256(await readFile(baseVersion.audioPath))
    const derivedHash = sha256(await readFile(derivedVersion.audioPath))
    assert(baseHashBefore === baseHashAfter, 'base audio must remain immutable')
    assert(baseHashBefore !== derivedHash, 'derived version audio must differ from base audio')
    assert(view.project.currentVersionId === derivedVersion.versionId, 'project current version must advance to derived version')
    return { tempRoot, threadId, baseVersion: baseVersion.versionId, derivedVersion: derivedVersion.versionId }
  } finally {
    if (!process.env.SOUNDCUE_KEEP_VERIFY_PROJECT) {
      await rm(tempRoot, { recursive: true, force: true })
    }
  }
}

await verifyManifest()
await verifyMcpTools()
await verifyRuntimeStatus()
await verifyMarketplaceInstall()
await verifyPackagedPluginRuntime()
const journey = await verifyAudioJourney()
console.log(JSON.stringify({
  ok: true,
  checks: ['manifest', 'mcp-tools', 'runtime-status', 'marketplace-install', 'packaged-mcp-tools', 'packaged-ui-runtime', 'approved-plan-audio-journey'],
  journey
}, null, 2))
