# SoundCue User Manual

SoundCue is a Codex plugin for audio review. It is designed for podcasts, interviews, meeting recordings, and voiceover drafts: select a transcript-linked audio range, add a document-style note, copy an edit brief into Codex, review the proposed edit, and create a new audio version after approval.

SoundCue's core rule: **the original audio is never overwritten**. Every confirmed edit creates a new derived `v2`, `v3`, or later file. The original `v1` remains unchanged.

## When To Use SoundCue

- Podcast creators: shorten intros, rewrite a spoken section, remove filler, and compare before/after playback.
- Interview or meeting editors: locate a precise spoken range, attach an edit note, and hand structured context to Codex.
- Audio content operators: turn review requests into local annotations and versioned files.
- Teams that need local processing: audio files, transcripts, annotations, and versions stay on the user's machine by default.

SoundCue is not a full DAW and not an automatic publishing tool. Its focused workflow is: **range selection, annotation, edit brief, review, and derived audio version creation**.

## Install The Plugin

In the SoundCue project directory, build a local marketplace snapshot:

```bash
npm install
npm run package:marketplace
```

Install it through the Codex plugin flow:

```bash
codex plugin marketplace add ./build/soundcue-marketplace
codex plugin add soundcue@soundcue-local
```

After installation, Codex can load the SoundCue skill and MCP tools. In a Codex conversation, ask:

```text
Open the SoundCue UI
```

Or ask Codex to call the MCP tool:

```text
open_soundcue_ui
```

For local development or debugging, run:

```bash
npm run dev:local-stt
```

Then open:

```text
http://127.0.0.1:43231/
```

## First Run: Check Settings

After opening SoundCue, go to the `Settings` tab.

You will see four dependency layers:

- `Core`: SoundCue UI, project files, annotations, and version management. Bundled with the plugin.
- `Audio tools`: `ffmpeg` and `ffprobe`, used for slicing, rendering, and export. Required for real audio edits.
- `Transcript`: local Whisper / whisper.cpp, used for audio transcription.
- `Voice provider`: OpenVoice, optional, used for generated replacement speech. It is larger and not required for basic review.

If a layer shows `Missing`, click the install button on that card. During installation, SoundCue shows the current phase, step, elapsed time, log entry point, and cancel state.

Useful checks:

```bash
npm run stt:check
npm run voice:check
```

OpenVoice is optional. You can skip it for cutting, deleting, and annotation-only workflows. Install it only when you need generated replacement speech.

## Language

SoundCue supports English and Chinese. Use the language icon in the top-right corner for quick switching, or open the top `Settings` tab and choose a language in the `Language` section.

The language setting affects:

- UI copy
- default annotation wording
- edit briefs copied into the Codex composer

Chinese copy is written for Chinese podcast creators. English copy is written as native product copy, not as a literal translation.

## Where Data Is Stored

Each Codex conversation maps to one SoundCue project. The default local directory is:

```text
audio-patch-projects/<thread-id>/
```

It contains:

```text
project.json
assets/
transcripts/
annotations/
patches/
versions/
export/
```

User audio is not uploaded by default. Built-in processing runs locally unless you explicitly configure an external cloud provider.

## Complete Workflow

### 1. Open SoundCue

In Codex, ask the plugin to open the UI:

```text
Open the SoundCue UI
```

If the UI does not open automatically, check that the MCP tool `open_soundcue_ui` is available, or start it manually:

```bash
node scripts/start-ui.mjs
```

### 2. Import Audio

Click `Import audio` in the top-left area and choose a local audio file.

Common browser-readable formats are supported, including:

- `mp3`
- `wav`
- `m4a`

After import, SoundCue creates a new project version such as `v1`.

### 3. Transcribe Audio

If local STT is configured, transcription runs automatically after import.

If it does not run automatically, click `Transcribe`.

When transcription succeeds, the `Transcript Review` area shows a vertical transcript document. Click any segment to link the transcript selection to the bottom player and waveform.

If transcription fails, open the `Settings` tab and inspect the `Transcript` card and logs. Common causes:

- `whisper-cli` is not installed.
- The Whisper model is missing.
- `AUDIO_PATCH_STT_COMMAND` points to the wrong command.

### 4. Select A Range

In `Transcript Review`, click a transcript segment. The right `Edit Notes` drawer shows the selected range and text.

The bottom player shows current time, total duration, selected range, and waveform. During playback, the transcript selection and timestamp update with the audio.

### 5. Add An Annotation

Choose an intent in the right drawer:

- `Shorten`: make the section more concise.
- `Delete`: remove the section.
- `Rewrite`: replace the spoken text.
- `Revoice`: regenerate the speech.
- `Keep`: keep the section but mark it.
- `Issue`: flag a problem without editing immediately.

Write your request in `Edit note`, for example:

```text
Shorten this part and make the tone calmer.
```

Click `Save annotation`.

### 6. Prepare An Edit Brief

Click `Prepare edit brief` or `Update brief`.

SoundCue packages the audio path, transcript path, selected time range, intent, note, and selected text into a structured brief.

Click `Copy brief` and paste it into the Codex composer.

Important: the brief is context, not permission to edit files automatically. The copied brief states:

```text
Use this as context only. Do not modify audio files or project files unless I explicitly ask in the composer.
```

### 7. Discuss The Edit With Codex

After pasting the brief into Codex, ask for a plan first:

```text
Help me reason about the edit. Do not modify audio yet; propose the exact edit plan first.
```

After you approve the plan, explicitly authorize file generation:

```text
Approved. Generate a new file.
```

This keeps the human approval boundary clear.

### 8. Review Suggested Edit

When a suggested edit is available, switch to `Suggested Edit`.

The review view includes:

- summary: what changed
- original audio: player for the original version
- suggested edit: player for the candidate
- transcript change: candidate transcript text

Play both versions and check sound quality, meaning, and pacing.

### 9. Create A New Version

If you accept the candidate, click `Create version`.

SoundCue creates a new derived audio version, for example:

```text
v1 -> v2
```

The original `v1` is not overwritten. The project pointer moves to `v2`.

### 10. Open The Local Folder

Click the folder button in the top-right corner, or ask Codex to call:

```text
open_audio_patch_folder
```

You can inspect:

- original audio versions
- newly generated versions
- transcript JSON files
- annotations
- patches
- export files

## Multi-Version Workflow

SoundCue uses linear versions:

```text
v1 -> v2 -> v3 -> v4
```

It does not create Git-style branches and does not overwrite history.

Recommended practice:

- Edit one clear range at a time.
- Create one new version after each approved edit.
- If the result is not good enough, annotate the current version and create another version.
- Use the `Suggested Edit` comparison players to review differences.

## Using OpenVoice

OpenVoice is the built-in optional local voice provider. It is used for generated replacement speech, such as `Rewrite`, `Revoice`, or speech-generating `Shorten` edits.

Install:

```bash
npm run voice:setup -- --install
```

Check:

```bash
npm run voice:check
```

Enable:

```bash
npm run dev:openvoice
```

Or set:

```bash
AUDIO_PATCH_VOICE_PROVIDER=openvoice
```

Notes:

- OpenVoice is large and can take several minutes to install.
- Open-source voice cloning may not match commercial TTS quality.
- For high-quality audio, prefer source-preserving edits such as cut, delete, and concise splicing when possible.

## Troubleshooting

### No Transcript After Import

Click `Transcribe`. If it still fails, open `Settings` and inspect the `Transcript` card.

You can also run:

```bash
npm run stt:check
```

### Transcription Fails

Check:

- whether `whisper-cli` is installed
- whether the Whisper model exists
- whether `AUDIO_PATCH_STT_COMMAND` points to an executable adapter

Recommended macOS setup:

```bash
brew install whisper-cpp
npm run stt:setup
```

### The Generated Voice Does Not Match The Original Speaker

This is a limitation of OpenVoice or the configured voice provider. Alternatives:

- delete or shorten the original source audio
- keep the original voice and only splice/cut
- use a higher-quality external voice provider through `AUDIO_PATCH_VOICE_COMMAND`

### Does Create Version Modify The Original Audio?

No. SoundCue treats the original version as immutable. `Create version` creates a new derived audio file.

### How Do I Check If The Plugin Is Deliverable?

Run the fast smoke test during normal iteration:

```bash
npm run test:smoke
```

It verifies the MCP edit-plan schema, UI server, approved-plan suggested edit generation, derived-version creation, and unchanged original audio hash.

Run the full handoff gate before delivery:

```bash
npm run verify:deliverable
```

It verifies:

- plugin manifest
- MCP tools
- Runtime state in Settings
- Codex marketplace installation
- packaged MCP tools
- packaged UI server
- complete audio journey
- unchanged `v1` hash and changed `v2` hash

## Recommended Workflow

- Use short, precise selections instead of annotating a long section at once.
- After copying a brief into Codex, ask for an edit plan before authorizing file generation.
- Always compare playback in `Suggested Edit` before creating a version.
- Treat OpenVoice as optional; do not let voice quality block the core review workflow.
- Open the project folder when you need to inspect exact local files and versions.
