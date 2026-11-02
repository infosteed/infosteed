// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { z } from "zod";

class StorageError extends Error {
  override name = "StorageError";
}

const attributes = z
  .object({
    contentType: z.string().optional(),
    contentEncoding: z.string().optional(),
    contentDisposition: z.string().optional(),
    cacheControl: z.string().optional(),
    metadata: z.record(z.string(), z.string()),
  })
  .strict();
const entrySchema = attributes
  .extend({
    key: z.string().min(1),
    file: z.string().regex(/^objects\/[0-9]{12}$/),
    size: z.number().int().nonnegative().safe(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const manifestSchema = z
  .object({ formatVersion: z.literal(2), objects: z.array(entrySchema) })
  .strict();
export type StorageEntry = z.infer<typeof entrySchema>;
export type StorageManifest = z.infer<typeof manifestSchema>;

export function adminClient(env = process.env): S3Client {
  if (!env.S3_BUCKET || !env.S3_REGION)
    throw new StorageError("S3_BUCKET and S3_REGION are required");
  return new S3Client({
    endpoint: env.S3_ENDPOINT || undefined,
    region: env.S3_REGION,
    forcePathStyle:
      env.S3_FORCE_PATH_STYLE !== "false" && env.S3_FORCE_PATH_STYLE !== "0",
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 10_000, requestTimeout: 120_000 },
    credentials:
      env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            sessionToken: env.S3_SESSION_TOKEN || undefined,
          }
        : undefined,
  });
}

export async function listKeys(
  client: S3Client,
  bucket: string,
): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
    for (const item of page.Contents ?? [])
      if (item.Key !== undefined) keys.push(item.Key);
    const next = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && (!next || next === token))
      throw new StorageError("Invalid S3 pagination");
    token = next;
  } while (token);
  return keys.sort();
}

function objectAttributes(object: {
  ContentType?: string;
  ContentEncoding?: string;
  ContentDisposition?: string;
  CacheControl?: string;
  Metadata?: Record<string, string>;
}) {
  return {
    contentType: object.ContentType,
    contentEncoding: object.ContentEncoding,
    contentDisposition: object.ContentDisposition,
    cacheControl: object.CacheControl,
    metadata: object.Metadata ?? {},
  };
}
function uploadAttributes(entry: StorageEntry) {
  return {
    ContentType: entry.contentType,
    ContentEncoding: entry.contentEncoding,
    ContentDisposition: entry.contentDisposition,
    CacheControl: entry.cacheControl,
    Metadata: entry.metadata,
  };
}
async function digest(
  stream: Readable,
): Promise<{ sha256: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const data of stream) {
    const bytes = Buffer.from(data);
    hash.update(bytes);
    size += bytes.length;
  }
  return { sha256: hash.digest("hex"), size };
}

export async function loadManifest(
  directory: string,
): Promise<StorageManifest> {
  const info = await lstat(path.join(directory, "objects"));
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new StorageError("Unsafe objects directory");
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(path.join(directory, "objects.json"), "utf8")),
  );
  const keys = new Set<string>(),
    files = new Set<string>();
  for (const entry of manifest.objects) {
    if (keys.has(entry.key) || files.has(entry.file))
      throw new StorageError("Duplicate manifest entry");
    keys.add(entry.key);
    files.add(entry.file);
    const filename = path.join(directory, entry.file);
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new StorageError("Unsafe backup payload");
    const actual = await digest(createReadStream(filename));
    if (actual.size !== entry.size || actual.sha256 !== entry.sha256)
      throw new StorageError("Backup payload checksum mismatch");
  }
  return manifest;
}

export async function backupObjects(
  client: S3Client,
  bucket: string,
  directory: string,
): Promise<void> {
  await mkdir(path.join(directory, "objects"), {
    recursive: true,
    mode: 0o700,
  });
  const manifest: StorageManifest = { formatVersion: 2, objects: [] };
  const keys = await listKeys(client, bucket);
  for (const [index, key] of keys.entries()) {
    const file = `objects/${String(index).padStart(12, "0")}`;
    const object = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!(object.Body instanceof Readable))
      throw new StorageError("Non-streaming S3 response");
    const hash = createHash("sha256");
    let size = 0;
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk);
        size += chunk.length;
        callback(null, chunk);
      },
    });
    await pipeline(
      object.Body,
      counter,
      createWriteStream(path.join(directory, file), {
        flags: "wx",
        mode: 0o600,
      }),
    );
    if (object.ContentLength !== undefined && size !== object.ContentLength)
      throw new StorageError("Incomplete S3 download");
    manifest.objects.push({
      key,
      file,
      size,
      sha256: hash.digest("hex"),
      ...objectAttributes(object),
    });
  }
  await writeFile(
    path.join(directory, "objects.json.tmp"),
    JSON.stringify(manifest, null, 2) + "\n",
    { mode: 0o600 },
  );
  await rename(
    path.join(directory, "objects.json.tmp"),
    path.join(directory, "objects.json"),
  );
}

function canonical(value: Record<string, string>) {
  return JSON.stringify(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
  );
}
export async function verifyObject(
  client: S3Client,
  bucket: string,
  entry: StorageEntry,
): Promise<void> {
  const object = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: entry.key }),
  );
  if (!(object.Body instanceof Readable))
    throw new StorageError("Non-streaming S3 response");
  const actual = await digest(object.Body);
  const meta = objectAttributes(object);
  if (
    actual.size !== entry.size ||
    actual.sha256 !== entry.sha256 ||
    [
      "contentType",
      "contentEncoding",
      "contentDisposition",
      "cacheControl",
    ].some(
      (field) =>
        meta[field as keyof typeof meta] !== entry[field as keyof StorageEntry],
    ) ||
    canonical(meta.metadata) !== canonical(entry.metadata)
  )
    throw new StorageError("S3 object verification failed");
}

async function uploadObject(
  client: S3Client,
  bucket: string,
  directory: string,
  entry: StorageEntry,
) {
  const common = { Bucket: bucket, Key: entry.key, ...uploadAttributes(entry) };
  if (entry.size === 0) {
    await client.send(
      new PutObjectCommand({ ...common, Body: Buffer.alloc(0) }),
    );
    return;
  }
  const partSize = Math.max(8 * 1024 * 1024, Math.ceil(entry.size / 9999));
  if (partSize > 512 * 1024 * 1024)
    throw new StorageError("Object exceeds tooling upload limit");
  const upload = await client.send(new CreateMultipartUploadCommand(common));
  if (!upload.UploadId) throw new StorageError("Missing multipart upload ID");
  const parts: Array<{ PartNumber: number; ETag: string }> = [];
  try {
    for await (const chunk of createReadStream(
      path.join(directory, entry.file),
      { highWaterMark: partSize },
    )) {
      const PartNumber = parts.length + 1;
      const part = await client.send(
        new UploadPartCommand({
          ...common,
          UploadId: upload.UploadId,
          PartNumber,
          Body: chunk,
          ContentLength: chunk.length,
        }),
      );
      if (!part.ETag) throw new StorageError("Missing multipart ETag");
      parts.push({ PartNumber, ETag: part.ETag });
    }
    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: entry.key,
        UploadId: upload.UploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
  } catch (error) {
    await client
      .send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: entry.key,
          UploadId: upload.UploadId,
        }),
      )
      .catch(() => {});
    throw error;
  }
}

export async function restoreObjects(
  client: S3Client,
  bucket: string,
  directory: string,
  resume = false,
): Promise<void> {
  const manifest = await loadManifest(directory); // Validate every local payload before any S3 mutation.
  const existing = new Set(await listKeys(client, bucket));
  if (!resume && existing.size)
    throw new StorageError("Target bucket is not empty");
  const expected = new Set(manifest.objects.map((entry) => entry.key));
  if ([...existing].some((key) => !expected.has(key)))
    throw new StorageError("Unexpected target objects");
  for (const entry of manifest.objects)
    if (existing.has(entry.key)) await verifyObject(client, bucket, entry);
  for (const entry of manifest.objects)
    if (!existing.has(entry.key))
      await uploadObject(client, bucket, directory, entry);
}
export async function verifyObjects(
  client: S3Client,
  bucket: string,
  directory: string,
): Promise<void> {
  const manifest = await loadManifest(directory);
  const keys = await listKeys(client, bucket);
  if (
    JSON.stringify(keys) !==
    JSON.stringify(manifest.objects.map((entry) => entry.key).sort())
  )
    throw new StorageError("S3 object set differs");
  for (const entry of manifest.objects)
    await verifyObject(client, bucket, entry);
}

// Convert old path-based backups in a separate staging directory; never alter the original backup.
export async function importLegacy(
  source: string,
  target: string,
  mimeFile?: string,
): Promise<void> {
  const mime = mimeFile
    ? z
        .record(z.string(), z.string())
        .parse(JSON.parse(await readFile(mimeFile, "utf8")))
    : {};
  const extensions: Record<string, string> = {
    ".webm": "video/webm",
    ".mp4": "video/mp4",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".vtt": "text/vtt",
  };
  const manifest: StorageManifest = { formatVersion: 2, objects: [] };
  await mkdir(path.join(target, "objects"), { recursive: true, mode: 0o700 });
  async function walk(relative: string) {
    for (const item of await readdir(path.join(source, "objects", relative), {
      withFileTypes: true,
    })) {
      const key = relative ? `${relative}/${item.name}` : item.name;
      if (item.isSymbolicLink()) throw new StorageError("Unsafe legacy backup");
      if (item.isDirectory()) {
        await walk(key);
        continue;
      }
      if (!item.isFile()) throw new StorageError("Unsafe legacy payload");
      const file = `objects/${String(manifest.objects.length).padStart(12, "0")}`;
      await pipeline(
        createReadStream(path.join(source, "objects", key)),
        createWriteStream(path.join(target, file), {
          flags: "wx",
          mode: 0o600,
        }),
      );
      manifest.objects.push({
        key,
        file,
        ...(await digest(createReadStream(path.join(target, file)))),
        contentType:
          mime[key] ??
          extensions[path.extname(key)] ??
          "application/octet-stream",
        metadata: {},
      });
    }
  }
  if (
    !(await lstat(path.join(source, "objects"))).isDirectory() ||
    (await lstat(path.join(source, "objects"))).isSymbolicLink()
  )
    throw new StorageError("Unsafe legacy objects directory");
  await walk("");
  await writeFile(path.join(target, "objects.json"), JSON.stringify(manifest), {
    mode: 0o600,
  });
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [command, directory = "/backup", option, extra] = args;
  if (command === "help") {
    console.log(
      "Storage tools: check, backup, restore, verify, clear, validate, import-v1, mime-v1",
    );
    return;
  }
  if (command === "mime-v1") {
    if (!option) throw new StorageError("MIME map required");
    const manifest = await loadManifest(directory);
    const mime = z
      .record(z.string(), z.string())
      .parse(JSON.parse(await readFile(option, "utf8")));
    for (const entry of manifest.objects)
      entry.contentType = mime[entry.key] ?? entry.contentType;
    await writeFile(
      path.join(directory, "objects.json"),
      JSON.stringify(manifest),
      { mode: 0o600 },
    );
    return;
  }
  if (command === "validate") {
    await loadManifest(directory);
    return;
  }
  if (command === "import-v1") {
    if (!option) throw new StorageError("Target directory required");
    await importLegacy(directory, option, extra);
    return;
  }
  if (!["check", "backup", "restore", "verify", "clear"].includes(command))
    throw new StorageError(
      "Expected check, backup, restore, verify, clear, validate or import-v1",
    );
  const client = adminClient();
  const bucket = process.env.S3_BUCKET!;
  try {
    if (command === "check") {
      const wait = Number(process.env.S3_WAIT_SECONDS ?? "0");
      if (!Number.isFinite(wait) || wait < 0 || wait > 600)
        throw new StorageError("Invalid S3_WAIT_SECONDS");
      const deadline = Date.now() + wait * 1000;
      for (;;) {
        try {
          await client.send(new HeadBucketCommand({ Bucket: bucket }), {
            abortSignal: AbortSignal.timeout(
              Math.max(1000, Math.min(10000, deadline - Date.now())),
            ),
          });
          break;
        } catch (error) {
          if (Date.now() >= deadline) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      if (directory === "--empty" && (await listKeys(client, bucket)).length)
        throw new StorageError("Target bucket is not empty");
    } else if (command === "backup")
      await backupObjects(client, bucket, directory);
    else if (command === "restore")
      await restoreObjects(client, bucket, directory, option === "--resume");
    else if (command === "verify")
      await verifyObjects(client, bucket, directory);
    else {
      if (directory !== "--confirm-replace-target")
        throw new StorageError("clear requires --confirm-replace-target");
      for (const key of await listKeys(client, bucket))
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        );
    }
  } finally {
    client.destroy();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(
      `Storage operation failed (${error instanceof StorageError ? error.message : error instanceof Error ? error.name : "Error"}). Check bucket access, configuration and backup integrity.`,
    );
    process.exitCode = 1;
  });
}
