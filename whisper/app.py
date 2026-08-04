# SPDX-License-Identifier: AGPL-3.0-only
"""OpenAI-compatible local transcription API backed by faster-whisper."""

from __future__ import annotations

import asyncio
import os
import re
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile

try:
    from .engine import WhisperEngine
except ImportError:
    from engine import WhisperEngine


DEFAULT_MODEL = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
MAX_UPLOAD_BYTES = int(os.environ.get("WHISPER_MAX_UPLOAD_BYTES", "25000000"))
API_TOKEN = os.environ.get("WHISPER_API_TOKEN", "")
engine = WhisperEngine()
inference_slot = asyncio.Semaphore(1)
app = FastAPI(title="InfoSteed Transcription Provider", version="1.0.0")


def _authorize(authorization: str | None) -> None:
    if API_TOKEN and authorization != f"Bearer {API_TOKEN}":
        raise HTTPException(status_code=401, detail="Invalid bearer token")


@app.on_event("startup")
async def preload_model() -> None:
    if os.environ.get("WHISPER_PRELOAD", "").lower() not in {"1", "true", "yes"}:
        return
    await asyncio.to_thread(engine.load, DEFAULT_MODEL)


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        "ok": True,
        "device": engine.device,
        "compute_type": engine.compute_type,
        "loaded_model": engine.model_name,
    }


@app.post("/v1/audio/transcriptions")
async def create_transcription(
    file: UploadFile = File(...),
    model: str = Form(DEFAULT_MODEL),
    language: str | None = Form(None),
    prompt: str | None = Form(None),
    response_format: str = Form("verbose_json"),
    timestamp_granularities: list[str] | None = Form(None, alias="timestamp_granularities[]"),
    authorization: str | None = Header(None),
) -> dict[str, object]:
    _authorize(authorization)
    if response_format != "verbose_json":
        raise HTTPException(status_code=400, detail="Only response_format=verbose_json is supported")
    requested = set(timestamp_granularities or ["segment"])
    if not requested.issubset({"segment", "word"}):
        raise HTTPException(status_code=400, detail="Unsupported timestamp granularity")

    requested_suffix = Path(file.filename or "audio.webm").suffix
    suffix = requested_suffix if re.fullmatch(r"\.[A-Za-z0-9]{1,10}", requested_suffix) else ".webm"
    temp_path: Path | None = None
    size = 0
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as target:
            temp_path = Path(target.name)
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail=f"Audio exceeds {MAX_UPLOAD_BYTES} byte limit")
                target.write(chunk)
        if size == 0:
            raise HTTPException(status_code=400, detail="Audio file is empty")
        async with inference_slot:
            return await asyncio.to_thread(
                engine.transcribe,
                temp_path,
                model,
                language,
                prompt,
                "word" in requested,
            )
    finally:
        await file.close()
        if temp_path:
            temp_path.unlink(missing_ok=True)
