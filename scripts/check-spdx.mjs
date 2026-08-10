// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const roots = ["apps", "packages", "scripts", "whisper", "migrations", "tests"];
const ignored = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".venv-stt",
  "__pycache__",
]);
const comments = new Map([
  [".ts", "// SPDX-License-Identifier: AGPL-3.0-only"],
  [".tsx", "// SPDX-License-Identifier: AGPL-3.0-only"],
  [".js", "// SPDX-License-Identifier: AGPL-3.0-only"],
  [".mjs", "// SPDX-License-Identifier: AGPL-3.0-only"],
  [".py", "# SPDX-License-Identifier: AGPL-3.0-only"],
  [".sh", "# SPDX-License-Identifier: AGPL-3.0-only"],
  [".sql", "-- SPDX-License-Identifier: AGPL-3.0-only"],
  [".css", "/* SPDX-License-Identifier: AGPL-3.0-only */"],
  [".html", "<!-- SPDX-License-Identifier: AGPL-3.0-only -->"],
]);
const sourceDerivedMarker = "SPDX-License-Identifier: MIT AND AGPL-3.0-only";

function isSourceDerived(file) {
  const normalized = file.split(path.sep).join("/");
  return (
    normalized.startsWith("apps/web/src/components/ui/") ||
    normalized === "apps/web/src/lib/utils.ts" ||
    normalized === "apps/web/src/styles/tokens.css"
  );
}

function sourceDerivedNotice(file) {
  if (path.extname(file) === ".css") {
    return `/* Palette values derived from Radix Colors (MIT); locally modified for InfoSteed. */\n/* ${sourceDerivedMarker} */`;
  }
  return `// Derived from shadcn/ui (MIT); locally modified for InfoSteed.\n// ${sourceDerivedMarker}`;
}

function filesUnder(directory) {
  if (!statSync(directory).isDirectory()) return [directory];
  return readdirSync(directory).flatMap((name) =>
    ignored.has(name) ? [] : filesUnder(path.join(directory, name)),
  );
}

const missing = [];
for (const file of roots.flatMap((root) => filesUnder(root))) {
  if (/vite\.config\..*\.mjs$/.test(file)) continue;
  const marker =
    path.basename(file) === "Dockerfile"
      ? "# SPDX-License-Identifier: AGPL-3.0-only"
      : comments.get(path.extname(file));
  if (!marker) continue;
  const content = readFileSync(file, "utf8");
  const expectedMarker = isSourceDerived(file)
    ? sourceDerivedMarker
    : "SPDX-License-Identifier: AGPL-3.0-only";
  if (content.slice(0, 300).includes(expectedMarker)) continue;
  if (!process.argv.includes("--fix")) {
    missing.push(file);
    continue;
  }
  const notice = isSourceDerived(file) ? sourceDerivedNotice(file) : marker;
  if (content.startsWith("#!")) {
    const newline = content.indexOf("\n");
    writeFileSync(
      file,
      `${content.slice(0, newline + 1)}${notice}\n${content.slice(newline + 1)}`,
    );
  } else {
    writeFileSync(file, `${notice}\n${content}`);
  }
}

for (const file of [
  "package.json",
  ...filesUnder("apps").filter((name) => name.endsWith("package.json")),
  ...filesUnder("packages").filter((name) => name.endsWith("package.json")),
]) {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  if (manifest.license !== "AGPL-3.0-only")
    missing.push(`${file} (license field)`);
}

if (missing.length) {
  console.error(`Missing AGPL-3.0-only notice:\n${missing.join("\n")}`);
  process.exit(1);
}
