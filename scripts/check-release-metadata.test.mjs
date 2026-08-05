// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { validateReleaseMetadata } from "./check-release-metadata.mjs";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "infosteed-release-metadata-"),
  );
  roots.push(root);
  const version = "0.1.0-beta.6";
  const files = {
    "package.json": JSON.stringify({ version }),
    "apps/api/package.json": JSON.stringify({ version }),
    "packages/shared/package.json": JSON.stringify({ version }),
    "packages/shared/src/index.ts": `releaseVersion: "${version}"`,
    "apps/api/src/config.ts": `RELEASE_VERSION: z.string().default("${version}")`,
    "docker-compose.yml": `RELEASE_VERSION: \${RELEASE_VERSION:-${version}}`,
    ".env.example": `RELEASE_VERSION=${version}\n`,
    "docker.env.example": `RELEASE_VERSION=${version}\n`,
    "deploy/ai-services.env.example": `RELEASE_VERSION=${version}\n`,
    "deploy/production.env.example": [
      `RELEASE_VERSION=${version}`,
      `# WEB_IMAGE=registry.example/infosteed-web:${version}@sha256:...`,
      `# API_IMAGE=registry.example/infosteed-api:${version}@sha256:...`,
      `# RENDER_IMAGE=registry.example/infosteed-video-render-worker:${version}@sha256:...`,
      `# TRANSCRIPTION_IMAGE=registry.example/infosteed-transcription:${version}@sha256:...`,
    ].join("\n"),
    ".github/workflows/ci.yml": `RELEASE_VERSION: ${version}\n`,
    "docs/deployment.md": `## Install the core application\n\ngit checkout v${version}\n`,
    "docs/backup-and-upgrade.md": [
      "## Upgrade",
      `git checkout v${version}`,
      "## Upgrade from beta.1",
      "git checkout v0.1.0-beta.2",
    ].join("\n"),
    "README.md": `## Self-hosted deployment\n\nv0.1.0-beta.3 was superseded; v${version} is being prepared.\n`,
    "docs/release-readiness.md": `InfoSteed is preparing \`v${version}\`.\n\n## What remains before publishing beta.6\n`,
    "SECURITY.md": `v${version}`,
    "SUPPORT.md": `v${version}`,
    "docs/release-process.md":
      'release-metadata:check -- --release-tag "v$version"',
    "CHANGELOG.md": `## [Unreleased]\n\n## [${version}] - Unreleased\n`,
  };
  for (const [filename, content] of Object.entries(files)) {
    const target = path.join(root, filename);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${content}\n`);
  }
  return { root, version };
}

test("accepts synchronized metadata and ignores the historical upgrade section", () => {
  const { root } = fixture();
  assert.deepEqual(validateReleaseMetadata(root).problems, []);
});

test("reports a stale workspace manifest", () => {
  const { root } = fixture();
  writeFileSync(
    path.join(root, "apps/api/package.json"),
    JSON.stringify({ version: "0.1.0-beta.3" }),
  );
  assert.match(
    validateReleaseMetadata(root).problems.join("\n"),
    /apps\/api\/package\.json: version is 0\.1\.0-beta\.3/,
  );
});

test("reports stale active environment and documentation versions", () => {
  const { root } = fixture();
  writeFileSync(
    path.join(root, "deploy/production.env.example"),
    "RELEASE_VERSION=0.1.0-beta.3\n",
  );
  writeFileSync(
    path.join(root, "docs/deployment.md"),
    "## Install the core application\n\ngit checkout v0.1.0-beta.3\n",
  );
  const problems = validateReleaseMetadata(root).problems.join("\n");
  assert.match(problems, /deploy\/production\.env\.example: RELEASE_VERSION/);
  assert.match(problems, /docs\/deployment\.md: active/);
});

test("tag mode requires the current tag and a dated changelog entry", () => {
  const { root, version } = fixture();
  let problems = validateReleaseMetadata(root, {
    releaseTag: `v${version}`,
  }).problems.join("\n");
  assert.match(problems, /must have an ISO release date/);

  writeFileSync(
    path.join(root, "CHANGELOG.md"),
    `## [Unreleased]\n\n## [${version}] - 2026-08-05\n`,
  );
  assert.deepEqual(
    validateReleaseMetadata(root, { releaseTag: `v${version}` }).problems,
    [],
  );
  problems = validateReleaseMetadata(root, {
    releaseTag: "v0.1.0-beta.3",
  }).problems.join("\n");
  assert.match(problems, /release tag is v0\.1\.0-beta\.3/);
});
