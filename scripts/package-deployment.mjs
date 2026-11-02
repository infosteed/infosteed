// SPDX-License-Identifier: AGPL-3.0-only
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const files = [
  "deploy/compose.production.yml",
  "deploy/compose.build.yml",
  "deploy/compose.garage.yml",
  "deploy/compose.ai-services.yml",
  "deploy/compose.external-tls.yml",
  "deploy/Caddyfile",
  "deploy/Caddyfile.internal",
  "deploy/Caddyfile.external",
  "deploy/production.env.example",
  "deploy/ai-services.env.example",
  "deploy/ai-services.connection.env.example",
  "scripts/production-compose.sh",
  "scripts/ai-common.sh",
  "scripts/deploy-production.sh",
  "scripts/install-production.sh",
  "scripts/configure-ai-services.sh",
  "scripts/install-ai-services.sh",
  "scripts/doctor-production.sh",
  "scripts/doctor-ai-services.sh",
  "scripts/restart-production-proxy.sh",
  "scripts/backup.sh",
  "scripts/restore.sh",
  "scripts/upgrade-production.sh",
  "scripts/migrate-storage.sh",
  "scripts/storage-migration-config.mjs",
  "docs/deployment.md",
  "docs/ai-services.md",
  "docs/internal-https.md",
  "docs/deployment-troubleshooting.md",
  "docs/backup-and-upgrade.md",
  "docs/storage-migration.md",
  "THIRD_PARTY_NOTICES.md",
  "LICENSE",
  "CHANGELOG.md",
];

export function packageDeployment(
  root = process.cwd(),
  output = path.join(root, "artifacts"),
) {
  const { version } = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  );
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
    throw new Error("Invalid release version");
  mkdirSync(output, { recursive: true });
  const basenames = new Set();
  for (const file of files) {
    const basename = path.basename(file);
    if (basenames.has(basename))
      throw new Error(`Duplicate release attachment: ${basename}`);
    basenames.add(basename);
    copyFileSync(path.join(root, file), path.join(output, basename));
  }
  const archive = path.join(output, `infosteed-deployment-${version}.tar.gz`);
  const result = spawnSync("tar", ["-czf", archive, "-C", root, ...files], {
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(`Deployment archive failed: ${result.stderr}`);
  return archive;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  console.log(`Deployment archive: ${packageDeployment()}`);
}
