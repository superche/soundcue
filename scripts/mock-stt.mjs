#!/usr/bin/env node
import { basename } from 'node:path'
import { writeFile } from 'node:fs/promises'

const [, , audioPath, outputPath] = process.argv

if (!audioPath || !outputPath) {
  process.stderr.write('Usage: mock-stt.mjs <audioPath> <outputJsonPath>\n')
  process.exit(2)
}

const durationMs = Math.max(1000, Number(process.env.AUDIO_PATCH_DURATION_MS || 12000))
const third = Math.max(1, Math.floor(durationMs / 3))
const title = basename(audioPath).replace(/\.[^.]+$/, '')

const payload = {
  language: 'en',
  source: 'mock-stt',
  text: `${title} starts with a short spoken moment. The middle phrase contains the editable section. The final phrase closes the sample.`,
  segments: [
    {
      startMs: 0,
      endMs: Math.min(durationMs, third - 80),
      speaker: 'Speaker',
      text: `${title} starts with a short spoken moment.`
    },
    {
      startMs: third,
      endMs: Math.min(durationMs, third * 2 - 80),
      speaker: 'Speaker',
      text: 'The middle phrase contains the editable section.'
    },
    {
      startMs: third * 2,
      endMs: durationMs,
      speaker: 'Speaker',
      text: 'The final phrase closes the sample.'
    }
  ]
}

await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`)
