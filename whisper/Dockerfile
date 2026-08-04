# SPDX-License-Identifier: AGPL-3.0-only
FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04@sha256:ac55d124da4882b497f732d8dfd9a702d5447a5f29d08d56da6f64f0a1eb34bc

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models \
    WHISPER_MODEL_CACHE=/models

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ffmpeg curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 transcription

WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN python3 -m pip install --break-system-packages --no-cache-dir -r requirements.txt
COPY engine.py app.py ./
RUN mkdir -p /models && chown -R transcription:transcription /app /models

USER transcription
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["curl", "-fsS", "http://127.0.0.1:8787/health"]
CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8787", "--workers", "1"]
