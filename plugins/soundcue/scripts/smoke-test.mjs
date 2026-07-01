#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const projectRoot = resolve(new URL('..', import.meta.url).pathname)
const sampleAudio = join(projectRoot, 'samples', 'podcastfillers', 'clips', '00020.wav')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

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

function parseJsonRpcLines(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
}

async function verifyMcpPlanSchema() {
  const requestPayload = [
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}',
    ''
  ].join('\n')
  const { stdout } = await run('npm', ['run', 'start:mcp'], { input: requestPayload })
  const toolList = parseJsonRpcLines(stdout).find((message) => message.id === 2)?.result?.tools ?? []
  const generateTool = toolList.find((tool) => tool.name === 'generate_audio_patch_candidate')
  assert(generateTool, 'MCP must expose generate_audio_patch_candidate')
  assert(generateTool.inputSchema?.properties?.editPlan, 'generate_audio_patch_candidate must accept editPlan')
  assert(generateTool.inputSchema?.properties?.candidateTranscript, 'generate_audio_patch_candidate must accept top-level candidateTranscript')
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

async function verifyUiServerSmoke() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'soundcue-ui-smoke-'))
  const port = 44322
  const child = spawn(process.execPath, [join(projectRoot, 'scripts', 'start-ui.mjs'), `--port=${port}`], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SOUNDCUE_PORT: String(port),
      AUDIO_PATCH_PROJECTS_DIR: tempRoot,
      AUDIO_PATCH_THREAD_ID: `smoke-ui-${randomUUID()}`
    }
  })
  let logs = ''
  child.stdout?.on('data', (chunk) => { logs += chunk })
  child.stderr?.on('data', (chunk) => { logs += chunk })
  try {
    const root = await waitForHttp(`http://127.0.0.1:${port}/`)
    assert(root.body.includes('SoundCue'), 'UI server must serve the SoundCue shell')
    const runtime = await httpGet(`http://127.0.0.1:${port}/api/runtime`)
    assert(runtime.statusCode === 200, 'UI server must expose runtime API')
    assert(runtime.body.includes('voice-openvoice'), 'Runtime API must include the optional voice provider layer')
  } finally {
    child.kill('SIGTERM')
    await rm(tempRoot, { recursive: true, force: true })
  }
  assert(!logs.includes('Error:'), `UI server should not log startup errors: ${logs}`)
}

async function verifyApprovedPlanJourney() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'soundcue-plan-smoke-'))
  const threadId = `smoke-${randomUUID()}`
  process.env.AUDIO_PATCH_PROJECTS_DIR = tempRoot
  process.env.AUDIO_PATCH_THREAD_ID = threadId
  process.env.AUDIO_PATCH_STT_COMMAND = './scripts/mock-stt.mjs'
  const {
    applyPatch,
    createAnnotation,
    createCodexRequest,
    generatePatchCandidate,
    importAudioFromPath
  } = await import(`../lib/audioPatchStore.mjs?smoke=${Date.now()}`)

  try {
    let view = await importAudioFromPath({ sourcePath: sampleAudio, title: 'smoke-sample' })
    const baseVersion = view.versions.at(-1)
    const baseHashBefore = sha256(await readFile(baseVersion.audioPath))
    view = await createAnnotation({
      targetVersionId: baseVersion.versionId,
      range: {
        startMs: 0,
        endMs: 2200,
        segmentIds: ['seg_001'],
        selectedText: "Hey, this is Zach Miller and you're joining us."
      },
      intent: {
        type: 'shorten',
        note: 'Make the opening calmer and concise.'
      }
    })
    const annotation = view.annotations[0]
    view = await createCodexRequest({ annotationId: annotation.annotationId })
    const brief = view.codexRequests[0]
    assert(brief.contextPackage?.expectedOutput?.reviewOnly === true, 'Brief must preserve the review-only boundary')

    const approvedCandidateTranscript = 'I am Zach Miller.'
    view = await generatePatchCandidate({
      annotationId: annotation.annotationId,
      editPlan: {
        operationType: 'replace_range',
        candidateTranscript: approvedCandidateTranscript,
        summary: ['Use the approved concise opening line.'],
        rationale: 'The user approved this exact replacement after reviewing the plan.',
        crossfadeMs: 180
      }
    })
    const patch = view.patches[0]
    assert(patch.operation?.candidateTranscript === approvedCandidateTranscript, 'Suggested edit must use the approved candidate transcript exactly')
    assert(patch.operation?.crossfadeMs === 180, 'Suggested edit must preserve approved crossfadeMs')
    assert(patch.operation?.editPlan?.source === 'codex_approved_plan', 'Suggested edit must record the approved plan source')
    assert(patch.review?.summary?.[0] === 'Use the approved concise opening line.', 'Suggested edit summary must include approved plan summary first')

    view = await applyPatch({ patchId: patch.patchId })
    const derivedVersion = view.versions.at(-1)
    const baseHashAfter = sha256(await readFile(baseVersion.audioPath))
    const derivedHash = sha256(await readFile(derivedVersion.audioPath))
    assert(baseHashBefore === baseHashAfter, 'Base audio must remain immutable')
    assert(baseHashBefore !== derivedHash, 'Derived version audio must differ from base audio')
    assert(view.project.currentVersionId === derivedVersion.versionId, 'Project must advance to the derived version')
    return { tempRoot, threadId, baseVersion: baseVersion.versionId, derivedVersion: derivedVersion.versionId }
  } finally {
    if (!process.env.SOUNDCUE_KEEP_SMOKE_PROJECT) {
      await rm(tempRoot, { recursive: true, force: true })
    }
  }
}

await verifyMcpPlanSchema()
await verifyUiServerSmoke()
const journey = await verifyApprovedPlanJourney()
console.log(JSON.stringify({
  ok: true,
  checks: [
    'mcp-plan-schema',
    'ui-server',
    'approved-plan-journey',
    'immutable-base-audio'
  ],
  journey
}, null, 2))
