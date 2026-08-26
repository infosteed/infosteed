// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const script = path.join(repoRoot, "scripts/package-extension.mjs");

async function writeDist(root, target, manifest) {
  const directory = path.join(root, "apps/extension/dist", target);
  await mkdir(path.join(directory, "src"), { recursive: true });
  await writeFile(
    path.join(directory, "manifest.json"),
    `${JSON.stringify(manifest)}\n`,
  );
  await writeFile(path.join(directory, "background.js"), target);
  await writeFile(path.join(directory, "src/popup.html"), "<html></html>");
  await writeFile(path.join(directory, "LICENSE"), "AGPL");
}

async function readZipManifest(bytes) {
  const contents = await JSZip.loadAsync(bytes).then((zip) =>
    zip.file("manifest.json")?.async("string"),
  );
  assert.ok(contents);
  return JSON.parse(contents);
}

test("packages Chrome and Firefox extension artifacts with checksums", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "infosteed-package-"));
  try {
    await writeDist(root, "chrome", {
      manifest_version: 3,
      key: "release-key",
      background: { service_worker: "background.js" },
    });
    await writeDist(root, "firefox", {
      manifest_version: 3,
      background: { scripts: ["background.js"] },
      browser_specific_settings: { gecko: { id: "infosteed@infosteed.org" } },
    });

    await execFileAsync(
      "node",
      [script, "--skip-build", "--allow-unsigned-development"],
      { cwd: root },
    );

    const chrome = await readFile(
      path.join(root, "artifacts/extension-offline.zip"),
    );
    const store = await readFile(
      path.join(root, "artifacts/extension-store.zip"),
    );
    const firefox = await readFile(
      path.join(root, "artifacts/firefox-offline.xpi"),
    );
    assert.equal((await readZipManifest(chrome)).key, "release-key");
    assert.equal("key" in (await readZipManifest(store)), false);
    assert.notDeepEqual(store, chrome);
    assert.equal(
      await JSZip.loadAsync(firefox).then((zip) =>
        zip.file("background.js")?.async("string"),
      ),
      "firefox",
    );
    assert.equal(
      await readFile(
        path.join(root, "artifacts/extension-checksums.sha256"),
        "utf8",
      ),
      [
        `${createHash("sha256").update(chrome).digest("hex")}  extension-offline.zip`,
        `${createHash("sha256").update(store).digest("hex")}  extension-store.zip`,
        `${createHash("sha256").update(firefox).digest("hex")}  firefox-offline.xpi`,
        "",
      ].join("\n"),
    );
    assert.match(
      await readFile(
        path.join(root, "artifacts/extension-contents.txt"),
        "utf8",
      ),
      /\[firefox\]\n/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Chrome-only packaging removes every stale Firefox release reference", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "infosteed-package-"));
  try {
    await writeDist(root, "chrome", {
      manifest_version: 3,
      key: "release-key",
      background: { service_worker: "background.js" },
    });
    await mkdir(path.join(root, "artifacts"), { recursive: true });
    await writeFile(
      path.join(root, "artifacts/firefox-offline.xpi"),
      "stale-firefox",
    );

    await execFileAsync("node", [script, "--skip-build", "--chrome-only"], {
      cwd: root,
    });

    const chrome = await readFile(
      path.join(root, "artifacts/extension-offline.zip"),
    );
    const store = await readFile(
      path.join(root, "artifacts/extension-store.zip"),
    );
    assert.equal((await readZipManifest(chrome)).key, "release-key");
    assert.equal("key" in (await readZipManifest(store)), false);
    await assert.rejects(
      access(path.join(root, "artifacts/firefox-offline.xpi")),
    );
    assert.equal(
      await readFile(
        path.join(root, "artifacts/extension-checksums.sha256"),
        "utf8",
      ),
      [
        `${createHash("sha256").update(chrome).digest("hex")}  extension-offline.zip`,
        `${createHash("sha256").update(store).digest("hex")}  extension-store.zip`,
        "",
      ].join("\n"),
    );
    const contents = await readFile(
      path.join(root, "artifacts/extension-contents.txt"),
      "utf8",
    );
    assert.match(contents, /^\[chrome\]\n/);
    assert.doesNotMatch(contents, /firefox/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
