// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { packageDeployment } from "./package-deployment.mjs";

test("release archive includes Garage, migration dependencies and recovery documentation", () => {
  const output = mkdtempSync(
    path.join(os.tmpdir(), "infosteed-deployment-package-"),
  );
  const root = fileURLToPath(new URL("../", import.meta.url));
  try {
    const archive = packageDeployment(root, output);
    const result = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const entries = result.stdout.trim().split("\n");
    for (const required of [
      "deploy/compose.garage.yml",
      "scripts/migrate-storage.sh",
      "scripts/storage-migration-config.mjs",
      "scripts/production-compose.sh",
      "docs/storage-migration.md",
      "docs/backup-and-upgrade.md",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
    ]) {
      assert.ok(
        entries.includes(required),
        `${required} must ship in the deployment archive`,
      );
      assert.ok(
        readFileSync(path.join(output, path.basename(required))).length,
      );
    }
    assert.ok(
      !entries.some(
        (entry) =>
          entry.endsWith(".env") ||
          entry.startsWith("backups/") ||
          entry.startsWith(".vscode/"),
      ),
    );
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
