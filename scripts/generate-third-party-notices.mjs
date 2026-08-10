// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const target = "THIRD_PARTY_NOTICES.md";
const manualNoticesStart =
  "<!-- BEGIN MANUALLY MAINTAINED VENDORED SOURCE NOTICES -->";
const manualNoticesEnd =
  "<!-- END MANUALLY MAINTAINED VENDORED SOURCE NOTICES -->";

function readManualNotices() {
  const existing = readFileSync(target, "utf8");
  const start = existing.indexOf(manualNoticesStart);
  const end = existing.indexOf(manualNoticesEnd);
  if (
    start === -1 ||
    end === -1 ||
    end < start ||
    existing.indexOf(manualNoticesStart, start + manualNoticesStart.length) !==
      -1 ||
    existing.indexOf(manualNoticesEnd, end + manualNoticesEnd.length) !== -1
  ) {
    throw new Error(
      `${target} must contain exactly one complete manually maintained vendored-source notice section`,
    );
  }
  return existing.slice(start, end + manualNoticesEnd.length);
}

const manualNotices = readManualNotices();
const raw = process.env.NOTICE_INVENTORY_FILE
  ? readFileSync(process.env.NOTICE_INVENTORY_FILE, "utf8")
  : (() => {
      const pnpmCli = process.env.npm_execpath;
      if (!pnpmCli) throw new Error("Run this generator through pnpm");
      return execFileSync(
        process.execPath,
        [pnpmCli, "licenses", "list", "--prod", "--json"],
        { encoding: "utf8" },
      );
    })();
const grouped = JSON.parse(raw);
const packages = Object.entries(grouped)
  .flatMap(([license, entries]) =>
    entries.map((entry) => ({
      name: entry.name,
      versions: entry.versions.join(", "),
      license,
      homepage: entry.homepage ?? "",
    })),
  )
  .sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.versions.localeCompare(right.versions),
  );

const rows = packages
  .map(
    (entry) =>
      `| ${entry.name.replaceAll("|", "\\|")} | ${entry.versions} | ${entry.license.replaceAll("|", "\\|")} | ${entry.homepage} |`,
  )
  .join("\n");

const content = `# Third-Party Notices

This file is generated from the production pnpm lockfile by \`pnpm notices:generate\`. Do not hand-edit the Node dependency table.

## Node production dependency inventory

| Package | Version | Licence | Project |
| --- | --- | --- | --- |
${rows}

${manualNotices}

## Python transcription environment

| Component | Pinned version | Licence |
| --- | --- | --- |
| FastAPI | 0.116.1 | MIT |
| faster-whisper | 1.2.1 | MIT |
| python-multipart | 0.0.20 | Apache-2.0 |
| Uvicorn | 0.35.0 | BSD-3-Clause |

The faster-whisper runtime downloads a separately licensed Whisper model selected by the administrator. Release documentation and SBOMs must identify the exact downloaded model and its model-card terms.

## Containers, browsers, codecs, and models

| Component | Use | Licence or notice |
| --- | --- | --- |
| Node.js 24 | Build and runtime | MIT and bundled third-party notices |
| Playwright and Chromium | PDF/browser automation | Apache-2.0 for Playwright; Chromium BSD-style licence plus bundled third-party notices |
| FFmpeg | media processing | LGPL-2.1-or-later by default; exact container build configuration and notices govern, and GPL components must not be enabled silently |
| sharp | image processing | Apache-2.0 |
| libvips binary distributed through sharp | image processing runtime | LGPL-3.0-or-later; preserve notices, allow replacement/relinking as applicable, and provide corresponding library source or a valid written offer when distributing images |
| nginx-unprivileged | static web server | BSD-2-Clause plus bundled module notices |
| Caddy | HTTPS reverse proxy | Apache-2.0 plus bundled notices |
| PostgreSQL | database | PostgreSQL Licence |
| MinIO server and client | bundled object storage | AGPL-3.0-only; administrators may instead configure an external S3-compatible service |
| NVIDIA CUDA runtime image | optional GPU transcription base | NVIDIA container/CUDA terms; redistribution approval must be checked for the chosen image |
| Ollama v0.32.3 | optional managed LLM server | MIT plus bundled notices |
| Ollama-managed models | optional LLM assets selected by the administrator | Model-specific terms and model-card notices apply |
| Kokoro-FastAPI v0.2.4 | optional local TTS server | Apache-2.0 |
| Kokoro-82M and stock voices | optional TTS model assets | Apache-2.0; retain its upstream model card and attribution notices |

The Kokoro-82M model card documents training sources that include datasets with attribution requirements, including CC BY material. A release containing the model must ship the exact upstream model card and all notices from the pinned image/model revision. The model and Kokoro-FastAPI are not part of this application's AGPL-covered source.

## Release evidence

The release pipeline generates an SBOM for each application image and extension artifact. Container SBOMs are authoritative for operating-system packages, browser libraries, codec builds, and model files. If an SBOM differs from this generated inventory, release publication stops until the notice set is regenerated and reviewed.
`;

if (process.argv.includes("--check")) {
  const existing = readFileSync(target, "utf8");
  if (existing !== content) {
    console.error(`${target} is stale; run pnpm notices:generate`);
    process.exit(1);
  }
} else {
  writeFileSync(target, content);
}
