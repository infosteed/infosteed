// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, writeFileSync } from "node:fs";
if (process.argv[2] === "freeze") {
  const directory = process.argv[3];
  const containers = JSON.parse(
    readFileSync(`${directory}/containers.json`, "utf8"),
  );
  for (const name of ["source", "target"]) {
    const config = JSON.parse(
      readFileSync(`${directory}/${name}.json`, "utf8"),
    );
    for (const container of containers) {
      const service = container.Config.Labels["com.docker.compose.service"];
      if (config.services[service]) {
        config.services[service].image = container.Image;
        delete config.services[service].build;
      }
    }
    writeFileSync(
      `${directory}/${name}.compose.yml`,
      JSON.stringify(config, null, 2),
      { mode: 0o600 },
    );
  }
  process.exit(0);
}
const [sourceFile, targetFile, toolsFile, image] = process.argv.slice(2);
const source = JSON.parse(readFileSync(sourceFile, "utf8"));
const target = JSON.parse(readFileSync(targetFile, "utf8"));
if (source.name !== target.name)
  throw new Error("Migration must retain the original Compose project name");
for (const service of [
  "api",
  "video-render-worker",
  "web",
  "caddy",
  "postgres",
]) {
  const a = source.services[service],
    b = target.services[service];
  if (!a || !b || a.image !== b.image)
    throw new Error(`Preserve the ${service} image during storage migration`);
  for (const field of ["volumes", "ports"]) {
    if (JSON.stringify(a[field]) !== JSON.stringify(b[field]))
      throw new Error(`Preserve ${service} ${field}`);
  }
  const withoutS3 = (env) =>
    Object.fromEntries(
      Object.entries(env ?? {})
        .filter(([key]) => !key.startsWith("S3_"))
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  if (
    JSON.stringify(withoutS3(a.environment)) !==
    JSON.stringify(withoutS3(b.environment))
  )
    throw new Error(
      `Preserve ${service} non-storage environment, including release and database settings`,
    );
}
const environment = Object.fromEntries(
  Object.entries(source.services.api.environment).filter(([key]) =>
    key.startsWith("S3_"),
  ),
);
writeFileSync(
  toolsFile,
  JSON.stringify(
    {
      services: {
        "storage-tools": {
          image,
          profiles: ["tools"],
          entrypoint: ["node", "dist/storageAdmin.js"],
          command: ["check"],
          environment,
        },
      },
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
