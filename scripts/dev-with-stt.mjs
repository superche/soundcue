#!/usr/bin/env node
import { spawn } from 'node:child_process'

const mode = process.argv[2] || 'local'
const voiceProvider = process.argv[3]
const adapter = mode === 'mock'
  ? './scripts/mock-stt.mjs'
  : './scripts/local-whisper-stt.mjs'
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const child = spawn(command, ['vite', '--host', '127.0.0.1', '--port', '43231'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    AUDIO_PATCH_STT_COMMAND: adapter,
    ...(voiceProvider ? { AUDIO_PATCH_VOICE_PROVIDER: voiceProvider } : {})
  }
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
