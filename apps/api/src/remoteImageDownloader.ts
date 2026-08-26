// SPDX-License-Identifier: AGPL-3.0-only
import { lookup } from "node:dns/promises";
import type { IncomingHttpHeaders } from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class RemoteImageDownloadError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "RemoteImageDownloadError";
  }
}

function isPublicAddress(address: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(address);
  } catch {
    return false;
  }
  if (parsed.kind() === "ipv6") {
    const ipv6 = parsed as ipaddr.IPv6;
    if (ipv6.isIPv4MappedAddress()) parsed = ipv6.toIPv4Address();
  }
  return parsed.range() === "unicast";
}

export async function resolvePublicAddresses(
  hostname: string,
): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicAddress(address))
  ) {
    throw new RemoteImageDownloadError(
      `Screenshot host does not resolve exclusively to public addresses: ${hostname}`,
    );
  }
  return addresses.map(({ address, family }) => ({
    address,
    family: family as 4 | 6,
  }));
}

function retryAfterMs(
  value: string | string[] | undefined,
): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const seconds = Number(raw);
  const duration = Number.isFinite(seconds)
    ? seconds * 1000
    : new Date(raw).getTime() - Date.now();
  if (!Number.isFinite(duration)) return undefined;
  return Math.max(0, Math.min(5 * 60_000, duration));
}

function validatedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RemoteImageDownloadError("Screenshot URL is invalid");
  }
  if (url.protocol !== "https:")
    throw new RemoteImageDownloadError("Screenshot URL must use HTTPS");
  if (url.username || url.password)
    throw new RemoteImageDownloadError(
      "Screenshot URL must not contain credentials",
    );
  return url;
}

async function requestOnce(
  url: URL,
  maxBytes: number,
  timeoutMs: number,
): Promise<{
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}> {
  const addresses = await resolvePublicAddresses(url.hostname);
  const chosen = addresses[0];
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
        headers: {
          accept:
            "image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.1",
          "user-agent": "InfoSteed-Scribe-Importer/1.0",
        },
        lookup: (_hostname, _options, callback) =>
          callback(null, chosen.address, chosen.family),
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const declaredLength = Number(response.headers["content-length"]);
        if (
          Number.isFinite(declaredLength) &&
          declaredLength > maxBytes &&
          !REDIRECT_STATUSES.has(statusCode)
        ) {
          response.resume();
          reject(
            new RemoteImageDownloadError(
              `Screenshot exceeds the ${maxBytes} byte limit`,
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBytes) {
            response.destroy(
              new RemoteImageDownloadError(
                `Screenshot exceeds the ${maxBytes} byte limit`,
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
        response.on("error", reject);
      },
    );
    request.setTimeout(timeoutMs, () =>
      request.destroy(
        new RemoteImageDownloadError("Screenshot download timed out", true),
      ),
    );
    request.on("error", (error) =>
      reject(
        error instanceof RemoteImageDownloadError
          ? error
          : new RemoteImageDownloadError(
              "Screenshot could not be downloaded",
              true,
            ),
      ),
    );
    request.end();
  });
}

export async function downloadRemoteImage(
  rawUrl: string,
  options: { maxBytes: number; timeoutMs?: number; maxRedirects?: number },
): Promise<{ body: Buffer; contentType: string | null; finalUrl: string }> {
  let url = validatedUrl(rawUrl);
  const maxRedirects = options.maxRedirects ?? 3;
  for (let redirects = 0; ; redirects += 1) {
    const response = await requestOnce(
      url,
      options.maxBytes,
      options.timeoutMs ?? 30_000,
    );
    if (REDIRECT_STATUSES.has(response.statusCode)) {
      if (redirects >= maxRedirects)
        throw new RemoteImageDownloadError(
          `Screenshot exceeded ${maxRedirects} redirects`,
        );
      const location = response.headers.location;
      if (!location)
        throw new RemoteImageDownloadError(
          "Screenshot redirect did not include a destination",
        );
      url = validatedUrl(new URL(location, url).toString());
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const retryable =
        response.statusCode === 408 ||
        response.statusCode === 429 ||
        response.statusCode >= 500;
      throw new RemoteImageDownloadError(
        `Screenshot server returned HTTP ${response.statusCode}`,
        retryable,
        response.statusCode === 429
          ? retryAfterMs(response.headers["retry-after"])
          : undefined,
      );
    }
    if (response.body.length === 0)
      throw new RemoteImageDownloadError("Screenshot response was empty");
    const header = response.headers["content-type"];
    return {
      body: response.body,
      contentType: Array.isArray(header) ? header[0] : (header ?? null),
      finalUrl: url.toString(),
    };
  }
}
