#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const toolsRoot = join(projectRoot, 'tools', 'openvoice')
const repoDir = join(toolsRoot, 'OpenVoice')
const venvDir = join(toolsRoot, '.venv')
const pythonBin = process.platform === 'win32'
  ? join(venvDir, 'Scripts', 'python.exe')
  : join(venvDir, 'bin', 'python')
const pipBin = process.platform === 'win32'
  ? join(venvDir, 'Scripts', 'pip.exe')
  : join(venvDir, 'bin', 'pip')
const constraintsPath = join(toolsRoot, 'constraints.txt')
const checkpointUrl = 'https://myshell-public-repo-host.s3.amazonaws.com/openvoice/checkpoints_v2_0417.zip'
const checkpointZip = join(toolsRoot, 'checkpoints_v2_0417.zip')
const checkpointMirrorRepo = 'orionai/openvoice-v2'
const checkpointMirrorFiles = [
  'converter/config.json',
  'converter/checkpoint.pth',
  'base_speakers/ses/en-au.pth',
  'base_speakers/ses/en-br.pth',
  'base_speakers/ses/en-default.pth',
  'base_speakers/ses/en-india.pth',
  'base_speakers/ses/en-newest.pth',
  'base_speakers/ses/en-us.pth',
  'base_speakers/ses/es.pth',
  'base_speakers/ses/fr.pth',
  'base_speakers/ses/jp.pth',
  'base_speakers/ses/kr.pth',
  'base_speakers/ses/zh.pth'
]

const runtimeDependencies = [
  'torch',
  'torchaudio',
  'librosa==0.9.1',
  'pydub==0.25.1',
  'wavmark==0.0.3',
  'numpy<2',
  'eng_to_ipa==0.0.2',
  'inflect==7.0.0',
  'unidecode==1.3.7',
  'pypinyin==0.50.0',
  'cn2an==0.5.22',
  'jieba==0.42.1',
  'langid==1.1.6',
  'soundfile'
]

function run(command, commandArgs, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, { stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'], ...options })
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

async function status() {
  const checkpoints = join(repoDir, 'checkpoints_v2')
  console.log(`OpenVoice repo: ${existsSync(repoDir) ? repoDir : 'missing'}`)
  console.log(`OpenVoice Python: ${existsSync(pythonBin) ? pythonBin : 'missing'}`)
  console.log(`OpenVoice checkpoints: ${existsSync(checkpoints) ? checkpoints : 'missing'}`)
}

function checkpointLooksReady(checkpoints) {
  return (
    existsSync(join(checkpoints, 'converter', 'config.json')) &&
    existsSync(join(checkpoints, 'converter', 'checkpoint.pth')) &&
    existsSync(join(checkpoints, 'base_speakers', 'ses', 'en-us.pth'))
  )
}

async function downloadHuggingFaceMirror(checkpoints) {
  console.log('')
  console.log(`Official checkpoint zip was unavailable. Falling back to Hugging Face mirror: ${checkpointMirrorRepo}`)
  for (const relativePath of checkpointMirrorFiles) {
    const targetPath = join(checkpoints, relativePath)
    if (existsSync(targetPath)) continue

    await mkdir(dirname(targetPath), { recursive: true })
    const url = `https://huggingface.co/${checkpointMirrorRepo}/resolve/main/${relativePath}`
    await run('curl', ['-fL', url, '-o', targetPath], { stdio: 'inherit' })
  }
}

async function downloadCheckpoints() {
  const checkpoints = join(repoDir, 'checkpoints_v2')
  if (checkpointLooksReady(checkpoints)) {
    return
  }

  if (!(await commandExists('curl'))) {
    console.log('')
    console.log('curl is not available. Download OpenVoice V2 checkpoints manually:')
    console.log(`  ${checkpointUrl}`)
    console.log(`Extract them to: ${checkpoints}`)
    return
  }

  if (!(await commandExists('unzip'))) {
    console.log('')
    console.log('unzip is not available. Download and extract OpenVoice V2 checkpoints manually:')
    console.log(`  ${checkpointUrl}`)
    console.log(`Extract them to: ${checkpoints}`)
    return
  }

  await rm(join(toolsRoot, 'checkpoints_v2'), { recursive: true, force: true })
  await rm(checkpoints, { recursive: true, force: true })
  try {
    await run('curl', ['-fL', checkpointUrl, '-o', checkpointZip], { stdio: 'inherit' })
    await run('unzip', ['-tq', checkpointZip], { stdio: 'inherit' })
    await run('unzip', ['-q', '-o', checkpointZip, '-d', toolsRoot], { stdio: 'inherit' })
  } catch {
    await rm(checkpointZip, { force: true })
    await downloadHuggingFaceMirror(checkpoints)
    return
  }

  const extractedInTools = join(toolsRoot, 'checkpoints_v2')
  if (existsSync(extractedInTools) && extractedInTools !== checkpoints) {
    await rename(extractedInTools, checkpoints)
  }
  if (!checkpointLooksReady(checkpoints)) {
    await downloadHuggingFaceMirror(checkpoints)
  }
}

async function install() {
  await mkdir(toolsRoot, { recursive: true })
  if (!existsSync(repoDir)) {
    if (!(await commandExists('git'))) throw new Error('git is required to clone OpenVoice.')
    await run('git', ['clone', 'https://github.com/myshell-ai/OpenVoice.git', repoDir], { stdio: 'inherit' })
  }
  if (!existsSync(pythonBin)) {
    const python = process.env.PYTHON || (await commandExists('python3') ? 'python3' : 'python')
    await run(python, ['-m', 'venv', venvDir], { stdio: 'inherit' })
  }
  await writeFile(constraintsPath, [
    'Cython<3',
    ''
  ].join('\n'))
  await run(pipBin, ['install', '--upgrade', 'pip'], { stdio: 'inherit' })
  await run(pipBin, ['install', 'Cython<3'], { stdio: 'inherit' })

  // OpenVoice's setup.py pulls faster-whisper -> av==10, which fails against
  // FFmpeg 7 on current macOS. SoundCue only needs the TTS and tone-converter
  // runtime, so install OpenVoice editable code without those optional deps.
  await run(pipBin, ['install', '-e', repoDir, '--no-deps'], {
    stdio: 'inherit',
    env: { ...process.env, PIP_CONSTRAINT: constraintsPath }
  })
  await run(pipBin, ['install', ...runtimeDependencies], {
    stdio: 'inherit',
    env: { ...process.env, PIP_CONSTRAINT: constraintsPath }
  })
  await run(pipBin, ['install', 'git+https://github.com/myshell-ai/MeloTTS.git'], {
    stdio: 'inherit',
    env: { ...process.env, PIP_CONSTRAINT: constraintsPath }
  })
  await run(pipBin, ['uninstall', '-y', 'unidic'], { stdio: 'inherit' })
  await run(pythonBin, ['-m', 'nltk.downloader', 'cmudict', 'averaged_perceptron_tagger', 'averaged_perceptron_tagger_eng'], {
    stdio: 'inherit'
  })
  await downloadCheckpoints()
  console.log('')
  console.log('OpenVoice code is installed.')
  console.log('OpenVoice V2 checkpoints should be available at:')
  console.log(`  ${join(repoDir, 'checkpoints_v2')}`)
  console.log('')
  console.log('Expected folders:')
  console.log('  checkpoints_v2/converter/config.json')
  console.log('  checkpoints_v2/converter/checkpoint.pth')
  console.log('  checkpoints_v2/base_speakers/ses/*.pth')
  console.log('')
  console.log('Then run:')
  console.log('  npm run voice:check')
  console.log('  AUDIO_PATCH_VOICE_PROVIDER=openvoice npm run dev:local-stt')
}

if (args.has('--install')) await install()
await status()
