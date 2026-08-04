// SPDX-License-Identifier: AGPL-3.0-only
import { readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import process from "node:process";
import ts from "typescript";

const roots = ["apps/web", "apps/extension"];
const checkOnly = process.argv.includes("--check");
const dynamicMessages = {
  "apps/web": [
    "admin",
    "auto",
    "canceled",
    "disabled",
    "editor",
    "expired",
    "failed",
    "manual",
    "owner",
    "pending",
    "processing",
    "published",
    "queued",
    "ready",
    "recording",
    "restore",
    "user",
    "viewer",
  ],
  "apps/extension": ["finalizing", "idle", "paused", "recording"],
};

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if ([".ts", ".tsx"].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

function literalText(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;
}

async function extractedMessages(root) {
  const messages = new Set(dynamicMessages[root] ?? []);
  for (const path of await sourceFiles(join(root, "src"))) {
    const source = ts.createSourceFile(
      path,
      await readFile(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        if (node.expression.text === "t") {
          const message = node.arguments[0] && literalText(node.arguments[0]);
          if (message) messages.add(message);
        }
        if (node.expression.text === "plural") {
          for (const argument of node.arguments.slice(0, 2)) {
            const message = literalText(argument);
            if (message) messages.add(message);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return [...messages].sort((a, b) => a.localeCompare(b));
}

function placeholders(message) {
  return [...message.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)]
    .map((match) => match[1])
    .sort();
}

function sameValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function processRoot(root) {
  const localeDirectory = join(root, "src/locales");
  const englishPath = join(localeDirectory, "en.json");
  const english = JSON.parse(await readFile(englishPath, "utf8"));
  const messages = await extractedMessages(root);
  const expected = {
    ...english,
    messages: Object.fromEntries(messages.map((message) => [message, message])),
  };
  const serialized = `${JSON.stringify(expected, null, 2)}\n`;

  if (checkOnly) {
    if ((await readFile(englishPath, "utf8")) !== serialized)
      throw new Error(`${englishPath} is stale; run pnpm i18n:extract`);
  } else {
    await writeFile(englishPath, serialized);
  }

  const localeFiles = (await readdir(localeDirectory)).filter(
    (name) => name.endsWith(".json") && name !== "en.json",
  );
  for (const filename of localeFiles) {
    const catalog = JSON.parse(
      await readFile(join(localeDirectory, filename), "utf8"),
    );
    if (catalog.locale !== filename.slice(0, -5))
      throw new Error(`${filename}: locale must match the filename`);
    for (const message of messages) {
      if (typeof catalog.messages?.[message] !== "string")
        throw new Error(
          `${filename}: missing translation for ${JSON.stringify(message)}`,
        );
      if (
        !sameValues(
          placeholders(message),
          placeholders(catalog.messages[message]),
        )
      )
        throw new Error(
          `${filename}: placeholders differ for ${JSON.stringify(message)}`,
        );
    }
  }

  console.log(
    `${root}: ${messages.length} messages, ${localeFiles.length + 1} locales`,
  );
}

for (const root of roots) await processRoot(root);
