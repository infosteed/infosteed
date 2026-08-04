// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import JSZip from "jszip";

const dist = "apps/extension/dist";
const manifest = JSON.parse(
  readFileSync(path.join(dist, "manifest.json"), "utf8"),
);
if (!manifest.key && !process.argv.includes("--allow-unsigned-development")) {
  throw new Error(
    "The release manifest key is missing. Add the public key for the official Store identity before packaging a release.",
  );
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

const files = list(dist);
const zip = new JSZip();
const fixedDate = new Date("1980-01-01T00:00:00.000Z");
for (const file of files)
  zip.file(file.relative, readFileSync(file.absolute), {
    date: fixedDate,
    createFolders: false,
  });
const bytes = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
  platform: "UNIX",
});
mkdirSync("artifacts", { recursive: true });
for (const name of ["extension-offline.zip", "extension-store.zip"])
  writeFileSync(path.join("artifacts", name), bytes);
const digest = createHash("sha256").update(bytes).digest("hex");
writeFileSync(
  "artifacts/extension-checksums.sha256",
  `${digest}  extension-offline.zip\n${digest}  extension-store.zip\n`,
);
writeFileSync(
  "artifacts/extension-contents.txt",
  files.map((file) => file.relative).join("\n") + "\n",
);
