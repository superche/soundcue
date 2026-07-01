import readline from 'node:readline'
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyPatch,
  createAnnotation,
  createCodexRequest,
  createTextDraft,
  generatePatchCandidate,
  importAudioFromPath,
  openFolder,
  readProject,
  storePaths
} from '../lib/audioPatchStore.mjs'

const SERVER_NAME = 'SoundCue MCP'
const SERVER_VERSION = '0.1.0'
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const soundCuePort = Number(process.env.SOUNDCUE_PORT || 43231)
const soundCueHost = process.env.SOUNDCUE_HOST || '127.0.0.1'
const soundCueUrl = `http://${soundCueHost}:${soundCuePort}/`

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function result(id, payload) {
  send({ jsonrpc: '2.0', id, result: payload })
}

function error(id, message) {
  send({ jsonrpc: '2.0', id, error: { code: -32602, message } })
}

function toolResult(id, text, structuredContent = {}) {
  result(id, {
    content: [{ type: 'text', text }],
    structuredContent
  })
}

function listTools() {
  return [
    {
      name: 'read_audio_patch_project',
      title: 'Read SoundCue Project',
      description: 'Read the current conversation-bound SoundCue project, versions, annotations, suggested edits, and local paths.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    {
      name: 'import_audio_file',
      title: 'Import Audio File',
      description: 'Copy a local audio file into the current SoundCue project and create the next version.',
      inputSchema: {
        type: 'object',
        properties: {
          sourcePath: { type: 'string' },
          title: { type: 'string' },
          durationMs: { type: 'number' },
          peaks: { type: 'array', items: { type: 'number' } }
        },
        required: ['sourcePath'],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    {
      name: 'create_audio_project_from_text',
      title: 'Create Audio Project From Text',
      description: 'Create a text-first audio version. Uses configured TTS adapter or a local placeholder audio file.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          text: { type: 'string' }
        },
        required: ['text'],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    {
      name: 'create_audio_patch_annotation',
      title: 'Create SoundCue Annotation',
      description: 'Create a transcript/audio-range annotation with typed intent for the current project.',
      inputSchema: {
        type: 'object',
        properties: {
          targetVersionId: { type: 'string' },
          range: {
            type: 'object',
            properties: {
              startMs: { type: 'number' },
              endMs: { type: 'number' },
              segmentIds: { type: 'array', items: { type: 'string' } },
              selectedText: { type: 'string' }
            },
            required: ['startMs', 'endMs'],
            additionalProperties: false
          },
          intent: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['cut', 'delete', 'shorten', 'rewrite', 'revoice', 'keep', 'issue'] },
              note: { type: 'string' },
              constraints: { type: 'array', items: { type: 'string' } }
            },
            required: ['type'],
            additionalProperties: false
          }
        },
        required: ['range', 'intent'],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    {
      name: 'generate_audio_patch_candidate',
      title: 'Generate SoundCue Suggested Edit',
      description: 'Generate a local non-destructive suggested edit from a reviewed annotation and an optional user-approved edit plan.',
      inputSchema: {
        type: 'object',
        properties: {
          annotationId: { type: 'string' },
          candidateTranscript: {
            type: 'string',
            description: 'Exact replacement transcript approved by the user. Empty string means delete the selected range.'
          },
          operationType: {
            type: 'string',
            enum: ['replace_range', 'delete_range'],
            description: 'How to render the selected range. Defaults to replace_range.'
          },
          crossfadeMs: {
            type: 'number',
            description: 'Requested crossfade in milliseconds for the local render.'
          },
          summary: {
            type: 'array',
            items: { type: 'string' },
            description: 'Review summary bullets shown in Suggested Edit.'
          },
          editPlan: {
            type: 'object',
            description: 'Structured plan explicitly approved by the user in the Codex composer before generating audio.',
            properties: {
              operationType: { type: 'string', enum: ['replace_range', 'delete_range'] },
              candidateTranscript: { type: 'string' },
              summary: { type: 'array', items: { type: 'string' } },
              rationale: { type: 'string' },
              crossfadeMs: { type: 'number' },
              voiceProvider: { type: 'string' }
            },
            additionalProperties: false
          }
        },
        required: ['annotationId'],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    {
      name: 'read_soundcue_codex_requests',
      title: 'Read SoundCue Edit Briefs',
      description: 'Read local SoundCue edit briefs prepared from reviewed annotations.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    {
      name: 'send_soundcue_annotation_to_codex',
      title: 'Prepare SoundCue Edit Brief',
      description: 'Create a local edit brief for an annotation. This does not apply or generate an edit.',
      inputSchema: {
        type: 'object',
        properties: {
          annotationId: { type: 'string' }
        },
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    {
      name: 'apply_audio_patch',
      title: 'Create SoundCue Edited Version',
      description: 'Create a new derived audio version from a reviewed suggested edit. The original audio file is not modified.',
      inputSchema: {
        type: 'object',
        properties: {
          patchId: { type: 'string' }
        },
        required: ['patchId'],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    {
      name: 'open_audio_patch_folder',
      title: 'Open SoundCue Folder',
      description: 'Open the current project or export folder locally.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['project', 'export'] }
        },
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    {
      name: 'open_soundcue_ui',
      title: 'Open SoundCue UI',
      description: 'Start the packaged local SoundCue UI server if needed and open it in the browser.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }
  ]
}

function isUiListening() {
  return new Promise((resolvePromise) => {
    const req = request(soundCueUrl, { method: 'GET', timeout: 800 }, (res) => {
      res.resume()
      resolvePromise(res.statusCode >= 200 && res.statusCode < 500)
    })
    req.on('timeout', () => {
      req.destroy()
      resolvePromise(false)
    })
    req.on('error', () => resolvePromise(false))
    req.end()
  })
}

async function openSoundCueUi() {
  if (!(await isUiListening())) {
    const child = spawn(process.execPath, [join(packageRoot, 'scripts', 'start-ui.mjs')], {
      cwd: packageRoot,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        SOUNDCUE_HOST: soundCueHost,
        SOUNDCUE_PORT: String(soundCuePort)
      }
    })
    child.unref()
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      if (await isUiListening()) break
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
    }
  }
  await openFolderWithPath(soundCueUrl).catch(() => null)
  return { url: soundCueUrl }
}

async function openFolderWithPath(target) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, [target], { stdio: 'ignore' })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`)))
  })
}

async function handleToolCall(id, params) {
  const args = params.arguments ?? {}
  if (params.name === 'read_audio_patch_project') {
    const payload = await readProject()
    toolResult(id, JSON.stringify(payload.project, null, 2), payload)
    return
  }
  if (params.name === 'import_audio_file') {
    const payload = await importAudioFromPath(args)
    toolResult(id, `Imported audio into ${storePaths.projectDir}`, payload)
    return
  }
  if (params.name === 'create_audio_project_from_text') {
    const payload = await createTextDraft(args)
    toolResult(id, `Created text-first version in ${storePaths.projectDir}`, payload)
    return
  }
  if (params.name === 'create_audio_patch_annotation') {
    const payload = await createAnnotation(args)
    toolResult(id, 'Created annotation.', payload)
    return
  }
  if (params.name === 'generate_audio_patch_candidate') {
    const payload = await generatePatchCandidate(args)
    toolResult(id, 'Generated suggested edit.', payload)
    return
  }
  if (params.name === 'read_soundcue_codex_requests') {
    const payload = await readProject()
    toolResult(id, JSON.stringify(payload.codexRequests ?? [], null, 2), payload)
    return
  }
  if (params.name === 'send_soundcue_annotation_to_codex') {
    const payload = await createCodexRequest(args)
    toolResult(id, 'Created edit brief.', payload)
    return
  }
  if (params.name === 'apply_audio_patch') {
    const payload = await applyPatch(args)
    toolResult(id, 'Created a new edited audio version. The original version was not modified.', payload)
    return
  }
  if (params.name === 'open_audio_patch_folder') {
    const payload = await openFolder(args.kind)
    toolResult(id, `Opened ${payload.path}`, payload)
    return
  }
  if (params.name === 'open_soundcue_ui') {
    const payload = await openSoundCueUi()
    toolResult(id, `Opened SoundCue UI at ${payload.url}`, payload)
    return
  }
  error(id, `Unknown tool: ${params.name}`)
}

async function handle(message) {
  if (message.method === 'initialize') {
    result(message.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
    })
    return
  }
  if (message.method === 'tools/list') {
    result(message.id, { tools: listTools() })
    return
  }
  if (message.method === 'tools/call') {
    await handleToolCall(message.id, message.params ?? {})
    return
  }
  if (message.id !== undefined) {
    result(message.id, {})
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', async (line) => {
  if (!line.trim()) return
  try {
    await handle(JSON.parse(line))
  } catch (err) {
    send({ jsonrpc: '2.0', error: { code: -32000, message: err.message } })
  }
})
