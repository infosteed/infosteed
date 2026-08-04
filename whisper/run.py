#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Transcribe a InfoSteed recording with faster-whisper."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


DEFAULT_MODEL = "large-v3-turbo"
DEFAULT_DEVICE = "cuda"
DEFAULT_COMPUTE_TYPE = "int8_float16"
LIBRARY_REEXEC_FLAG = "INFOSTEED_WHISPER_LIBRARY_PATH_READY"


def activate_local_venv() -> None:
    """Re-exec with the adjacent virtual environment when run directly."""
    venv_dir = Path(__file__).resolve().parent / ".venv-stt"
    if Path(sys.prefix).resolve() == venv_dir.resolve():
        return

    executable = (
        venv_dir / "Scripts" / "python.exe"
        if os.name == "nt"
        else venv_dir / "bin" / "python"
    )
    if not executable.is_file():
        raise RuntimeError(f"Whisper virtual environment not found: {venv_dir}")
    os.execve(
        str(executable),
        [str(executable), str(Path(__file__).resolve()), *sys.argv[1:]],
        os.environ.copy(),
    )


def configure_nvidia_library_path() -> None:
    """Re-exec once so pip-installed CUDA libraries are visible to CTranslate2."""
    if os.name != "posix" or os.environ.get(LIBRARY_REEXEC_FLAG) == "1":
        return

    python_version = f"python{sys.version_info.major}.{sys.version_info.minor}"
    site_packages = Path(sys.prefix) / "lib" / python_version / "site-packages"
    library_dirs = [
        site_packages / "nvidia" / "cublas" / "lib",
        site_packages / "nvidia" / "cudnn" / "lib",
    ]
    existing_dirs = [str(path) for path in library_dirs if path.is_dir()]
    if not existing_dirs:
        return

    current = os.environ.get("LD_LIBRARY_PATH", "")
    current_dirs = [entry for entry in current.split(os.pathsep) if entry]
    missing_dirs = [entry for entry in existing_dirs if entry not in current_dirs]
    if not missing_dirs:
        return

    environment = os.environ.copy()
    environment["LD_LIBRARY_PATH"] = os.pathsep.join(missing_dirs + current_dirs)
    environment[LIBRARY_REEXEC_FLAG] = "1"
    os.execve(
        sys.executable,
        [sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]],
        environment,
    )


def read_optional_text(value: str | None, file_path: Path | None) -> str | None:
    if file_path is not None:
        return file_path.read_text(encoding="utf-8").strip() or None
    return value.strip() if value and value.strip() else None


def positive_integer(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Transcribe WebM, WAV, MP3, or another supported audio/video file "
            "and emit timestamped JSON."
        )
    )
    parser.add_argument("audio", type=Path, help="Path to the recording to transcribe")
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        help="Write JSON to this file instead of standard output",
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("WHISPER_MODEL", DEFAULT_MODEL),
        help=f"Whisper model name (default: {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--device",
        default=os.environ.get("WHISPER_DEVICE", DEFAULT_DEVICE),
        help=f"Inference device (default: {DEFAULT_DEVICE})",
    )
    parser.add_argument(
        "--compute-type",
        default=os.environ.get("WHISPER_COMPUTE_TYPE", DEFAULT_COMPUTE_TYPE),
        help=f"CTranslate2 compute type (default: {DEFAULT_COMPUTE_TYPE})",
    )
    parser.add_argument(
        "--language",
        help="ISO language code; omit to detect the spoken language",
    )
    parser.add_argument(
        "--task",
        choices=("transcribe", "translate"),
        default="transcribe",
        help="Keep the spoken language or translate it to English",
    )
    parser.add_argument(
        "--beam-size",
        type=positive_integer,
        default=5,
        help="Beam-search width (default: 5)",
    )
    context_group = parser.add_mutually_exclusive_group()
    context_group.add_argument(
        "--context",
        help="Short recording title, purpose, and expected terminology",
    )
    context_group.add_argument(
        "--context-file",
        type=Path,
        help="Read the recording context from a UTF-8 text file",
    )
    hotwords_group = parser.add_mutually_exclusive_group()
    hotwords_group.add_argument(
        "--hotwords",
        help="Comma-separated product names, place names, and UI terminology",
    )
    hotwords_group.add_argument(
        "--hotwords-file",
        type=Path,
        help="Read hotwords from a UTF-8 text file",
    )
    parser.add_argument(
        "--multilingual-detection",
        action="store_true",
        help="Detect language per segment for recordings that switch languages",
    )
    parser.add_argument(
        "--no-vad",
        action="store_true",
        help="Disable voice-activity filtering",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON instead of emitting a compact document",
    )
    return parser


def transcribe(args: argparse.Namespace) -> dict[str, object]:
    from engine import WhisperEngine

    context = read_optional_text(args.context, args.context_file)
    hotwords = read_optional_text(args.hotwords, args.hotwords_file)
    engine = WhisperEngine(device=args.device, compute_type=args.compute_type)
    result = engine.transcribe(
        args.audio,
        args.model,
        language=args.language,
        prompt=context,
        word_timestamps=True,
        hotwords=hotwords,
        task=args.task,
        beam_size=args.beam_size,
        vad_filter=not args.no_vad,
        multilingual=args.multilingual_detection,
    )
    return {
        "model": args.model,
        **result,
    }


def main() -> int:
    try:
        activate_local_venv()
    except RuntimeError as error:
        print(error, file=sys.stderr)
        return 1

    parser = build_parser()
    args = parser.parse_args()
    if not args.audio.is_file():
        parser.error(f"audio file does not exist: {args.audio}")
    for option_name in ("context_file", "hotwords_file"):
        file_path = getattr(args, option_name)
        if file_path is not None and not file_path.is_file():
            parser.error(f"file does not exist: {file_path}")

    configure_nvidia_library_path()
    try:
        result = transcribe(args)
    except Exception as error:
        print(f"Transcription failed: {error}", file=sys.stderr)
        return 1

    indent = 2 if args.pretty else None
    output = json.dumps(result, ensure_ascii=False, indent=indent)
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + "\n", encoding="utf-8")
    else:
        print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
