---
name: soundcue-audio-review
description: Review podcast or meeting audio with transcript-linked notes, create suggested edits, and maintain local linear audio versions.
---

# SoundCue Audio Review

Use this skill when the user wants to annotate a podcast, meeting recording, or generated audio segment and ask Codex to produce a local suggested edit.

## Core Boundary

- One Codex conversation maps to one SoundCue project.
- The UI owns selection, comment, preview, and review state.
- Codex owns local file operations and provider calls through typed tools.
- Audio algorithms are adapter-based: local ffmpeg / STT / TTS commands can be configured, and cloud providers can be added later.
- Never modify or overwrite the original audio version. A confirmed edit creates a new derived `vN` audio version.
- Never treat a suggested edit as created until the user explicitly confirms the new version.

## Workflow

1. Read the current project with `read_audio_patch_project`.
2. If needed, import an audio file with `import_audio_file` or create a text-first draft with `create_audio_project_from_text`.
3. Read the annotation selection and intent.
4. Create a suggested edit with `generate_audio_patch_candidate`.
5. Ask the user to review before/after in the UI.
6. Create the derived version only after confirmation with `apply_audio_patch`; the base version must remain unchanged.

## Data Model

- `Project`: bound to `threadId`, contains assets, versions, annotations, patches.
- `Version`: linear `v1`, `v2`, `v3`, never a Git-like branch.
- `Annotation`: user intent attached to transcript/audio range.
- `Patch`: internal object for a generated suggested edit with preview audio, transcript change, and edit summary.

Keep the user-facing explanation in terms of transcript selection, notes, suggested edits, and local versions.
