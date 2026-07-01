# SoundCue Spec

## Product Slice

Small, focused capability:

> Annotate an audio/transcript range like a document comment, ask Codex for a local suggested edit, then review it and create a new derived audio version.

## Inputs

- Audio file: `mp3`, `wav`, `m4a`, browser-supported local upload.
- Text-only draft: script/transcript text. Codex can synthesize `v1` through a TTS adapter when configured.

## User Journey

1. Open plugin in a Codex conversation.
2. The plugin restores or creates the project bound to that conversation.
3. Import audio or paste text.
4. Codex prepares `v1`: transcription/alignment or text-first synthetic draft.
5. User reviews transcript vertically, like a document.
6. User selects a transcript/audio range and creates a right-drawer annotation.
7. Codex generates a suggested edit.
8. User switches to Suggested Edit to compare current version vs candidate.
9. User confirms the candidate, creating a new immutable-derived `v2`, `v3`, etc. The base version is never overwritten.
10. User opens the local project/export folder.

## Layout

- Header: project title, current version, Review/Suggested Edit switch.
- Review view: vertical transcript document.
- Right drawer: collapsible note drawer.
- Bottom sticky player: playback controls, current range waveform, preview original/edit.
- Suggested Edit view: selected version comparison, transcript change, edit summary, create-version/revise actions.

## Core Schema

```json
{
  "projectId": "proj_local-thread",
  "threadId": "local-thread",
  "currentVersionId": "v2",
  "versions": ["v1", "v2"],
  "annotations": ["ann_001"],
  "patches": ["patch_001"]
}
```

Annotation:

```json
{
  "annotationId": "ann_001",
  "projectId": "proj_local-thread",
  "targetVersionId": "v1",
  "range": {
    "startMs": 134000,
    "endMs": 149000,
    "segmentIds": ["seg_018"],
    "selectedText": "This intro takes too long."
  },
  "intent": {
    "type": "shorten",
    "note": "Shorten this section and keep the tone calm.",
    "constraints": ["keep_meaning", "natural_transition"]
  },
  "status": "draft"
}
```

Suggested Edit Candidate (internal `Patch` object):

```json
{
  "patchId": "patch_001",
  "baseVersionId": "v1",
  "annotationId": "ann_001",
  "operation": {
    "type": "replace_range",
    "range": { "startMs": 134000, "endMs": 149000 },
    "candidateAudioPath": "patches/patch_001/preview.wav",
    "candidateTranscript": "Let's start with the conclusion.",
    "crossfadeMs": 300,
    "editPlan": {
      "source": "codex_approved_plan",
      "rationale": "The user approved this exact replacement before generating audio."
    }
  },
  "review": {
    "status": "ready",
    "summary": [
      "Shortened selected range",
      "Generated a calmer phrasing",
      "Prepared local preview audio"
    ]
  }
}
```

## Adapter Boundary

The model layer is deliberately pluggable:

- STT adapter: local Whisper / whisper.cpp / cloud transcription.
- TTS adapter: local Piper/Kokoro/F5-TTS / cloud TTS.
- Edit adapter: ffmpeg for deterministic slicing/rendering.

The product contract is stable even if providers change.

## V1 Runtime Delivery

V1 includes the complete runtime dependency flow across four layers. Optional
means the user does not need it for every edit path; it does not mean the
installation, configuration, and verification experience can be incomplete.

```text
Core
-> Audio tools
-> Transcript
-> Voice provider
```

Core:

- Required and ready with the plugin.
- Includes the SoundCue UI, MCP server, project-local storage, annotation,
  edit brief, suggested edit review, version metadata, and export folder flow.

Audio tools:

- Required for real audio editing.
- Provides `ffmpeg` and `ffprobe` for media probing, slicing, rendering,
  crossfade, and export.
- Supports automatic install, custom binary paths, status checks, repair, and
  smoke tests.

Transcript:

- Recommended for the default podcast workflow.
- Provides local `whisper.cpp` plus a default `ggml-base.en.bin` model.
- Supports automatic install, custom STT command configuration, status checks,
  repair, and smoke tests.

Voice provider:

- Optional for the core edit path, but fully delivered in V1.
- Includes OpenVoice as the built-in experimental local provider.
- Supports install, checkpoint download, local Python environment setup,
  enable/disable, custom external voice provider command, repair, status checks,
  and a smoke test that generates a short replacement audio file.

## Runtime Manager

Runtime dependencies are managed by a dedicated runtime manager. Runtime files
must be stored in a user-level SoundCue cache, not inside an individual project.

Suggested locations:

```text
macOS:   ~/Library/Application Support/SoundCue/runtimes/
Windows: %APPDATA%/SoundCue/runtimes/
Linux:   ~/.local/share/soundcue/runtimes/
```

Project folders only store user artifacts:

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

The runtime manager owns:

- dependency detection
- install planning
- user approval boundary
- download and extraction
- version/checksum verification
- status persistence
- logs
- repair/retry
- smoke tests
- provider enable/disable state

Runtime states:

```text
missing
planning
waiting_for_user
installing
verifying
ready
enabled
disabled
external_configured
failed
```

## Settings UI

The plugin must expose a Settings panel with a Runtime section that shows all
four layers and their state. This panel is part of V1 acceptance.

Each runtime card should show:

- capability name
- required/recommended/optional badge
- current state
- installed version or configured command path
- storage size when known
- last verification result
- primary action: Install, Enable, Disable, Repair, Configure external, or Run
  test
- secondary action: View logs

Example:

```text
SoundCue Settings

Core
Ready

Audio tools
Required · Missing
Install FFmpeg

Transcript
Recommended · Missing
Install local Whisper

Voice replacement
Optional · Not installed
Install OpenVoice
Configure external provider
```

## Installation Loading Interaction

During installation, the UI must keep the user informed. A long install without
visible progress is a product failure.

The Settings panel must show:

- current install phase
- current step label
- progress when measurable
- indeterminate loading when progress is not measurable
- current downloaded file or package
- estimated size when known
- elapsed time
- concise explanation of what is happening locally
- cancel behavior when the operation is safely cancellable
- log streaming or a `View logs` drawer

Install phase examples:

```text
Checking existing binaries
Downloading ffmpeg
Extracting archive
Downloading Whisper model
Creating Python environment
Installing OpenVoice dependencies
Downloading OpenVoice checkpoints
Running smoke test
Ready
```

OpenVoice install must explicitly warn that it is a larger optional dependency
and may take several minutes. It should not block transcript review or
ffmpeg-only edits.

Failure UI must include:

- failed step
- short reason
- retry action
- repair action when available
- manual setup instructions
- log path or log drawer

## V1 Acceptance Criteria

1. A new user can install the plugin, open SoundCue, and see all four runtime
   layers with truthful status.
2. `ffmpeg` can be installed or configured, then verified by a local slice and
   render smoke test.
3. Local Whisper can be installed or configured, then verified by transcribing a
   short bundled or generated audio sample.
4. OpenVoice can be installed or configured, then verified by generating a short
   replacement audio sample from a local reference clip.
5. OpenVoice remains optional: cut/delete/source-audio edits work without it.
6. When OpenVoice is enabled, replacement speech uses the voice provider path.
7. Install actions are idempotent and can be safely retried.
8. Installation progress and loading states are visible in the plugin UI.
9. Logs are accessible from the Settings panel.
10. No user audio is uploaded unless the user explicitly configures an external
    provider that does so.
11. The original audio version is immutable. Confirmed edits create new derived
    `vN` files; verification must prove the base audio hash is unchanged and
    the derived audio hash differs.
12. The plugin manifest exposes both skills and MCP server configuration so
    Codex can load the typed SoundCue tools after plugin installation.
13. Automated smoke tests verify the MCP edit-plan schema and prove that a
    user-approved `candidateTranscript` is used exactly when generating a
    suggested edit.
