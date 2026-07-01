#!/usr/bin/env node
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyPatch,
  createAnnotation,
  createCodexRequest,
  createDemoProject,
  createTextDraft,
  generatePatchCandidate,
  importAudioFromDataUrl,
  openFolder,
  readProject,
  readTranscript,
  storePaths,
  transcribeVersion
} from '../lib/audioPatchStore.mjs'
import {
  cancelRuntimeInstall,
  installRuntime,
  readRuntimeLog,
  readRuntimeStatus
} from '../lib/runtimeManager.mjs'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const distRoot = join(packageRoot, 'dist')
const host = process.env.SOUNDCUE_HOST || '127.0.0.1'
const port = Number(process.env.SOUNDCUE_PORT || process.argv.find((arg) => arg.startsWith('--port='))?.split('=')[1] || 43231)

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(payload))
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 120 * 1024 * 1024) {
        reject(new Error('Request body is too large.'))
        req.destroy()
      }
    })
    req.on('end', () => resolvePromise(body))
    req.on('error', reject)
  })
}

function mimeTypeForPath(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html'
    case '.js':
      return 'text/javascript'
    case '.css':
      return 'text/css'
    case '.json':
      return 'application/json'
    case '.svg':
      return 'image/svg+xml'
    case '.wav':
      return 'audio/wav'
    case '.mp3':
      return 'audio/mpeg'
    case '.m4a':
      return 'audio/mp4'
    default:
      return 'application/octet-stream'
  }
}

function assertSafeProjectPath(filePath) {
  const absolute = resolve(filePath)
  const rel = relative(storePaths.projectsRoot, absolute)
  if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`)) {
    throw new Error('File path is outside SoundCue project storage.')
  }
  return absolute
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/project' && req.method === 'GET') return sendJson(res, 200, await readProject())
  if (url.pathname === '/api/demo' && req.method === 'POST') return sendJson(res, 200, await createDemoProject())
  if (url.pathname === '/api/import-audio' && req.method === 'POST') return sendJson(res, 200, await importAudioFromDataUrl(JSON.parse(await readBody(req))))
  if (url.pathname === '/api/import-text' && req.method === 'POST') return sendJson(res, 200, await createTextDraft(JSON.parse(await readBody(req))))
  if (url.pathname === '/api/transcribe' && req.method === 'POST') return sendJson(res, 200, await transcribeVersion(JSON.parse((await readBody(req)) || '{}')))
  if (url.pathname === '/api/annotations' && req.method === 'POST') return sendJson(res, 200, await createAnnotation(JSON.parse(await readBody(req))))
  if ((url.pathname === '/api/codex-requests' || url.pathname === '/api/edit-briefs') && req.method === 'POST') return sendJson(res, 200, await createCodexRequest(JSON.parse(await readBody(req))))
  if (url.pathname === '/api/patches' && req.method === 'POST') return sendJson(res, 200, await generatePatchCandidate(JSON.parse(await readBody(req))))
  if (url.pathname === '/api/open-folder' && req.method === 'POST') return sendJson(res, 200, await openFolder(JSON.parse((await readBody(req)) || '{}').kind))
  if (url.pathname === '/api/paths' && req.method === 'GET') return sendJson(res, 200, storePaths)
  if (url.pathname === '/api/runtime' && req.method === 'GET') return sendJson(res, 200, await readRuntimeStatus())

  const applyMatch = /^\/api\/patches\/([^/]+)\/apply$/.exec(url.pathname)
  if (applyMatch && req.method === 'POST') return sendJson(res, 200, await applyPatch({ patchId: applyMatch[1] }))

  const transcriptMatch = /^\/api\/transcripts\/([^/]+)$/.exec(url.pathname)
  if (transcriptMatch && req.method === 'GET') return sendJson(res, 200, await readTranscript(transcriptMatch[1]))

  const runtimeInstallMatch = /^\/api\/runtime\/([^/]+)\/install$/.exec(url.pathname)
  if (runtimeInstallMatch && req.method === 'POST') return sendJson(res, 200, await installRuntime(runtimeInstallMatch[1]))

  const runtimeCancelMatch = /^\/api\/runtime\/([^/]+)\/cancel$/.exec(url.pathname)
  if (runtimeCancelMatch && req.method === 'POST') return sendJson(res, 200, cancelRuntimeInstall(runtimeCancelMatch[1]) ?? {})

  const runtimeLogMatch = /^\/api\/runtime\/([^/]+)\/log$/.exec(url.pathname)
  if (runtimeLogMatch && req.method === 'GET') return sendJson(res, 200, await readRuntimeLog(runtimeLogMatch[1]))

  if (url.pathname === '/api/file' && req.method === 'GET') {
    const filePath = assertSafeProjectPath(url.searchParams.get('path'))
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) throw new Error('Requested path is not a file.')
    res.writeHead(200, { 'content-type': mimeTypeForPath(filePath) })
    createReadStream(filePath).pipe(res)
    return true
  }

  return false
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname
  const absolute = resolve(join(distRoot, requested))
  const rel = relative(distRoot, absolute)
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }
  try {
    const fileStat = await stat(absolute)
    if (!fileStat.isFile()) throw new Error('Not a file')
    res.writeHead(200, { 'content-type': mimeTypeForPath(absolute) })
    createReadStream(absolute).pipe(res)
  } catch {
    const index = await readFile(join(distRoot, 'index.html'))
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(index)
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${host}:${port}`)
  try {
    if (url.pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, url)
      if (handled !== false) return
      res.writeHead(404)
      res.end('Not found')
      return
    }
    await serveStatic(req, res, url)
  } catch (error) {
    sendJson(res, 500, { error: error.message })
  }
})

server.listen(port, host, () => {
  console.log(`SoundCue UI listening on http://${host}:${port}/`)
})
