# SPDX-License-Identifier: AGPL-3.0-only
"""Contract tests that do not load a Whisper model."""

from __future__ import annotations

import unittest
import asyncio
from unittest.mock import patch

import httpx

import app as service


async def run_inline(function, *args):
    return function(*args)


async def post_transcription(headers: dict[str, str] | None = None) -> httpx.Response:
    transport = httpx.ASGITransport(app=service.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.post(
            "/v1/audio/transcriptions",
            headers=headers,
            files={"file": ("narration.webm", b"audio", "audio/webm")},
            data={
                "model": "large-v3-turbo",
                "response_format": "verbose_json",
                "timestamp_granularities[]": ["segment", "word"],
                "prompt": "Northstar Outfitters, Product catalogue",
            },
        )


class TranscriptionApiTests(unittest.TestCase):
    def test_health_does_not_require_a_loaded_model(self) -> None:
        response = asyncio.run(service.health())
        self.assertTrue(response["ok"])

    def test_openai_compatible_multipart_response(self) -> None:
        normalized = {
            "task": "transcribe",
            "language": "en",
            "language_probability": 0.99,
            "duration": 1.2,
            "text": "Open the map",
            "segments": [{"id": 0, "start": 0, "end": 1.2, "text": "Open the map"}],
            "words": [{"word": "Open", "start": 0, "end": 0.3, "probability": 0.95}],
        }
        with patch.object(service.engine, "transcribe", return_value=normalized) as transcribe, patch.object(
            service.asyncio, "to_thread", side_effect=run_inline
        ):
            response = asyncio.run(post_transcription())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), normalized)
        self.assertTrue(transcribe.call_args.args[4])

    def test_optional_bearer_authentication(self) -> None:
        with patch.object(service, "API_TOKEN", "local-secret"):
            response = asyncio.run(post_transcription())
        self.assertEqual(response.status_code, 401)

    def test_upload_limit_is_enforced_before_inference(self) -> None:
        with patch.object(service, "MAX_UPLOAD_BYTES", 2):
            response = asyncio.run(post_transcription())
        self.assertEqual(response.status_code, 413)


if __name__ == "__main__":
    unittest.main()
