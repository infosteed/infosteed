# SPDX-License-Identifier: AGPL-3.0-only
"""Reusable faster-whisper inference for the API and optional CLI."""

from __future__ import annotations

import os
from pathlib import Path
from threading import Lock
from typing import Any


def _device() -> str:
    configured = os.environ.get("WHISPER_DEVICE")
    if configured:
        return configured
    try:
        import ctranslate2

        return "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    except Exception:
        return "cpu"


class WhisperEngine:
    """Lazily caches one model and serializes GPU inference."""

    def __init__(self, device: str | None = None, compute_type: str | None = None) -> None:
        self.device = device or _device()
        self.compute_type = compute_type or os.environ.get(
            "WHISPER_COMPUTE_TYPE",
            "int8_float16" if self.device == "cuda" else "int8",
        )
        self._model: Any = None
        self._model_name: str | None = None
        self._lock = Lock()

    @property
    def model_name(self) -> str | None:
        return self._model_name

    def load(self, model_name: str) -> None:
        if self._model is not None and self._model_name == model_name:
            return
        from faster_whisper import WhisperModel

        self._model = WhisperModel(
            model_name,
            device=self.device,
            compute_type=self.compute_type,
            download_root=os.environ.get("WHISPER_MODEL_CACHE"),
        )
        self._model_name = model_name

    def transcribe(
        self,
        audio_path: Path,
        model_name: str,
        language: str | None = None,
        prompt: str | None = None,
        word_timestamps: bool = True,
        hotwords: str | None = None,
        task: str = "transcribe",
        beam_size: int | None = None,
        vad_filter: bool = True,
        multilingual: bool = False,
    ) -> dict[str, Any]:
        with self._lock:
            self.load(model_name)
            segment_iterator, info = self._model.transcribe(
                str(audio_path),
                language=language,
                task=task,
                beam_size=beam_size or int(os.environ.get("WHISPER_BEAM_SIZE", "5")),
                vad_filter=vad_filter,
                word_timestamps=word_timestamps,
                condition_on_previous_text=True,
                initial_prompt=prompt,
                hotwords=hotwords,
                multilingual=multilingual,
            )
            segments = []
            words = []
            transcript_parts = []
            for segment in segment_iterator:
                text = segment.text.strip()
                if text:
                    transcript_parts.append(text)
                segment_words = []
                for word in segment.words or []:
                    value = {
                        "word": word.word,
                        "start": word.start,
                        "end": word.end,
                        "probability": word.probability,
                    }
                    segment_words.append(value)
                    words.append(value)
                segments.append(
                    {
                        "id": segment.id,
                        "seek": segment.seek,
                        "start": segment.start,
                        "end": segment.end,
                        "text": text,
                        "tokens": segment.tokens,
                        "temperature": segment.temperature,
                        "avg_logprob": segment.avg_logprob,
                        "compression_ratio": segment.compression_ratio,
                        "no_speech_prob": segment.no_speech_prob,
                        "words": segment_words if word_timestamps else None,
                    }
                )
            return {
                "task": task,
                "language": info.language,
                "language_probability": info.language_probability,
                "duration": info.duration,
                "text": " ".join(transcript_parts),
                "segments": segments,
                "words": words if word_timestamps else [],
            }
