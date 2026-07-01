import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, relative, sep, resolve } from 'node:path'
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
} from './lib/audioPatchStore.mjs'
import {
  cancelRuntimeInstall,
  installRuntime,
  readRuntimeLog,
  readRuntimeStatus
} from './lib/runtimeManager.mjs'

function mimeTypeForPath(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case '.wav':
      return 'audio/wav'
    case '.mp3':
      return 'audio/mpeg'
    case '.m4a':
      return 'audio/mp4'
    case '.json':
      return 'application/json'
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 120 * 1024 * 1024) {
        reject(new Error('Request body is too large.'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}

function audioPatchApiPlugin() {
  return {
    name: 'audio-patch-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://127.0.0.1')
        try {
          if (url.pathname === '/api/project') {
            if (req.method === 'GET') {
              sendJson(res, 200, await readProject())
              return
            }
          }

          if (url.pathname === '/api/demo') {
            if (req.method === 'POST') {
              sendJson(res, 200, await createDemoProject())
              return
            }
          }

          if (url.pathname === '/api/import-audio' && req.method === 'POST') {
            const payload = JSON.parse(await readBody(req))
            sendJson(res, 200, await importAudioFromDataUrl(payload))
            return
          }

          if (url.pathname === '/api/import-text' && req.method === 'POST') {
            const payload = JSON.parse(await readBody(req))
            sendJson(res, 200, await createTextDraft(payload))
            return
          }

          if (url.pathname === '/api/transcribe' && req.method === 'POST') {
            const payload = JSON.parse((await readBody(req)) || '{}')
            sendJson(res, 200, await transcribeVersion(payload))
            return
          }

          if (url.pathname === '/api/annotations' && req.method === 'POST') {
            const payload = JSON.parse(await readBody(req))
            sendJson(res, 200, await createAnnotation(payload))
            return
          }

          if (url.pathname === '/api/codex-requests' && req.method === 'POST') {
            const payload = JSON.parse(await readBody(req))
            sendJson(res, 200, await createCodexRequest(payload))
            return
          }

          if (url.pathname === '/api/edit-briefs' && req.method === 'POST') {
            const payload = JSON.parse(await readBody(req))
            sendJson(res, 200, await createCodexRequest(payload))
            return
          }

          if (url.pathname === '/api/patches' && req.method === 'POST') {
            const payload = JSON.parse(await readBody(req))
            sendJson(res, 200, await generatePatchCandidate(payload))
            return
          }

          const applyMatch = /^\/api\/patches\/([^/]+)\/apply$/.exec(url.pathname)
          if (applyMatch && req.method === 'POST') {
            sendJson(res, 200, await applyPatch({ patchId: applyMatch[1] }))
            return
          }

          const transcriptMatch = /^\/api\/transcripts\/([^/]+)$/.exec(url.pathname)
          if (transcriptMatch && req.method === 'GET') {
            sendJson(res, 200, await readTranscript(transcriptMatch[1]))
            return
          }

          if (url.pathname === '/api/open-folder' && req.method === 'POST') {
            const payload = JSON.parse((await readBody(req)) || '{}')
            sendJson(res, 200, await openFolder(payload.kind))
            return
          }

          if (url.pathname === '/api/paths' && req.method === 'GET') {
            sendJson(res, 200, storePaths)
            return
          }

          if (url.pathname === '/api/runtime' && req.method === 'GET') {
            sendJson(res, 200, await readRuntimeStatus())
            return
          }

          const runtimeInstallMatch = /^\/api\/runtime\/([^/]+)\/install$/.exec(url.pathname)
          if (runtimeInstallMatch && req.method === 'POST') {
            sendJson(res, 200, await installRuntime(runtimeInstallMatch[1]))
            return
          }

          const runtimeCancelMatch = /^\/api\/runtime\/([^/]+)\/cancel$/.exec(url.pathname)
          if (runtimeCancelMatch && req.method === 'POST') {
            sendJson(res, 200, cancelRuntimeInstall(runtimeCancelMatch[1]) ?? {})
            return
          }

          const runtimeLogMatch = /^\/api\/runtime\/([^/]+)\/log$/.exec(url.pathname)
          if (runtimeLogMatch && req.method === 'GET') {
            sendJson(res, 200, await readRuntimeLog(runtimeLogMatch[1]))
            return
          }

          if (url.pathname === '/api/file' && req.method === 'GET') {
            const filePath = assertSafeProjectPath(url.searchParams.get('path'))
            const fileStat = await stat(filePath)
            if (!fileStat.isFile()) throw new Error('Requested path is not a file.')
            res.statusCode = 200
            res.setHeader('content-type', mimeTypeForPath(filePath))
            createReadStream(filePath).pipe(res)
            return
          }

          next()
        } catch (error) {
          sendJson(res, 500, { error: error.message })
        }
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), audioPatchApiPlugin()],
  server: {
    host: '127.0.0.1',
    port: 43231
  }
})
