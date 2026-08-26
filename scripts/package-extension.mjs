// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import JSZip from "jszip";

const args = new Set(process.argv.slice(2).filter((arg) => arg !== "--"));
const allowUnsignedDevelopment = args.has("--allow-unsigned-development");
const chromeOnly = args.has("--chrome-only");
const skipBuild = args.has("--skip-build");
const artifacts = "artifacts";
const chromeDist = "apps/extension/dist/chrome";
const firefoxDist = "apps/extension/dist/firefox";
const signedFirefoxXpi = process.env.INFOSTEED_FIREFOX_SIGNED_XPI;

function run(command, commandArgs, env = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed`);
  }
}

function list(directory, prefix = "") {
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const absolute = path.join(directory, name);
      const relative = path.posix.join(prefix, name);
      return statSync(absolute).isDirectory()
        ? list(absolute, relative)
        : [{ absolute, relative }];
    });
}

async function zipDirectory(directory, { omitManifestKey = false } = {}) {
  const files = list(directory);
  const zip = new JSZip();
  const fixedDate = new Date("1980-01-01T00:00:00.000Z");
  for (const file of files) {
    let contents = readFileSync(file.absolute);
    if (omitManifestKey && file.relative === "manifest.json") {
      const manifest = JSON.parse(contents.toString("utf8"));
      delete manifest.key;
      contents = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    }
    zip.file(file.relative, contents, {
      date: fixedDate,
      createFolders: false,
    });
  }
  const bytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "UNIX",
  });
  return { bytes, files };
}

function readManifest(directory) {
  return JSON.parse(
    readFileSync(path.join(directory, "manifest.json"), "utf8"),
  );
}

function assertChromeReleaseManifest() {
  const manifest = readManifest(chromeDist);
  if (!manifest.key && !allowUnsignedDevelopment) {
    throw new Error(
      "The Chrome release manifest key is missing. Add the public key for the official Store identity before packaging a release.",
    );
  }
}

function assertSignedFirefoxPackage() {
  if (allowUnsignedDevelopment) return;
  if (!signedFirefoxXpi || !existsSync(signedFirefoxXpi)) {
    throw new Error(
      "A Mozilla-signed Firefox XPI is required for release packaging. Set INFOSTEED_FIREFOX_SIGNED_XPI or pass --allow-unsigned-development for local builds.",
    );
  }
}

function writeArtifact(name, bytes) {
  writeFileSync(path.join(artifacts, name), bytes);
  return {
    name,
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
}

if (!skipBuild) {
  rmSync("apps/extension/dist", { recursive: true, force: true });
  run("corepack", ["pnpm", "--filter", "@infosteed/extension", "build"], {
    INFOSTEED_EXTENSION_TARGET: "chrome",
  });
  if (!chromeOnly) {
    run("corepack", ["pnpm", "--filter", "@infosteed/extension", "build"], {
      INFOSTEED_EXTENSION_TARGET: "firefox",
    });
  }
}

assertChromeReleaseManifest();
if (!chromeOnly) assertSignedFirefoxPackage();
mkdirSync(artifacts, { recursive: true });
rmSync(path.join(artifacts, "firefox-offline.xpi"), { force: true });

const chromeOfflinePackage = await zipDirectory(chromeDist);
const chromeStorePackage = await zipDirectory(chromeDist, {
  omitManifestKey: true,
});
const written = [
  writeArtifact("extension-offline.zip", chromeOfflinePackage.bytes),
  writeArtifact("extension-store.zip", chromeStorePackage.bytes),
];
const contents = [
  "[chrome]",
  ...chromeOfflinePackage.files.map((file) => file.relative),
];

if (!chromeOnly) {
  const firefoxPackage = await zipDirectory(firefoxDist);
  if (signedFirefoxXpi && existsSync(signedFirefoxXpi)) {
    copyFileSync(signedFirefoxXpi, path.join(artifacts, "firefox-offline.xpi"));
    const bytes = readFileSync(path.join(artifacts, "firefox-offline.xpi"));
    written.push({
      name: "firefox-offline.xpi",
      digest: createHash("sha256").update(bytes).digest("hex"),
    });
  } else {
    written.push(writeArtifact("firefox-offline.xpi", firefoxPackage.bytes));
  }
  contents.push(
    "",
    "[firefox]",
    ...firefoxPackage.files.map((file) => file.relative),
  );
}

writeFileSync(
  path.join(artifacts, "extension-checksums.sha256"),
  written.map(({ digest, name }) => `${digest}  ${name}`).join("\n") + "\n",
);
writeFileSync(
  path.join(artifacts, "extension-contents.txt"),
  contents.join("\n") + "\n",
);
