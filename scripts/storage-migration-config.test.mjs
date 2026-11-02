// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
const script = new URL("./storage-migration-config.mjs", import.meta.url);
function fixture(run) {
  const root = mkdtempSync(path.join(tmpdir(), "infosteed-migration-config-"));
  const services = Object.fromEntries(
    ["api", "web", "video-render-worker", "caddy", "postgres"].map((name) => [
      name,
      {
        image: `original/${name}:release`,
        environment: {
          DATABASE_URL: "postgres://original",
          RELEASE_COMMIT: "original",
          S3_ENDPOINT: "http://minio:9000",
        },
      },
    ]),
  );
  const source = { name: "original-project", services },
    target = structuredClone(source);
  for (const service of Object.values(target.services))
    service.environment.S3_ENDPOINT = "http://garage:3900";
  try {
    run(root, source, target);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
function validate(root, source, target) {
  writeFileSync(path.join(root, "source.json"), JSON.stringify(source));
  writeFileSync(path.join(root, "target.json"), JSON.stringify(target));
  return spawnSync(
    process.execPath,
    [
      script.pathname,
      path.join(root, "source.json"),
      path.join(root, "target.json"),
      path.join(root, "tools.json"),
      "tools:new",
    ],
    { encoding: "utf8" },
  );
}
test("migration permits storage configuration changes and isolates the CLI", () =>
  fixture((root, source, target) => {
    assert.equal(validate(root, source, target).status, 0);
    const tools = JSON.parse(readFileSync(path.join(root, "tools.json")));
    assert.deepEqual(Object.keys(tools.services["storage-tools"].environment), [
      "S3_ENDPOINT",
    ]);
    assert.deepEqual(tools.services["storage-tools"].entrypoint, [
      "node",
      "dist/storageAdmin.js",
    ]);
  }));
for (const field of [
  "image",
  "DATABASE_URL",
  "RELEASE_COMMIT",
  "ports",
  "volumes",
  "project",
]) {
  test(`migration rejects changed ${field}`, () =>
    fixture((root, source, target) => {
      if (field === "project") target.name = "new-project";
      else if (["DATABASE_URL", "RELEASE_COMMIT"].includes(field))
        target.services.api.environment[field] = "changed";
      else
        target.services.api[field] =
          field === "image" ? "new:image" : ["changed"];
      assert.notEqual(validate(root, source, target).status, 0);
    }));
}
test("freeze uses running image IDs and removes build instructions", () =>
  fixture((root, source, target) => {
    source.services.api.build = { context: "." };
    validate(root, source, target);
    writeFileSync(
      path.join(root, "containers.json"),
      JSON.stringify([
        {
          Image: "sha256:running",
          Config: { Labels: { "com.docker.compose.service": "api" } },
        },
      ]),
    );
    const result = spawnSync(
      process.execPath,
      [script.pathname, "freeze", root],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    for (const name of ["source", "target"]) {
      const frozen = JSON.parse(
        readFileSync(path.join(root, `${name}.compose.yml`)),
      );
      assert.equal(frozen.services.api.image, "sha256:running");
      assert.equal(frozen.services.api.build, undefined);
    }
  }));
