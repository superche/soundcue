#!/usr/bin/env node
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = resolve(process.argv[2] || join(projectRoot, 'build', 'soundcue-marketplace'))
const pluginRoot = join(outputRoot, 'plugins', 'soundcue')
const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
const releaseTag = `v${packageJson.version}`

const files = [
  '.mcp.json',
  'index.html',
  'package-lock.json',
  'package.json',
  'README.md',
  'vite.config.js'
]

const directories = [
  '.codex-plugin',
  'dist',
  'docs',
  'lib',
  'mcp',
  'scripts',
  'skills',
  'src'
]

const sampleFiles = [
  'samples/podcastfillers/fixture_manifest.json',
  'samples/podcastfillers/sample_rows.json',
  'samples/podcastfillers/PodcastFillers.csv',
  'samples/podcastfillers/clips/00020.wav'
]

await rm(outputRoot, { recursive: true, force: true })
await mkdir(join(outputRoot, '.claude-plugin'), { recursive: true })
await mkdir(pluginRoot, { recursive: true })

await cp(
  join(projectRoot, 'marketplace', '.claude-plugin', 'marketplace.json'),
  join(outputRoot, '.claude-plugin', 'marketplace.json')
)

for (const file of files) {
  await cp(join(projectRoot, file), join(pluginRoot, file))
}

for (const directory of directories) {
  await cp(join(projectRoot, directory), join(pluginRoot, directory), {
    recursive: true,
    filter: (source) => !source.includes('/node_modules/')
  })
}

for (const sample of sampleFiles) {
  const target = join(pluginRoot, sample)
  await mkdir(dirname(target), { recursive: true })
  await cp(join(projectRoot, sample), target)
}

await writeFile(join(outputRoot, 'README.md'), [
  '# SoundCue Marketplace',
  '',
  'Install the published release:',
  '',
  '```bash',
  `codex plugin marketplace add superche/soundcue --ref ${releaseTag}`,
  'codex plugin add soundcue@soundcue',
  '```',
  '',
  'Install this local snapshot:',
  '',
  '```bash',
  `codex plugin marketplace add ${outputRoot}`,
    'codex plugin add soundcue@soundcue',
  '```',
  ''
].join('\n'))

console.log(JSON.stringify({
  marketplaceRoot: outputRoot,
  pluginRoot,
  install: [
    `codex plugin marketplace add ${outputRoot}`,
    'codex plugin add soundcue@soundcue'
  ]
}, null, 2))
