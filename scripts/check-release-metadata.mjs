// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function filesNamed(directory, filename) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    if (["node_modules", "dist", "coverage"].includes(entry)) return [];
    const target = path.join(directory, entry);
    if (statSync(target).isDirectory()) return filesNamed(target, filename);
    return entry === filename ? [target] : [];
  });
}

function markdownSection(content, heading) {
  const marker = `## ${heading}`;
  const start = content.indexOf(marker);
  if (start < 0) return undefined;
  const next = content.indexOf("\n## ", start + marker.length);
  return content.slice(start, next < 0 ? content.length : next);
}

function relative(root, file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

export function validateReleaseMetadata(root, { releaseTag } = {}) {
  const problems = [];
  const contents = new Map();

  function read(file) {
    if (contents.has(file)) return contents.get(file);
    const absolute = path.join(root, file);
    if (!existsSync(absolute)) {
      problems.push(`${file}: file is missing`);
      contents.set(file, "");
      return "";
    }
    const content = readFileSync(absolute, "utf8");
    contents.set(file, content);
    return content;
  }

  function requireText(file, expected, label) {
    if (!read(file).includes(expected))
      problems.push(
        `${file}: ${label} must contain ${JSON.stringify(expected)}`,
      );
  }

  function requireEnv(file, name, version) {
    const match = read(file).match(new RegExp(`^${name}=(.+)$`, "m"));
    if (!match) problems.push(`${file}: ${name} assignment is missing`);
    else if (match[1] !== version)
      problems.push(`${file}: ${name} is ${match[1]}, expected ${version}`);
  }

  let rootManifest;
  try {
    rootManifest = JSON.parse(read("package.json"));
  } catch (error) {
    problems.push(`package.json: invalid JSON (${error.message})`);
    return { version: undefined, problems };
  }
  const version = rootManifest.version;
  if (typeof version !== "string" || !version)
    problems.push("package.json: version must be a non-empty string");
  if (!version) return { version, problems };

  const packageFiles = [
    path.join(root, "package.json"),
    ...filesNamed(path.join(root, "apps"), "package.json"),
    ...filesNamed(path.join(root, "packages"), "package.json"),
  ];
  for (const packageFile of packageFiles) {
    const name = relative(root, packageFile);
    try {
      const manifest = JSON.parse(readFileSync(packageFile, "utf8"));
      if (manifest.version !== version)
        problems.push(
          `${name}: version is ${manifest.version ?? "missing"}, expected ${version}`,
        );
    } catch (error) {
      problems.push(`${name}: invalid JSON (${error.message})`);
    }
  }

  for (const file of [
    ".env.example",
    "docker.env.example",
    "deploy/production.env.example",
    "deploy/ai-services.env.example",
  ])
    requireEnv(file, "RELEASE_VERSION", version);

  const imageExample = read("deploy/production.env.example");
  for (const image of [
    "infosteed-web",
    "infosteed-api",
    "infosteed-video-render-worker",
    "infosteed-transcription",
  ]) {
    if (!imageExample.includes(`${image}:${version}@sha256:`))
      problems.push(
        `deploy/production.env.example: ${image} override must use ${version}`,
      );
  }

  requireText(
    "packages/shared/src/index.ts",
    `releaseVersion: "${version}"`,
    "shared release metadata",
  );
  requireText(
    "apps/api/src/config.ts",
    `.default("${version}")`,
    "API RELEASE_VERSION default",
  );
  requireText(
    "docker-compose.yml",
    `RELEASE_VERSION: \${RELEASE_VERSION:-${version}}`,
    "Compose RELEASE_VERSION default",
  );

  const ciVersions = [
    ...read(".github/workflows/ci.yml").matchAll(/0\.1\.0-beta\.\d+/g),
  ].map((match) => match[0]);
  for (const found of ciVersions) {
    if (found !== version)
      problems.push(
        `.github/workflows/ci.yml: fixture version ${found} must match ${version}`,
      );
  }

  const releaseName = version.replace(/^0\.1\.0-/, "");
  const tag = `v${version}`;
  const activeSections = [
    [
      "docs/deployment.md",
      "Install the core application",
      `git checkout ${tag}`,
    ],
    ["docs/backup-and-upgrade.md", "Upgrade", `git checkout ${tag}`],
    ["README.md", "Self-hosted deployment", tag],
  ];
  for (const [file, heading, expected] of activeSections) {
    const section = markdownSection(read(file), heading);
    if (section === undefined)
      problems.push(`${file}: section ${JSON.stringify(heading)} is missing`);
    else if (!section.includes(expected))
      problems.push(
        `${file}: active ${JSON.stringify(heading)} section must contain ${JSON.stringify(expected)}`,
      );
  }

  requireText(
    "docs/release-readiness.md",
    `preparing \`${tag}\``,
    "candidate status",
  );
  requireText(
    "docs/release-readiness.md",
    `## What remains before publishing ${releaseName}`,
    "candidate readiness heading",
  );
  requireText("SECURITY.md", tag, "supported-version status");
  requireText("SUPPORT.md", tag, "support-version status");
  requireText(
    "docs/release-process.md",
    'release-metadata:check -- --release-tag "v$version"',
    "generic tag validation command",
  );

  const changelog = read("CHANGELOG.md");
  const heading = changelog.match(
    new RegExp(`^## \\[${escapeRegExp(version)}\\] - (.+)$`, "m"),
  );
  if (!heading) {
    problems.push(`CHANGELOG.md: heading for ${version} is missing`);
  } else if (releaseTag) {
    if (releaseTag !== tag)
      problems.push(`release tag is ${releaseTag}, expected ${tag}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(heading[1]))
      problems.push(
        `CHANGELOG.md: ${version} must have an ISO release date before tagging`,
      );
  }

  return { version, problems };
}

function run() {
  const tagIndex = process.argv.indexOf("--release-tag");
  const releaseTag = tagIndex >= 0 ? process.argv[tagIndex + 1] : undefined;
  if (tagIndex >= 0 && !releaseTag) {
    console.error("--release-tag requires a tag value");
    process.exit(2);
  }
  const { version, problems } = validateReleaseMetadata(process.cwd(), {
    releaseTag,
  });
  if (problems.length) {
    console.error(`Release metadata mismatch:\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log(
    `Release metadata is synchronized for ${version}${releaseTag ? ` (${releaseTag})` : ""}.`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  run();
