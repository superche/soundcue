# SoundCue Codex Plugin

Lightweight Codex plugin prototype for audio review:

```text
audio/text input
-> transcript-first review
-> document-style annotation drawer
-> reviewed edit brief
-> before/after preview
-> linear v1/v2/v3 versions
-> open local output folder
```

The goal is not to build a DAW or a full podcast platform. The first product slice is **audio range notes plus local suggested edit review**.

Product invariant: SoundCue never overwrites the original audio version. A confirmed edit creates a new derived `vN` audio file and moves the project pointer to that version.

## User Manuals

- [中文用户手册](docs/USER_MANUAL.zh-CN.md)
- [English User Manual](docs/USER_MANUAL.en.md)

## Start

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:43231/
```

## Install As A Codex Plugin

Build a local marketplace snapshot:

```bash
npm run package:marketplace
```

Install through the Codex plugin flow:

```bash
codex plugin marketplace add ./build/soundcue-marketplace
codex plugin add soundcue@soundcue
```

This installs the SoundCue skills and MCP server configuration from the packaged plugin. The local UI is still served by the plugin package command:

```bash
node scripts/start-ui.mjs
```

From Codex, use the MCP tool `open_soundcue_ui` to start and open the packaged UI. For local development, keep using `npm run dev:local-stt`.

## MCP

The MCP server exposes typed local tools. SoundCue prepares edit briefs; it does not treat a brief as permission for an agent to modify audio automatically:

```bash
npm run start:mcp
```

The local MCP config is:

```text
.mcp.json
```

The plugin manifest points to this config through `.codex-plugin/plugin.json`, so Codex can load the MCP server when the plugin is installed.

## Project Boundary

By default, each conversation maps to one local project using `AUDIO_PATCH_THREAD_ID`:

```text
audio-patch-projects/<thread-id>/
```

If no thread id is provided, the dev server uses `local-thread`.

Environment variables:

- `AUDIO_PATCH_PROJECTS_DIR`: base directory for all projects.
- `AUDIO_PATCH_THREAD_ID`: current conversation/project id.
- `AUDIO_PATCH_STT_COMMAND`: optional command for real transcription. SoundCue calls it as `<command> <audioPath> <outputJsonPath>`.
- `AUDIO_PATCH_TTS_COMMAND`: optional command for real TTS.
- `AUDIO_PATCH_VOICE_PROVIDER`: set to `openvoice` to generate replacement speech from a reference clip.
- `AUDIO_PATCH_VOICE_COMMAND`: optional custom voice provider command. SoundCue calls it as `<command> <textPath> <referenceAudioPath> <outputPath>`.

The current MVP ships safe local placeholders for STT/TTS so the schema and UI can be developed without model credentials.

For local UI testing with deterministic transcript output:

```bash
npm run dev:mock-stt
```

The mock adapter is only for interface testing. To call a real local Whisper adapter:

```bash
npm run stt:setup
npm run dev:local-stt
```

`npm run stt:setup` downloads the default `ggml-base.en.bin` model into `models/whisper/` and checks for a local whisper.cpp runner.

Platform notes:

- macOS: preferred path is `whisper-cli` from whisper.cpp. The setup script prints `brew install whisper-cpp`, or can run it with `npm run stt:setup -- --install-runner`.
- Windows: preferred path is `whisper-cli.exe` from a whisper.cpp build on `PATH`. The model path is still managed inside `models/whisper/`.
- Any platform: set `AUDIO_PATCH_STT_SHELL` for a custom local model command template with `{audio}` and `{output}` placeholders.

`scripts/local-whisper-stt.mjs` tries, in order: `AUDIO_PATCH_STT_SHELL`, Python `whisper`, then whisper.cpp `whisper-cli`. For whisper.cpp it uses `AUDIO_PATCH_WHISPER_MODEL` if set, otherwise `models/whisper/ggml-base.en.bin`.

## Local Voice Provider

OpenVoice is available as an experimental local provider for replacement speech. It is used only when a suggested edit needs generated speech; source-audio operations such as cut/delete should remain the default quality-preserving path.

Check local OpenVoice setup:

```bash
npm run voice:check
```

Install the local wrapper environment:

```bash
npm run voice:setup -- --install
```

The setup command clones OpenVoice into `tools/openvoice/OpenVoice` and creates a local Python venv. OpenVoice V2 checkpoints are large and must be placed under:

```text
tools/openvoice/OpenVoice/checkpoints_v2/
  converter/config.json
  converter/checkpoint.pth
  base_speakers/ses/*.pth
```

Run SoundCue with OpenVoice enabled:

```bash
npm run dev:openvoice
```

The built-in OpenVoice adapter contract is:

```text
scripts/openvoice-tts.mjs <textPath> <referenceAudioPath> <outputPath>
```

Useful OpenVoice variables:

- `AUDIO_PATCH_OPENVOICE_PYTHON`: Python executable for the OpenVoice environment.
- `AUDIO_PATCH_OPENVOICE_REPO`: local OpenVoice repo path.
- `AUDIO_PATCH_OPENVOICE_CHECKPOINTS`: checkpoint root, defaults to `checkpoints_v2`.
- `AUDIO_PATCH_OPENVOICE_LANGUAGE`: defaults to `EN_NEWEST`.
- `AUDIO_PATCH_OPENVOICE_SPEAKER`: defaults to `EN-US` when available.
- `AUDIO_PATCH_OPENVOICE_SPEED`: defaults to `0.92`.

## Local Data

```text
audio-patch-projects/<thread-id>/
  project.json
  assets/
  transcripts/
  annotations/
  patches/
  versions/
  export/
```

## Deliverable Check

Run the fast smoke test while iterating:

```bash
npm run test:smoke
```

`test:smoke` builds the UI and verifies the MCP edit-plan schema, packaged UI server, approved-plan suggested edit generation, derived-version creation, and immutable base audio.

Run the full handoff gate before treating the plugin as deliverable:

```bash
npm run build
npm run verify:deliverable
```

`verify:deliverable` checks the plugin manifest, MCP tool exposure, runtime cards, marketplace packaging/install, packaged UI startup, and an approved-plan audio journey that imports a sample, creates an annotation, generates a suggested edit from the exact approved transcript, and creates `v2` while proving `v1` is unchanged.
It performs the Codex plugin install smoke test with a temporary `CODEX_HOME`.

See [docs/SPEC.md](docs/SPEC.md) for schema and UX details.
