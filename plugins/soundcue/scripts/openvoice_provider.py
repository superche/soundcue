#!/usr/bin/env python3
import os
import sys
from pathlib import Path


def fail(message):
    sys.stderr.write(f"{message}\n")
    raise SystemExit(1)


def patch_mps():
    try:
        import torch
    except Exception:
        return

    if not hasattr(torch.backends, "mps") or not torch.backends.mps.is_available():
        return

    original_load = torch.load

    def safe_load(*args, **kwargs):
        if kwargs.get("map_location") == "mps":
            kwargs["map_location"] = "cpu"
        return original_load(*args, **kwargs)

    torch.load = safe_load


def patch_mecabrc():
    if os.environ.get("MECABRC"):
        return
    try:
        import unidic_lite
    except Exception:
        return

    mecabrc = Path(unidic_lite.DICDIR) / "mecabrc"
    if mecabrc.is_file():
        os.environ["MECABRC"] = str(mecabrc)


if len(sys.argv) != 4:
    fail("Usage: openvoice_provider.py <textPath> <referenceAudioPath> <outputPath>")

text_path = Path(sys.argv[1]).expanduser().resolve()
reference_audio_path = Path(sys.argv[2]).expanduser().resolve()
output_path = Path(sys.argv[3]).expanduser().resolve()
repo = Path(os.environ.get("AUDIO_PATCH_OPENVOICE_REPO", "")).expanduser().resolve()

if not text_path.is_file():
    fail(f"Text file not found: {text_path}")
if not reference_audio_path.is_file():
    fail(f"Reference audio not found: {reference_audio_path}")
if not repo.is_dir():
    fail(f"OpenVoice repo not found: {repo}")

sys.path.insert(0, str(repo))
patch_mps()
patch_mecabrc()

try:
    import torch
    from melo.api import TTS
    from openvoice.api import ToneColorConverter
except Exception as exc:
    fail(f"OpenVoice dependencies are not installed in this Python environment: {exc}")

text = text_path.read_text(encoding="utf-8").strip()
if not text:
    fail("OpenVoice requires non-empty text.")

device = os.environ.get("AUDIO_PATCH_OPENVOICE_DEVICE")
if not device:
    device = "cuda:0" if torch.cuda.is_available() else "cpu"

language = os.environ.get("AUDIO_PATCH_OPENVOICE_LANGUAGE", "EN_NEWEST")
speaker_name = os.environ.get("AUDIO_PATCH_OPENVOICE_SPEAKER", "")
speed = float(os.environ.get("AUDIO_PATCH_OPENVOICE_SPEED", "0.92"))
ckpt_root = Path(os.environ.get("AUDIO_PATCH_OPENVOICE_CHECKPOINTS", repo / "checkpoints_v2")).expanduser().resolve()
converter_ckpt = ckpt_root / "converter"
base_speaker_dir = ckpt_root / "base_speakers" / "ses"

if not converter_ckpt.exists():
    fail(f"OpenVoice converter checkpoints not found: {converter_ckpt}")
if not base_speaker_dir.exists():
    fail(f"OpenVoice base speaker embeddings not found: {base_speaker_dir}")

work_dir = output_path.parent / f"{output_path.stem}.openvoice_work"
work_dir.mkdir(parents=True, exist_ok=True)
base_audio = work_dir / "base.wav"
target_se_path = work_dir / "target_se.pth"

tts = TTS(language=language, device=device)
speaker_ids = getattr(tts.hps, "data").spk2id
if not speaker_name:
    speaker_name = "EN-US" if "EN-US" in speaker_ids else next(iter(speaker_ids.keys()))
if speaker_name not in speaker_ids:
    fail(f"OpenVoice speaker '{speaker_name}' not available. Available speakers: {', '.join(speaker_ids.keys())}")

speaker_key = speaker_name.lower().replace("_", "-")
source_se_path = base_speaker_dir / f"{speaker_key}.pth"
if not source_se_path.exists():
    available = ", ".join(path.stem for path in sorted(base_speaker_dir.glob("*.pth")))
    fail(f"OpenVoice source speaker embedding not found: {source_se_path}. Available: {available}")

tone_color_converter = ToneColorConverter(str(converter_ckpt / "config.json"), device=device)
tone_color_converter.load_ckpt(str(converter_ckpt / "checkpoint.pth"))
source_se = torch.load(str(source_se_path), map_location=device)
target_se = tone_color_converter.extract_se([str(reference_audio_path)], se_save_path=str(target_se_path))

tts.tts_to_file(text, speaker_ids[speaker_name], str(base_audio), speed=speed)
tone_color_converter.convert(
    audio_src_path=str(base_audio),
    src_se=source_se,
    tgt_se=target_se,
    output_path=str(output_path),
    message=os.environ.get("AUDIO_PATCH_OPENVOICE_WATERMARK", "@SoundCue")
)

print(str(output_path))
