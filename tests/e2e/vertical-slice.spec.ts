// SPDX-License-Identifier: AGPL-3.0-only
import JSZip from "jszip";
import { gunzipSync } from "node:zlib";
import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

const apiUrl = process.env.INFOSTEED_API_URL;
const onePixelPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function readTarGz(buffer: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(buffer);
  const files = new Map<string, Buffer>();
  let offset = 0;

  while (offset + 512 <= tar.byteLength) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    if (!name) break;
    const sizeText = header
      .subarray(124, 136)
      .toString("ascii")
      .replace(/\0.*$/, "")
      .trim();
    const size = Number.parseInt(sizeText || "0", 8);
    const contentStart = offset + 512;
    files.set(name, tar.subarray(contentStart, contentStart + size));
    offset = contentStart + Math.ceil(size / 512) * 512;
  }

  return files;
}

async function authenticate(
  request: APIRequestContext,
): Promise<Record<string, string>> {
  test.skip(
    !apiUrl,
    "Set INFOSTEED_API_URL to a running API backed by PostgreSQL",
  );

  const setup = await request.get(`${apiUrl}/setup/status`);
  const setupRequired = ((await setup.json()) as { required: boolean })
    .required;
  const username = process.env.INFOSTEED_TEST_USERNAME ?? "acceptance-admin";
  const password =
    process.env.INFOSTEED_TEST_PASSWORD ?? "acceptance-test-password";
  if (setupRequired) {
    const setupPayload = {
      username,
      displayName: "Acceptance Admin",
      password,
      setupToken:
        process.env.INFOSTEED_SETUP_TOKEN ??
        "local-development-setup-token-0001",
    };
    const simultaneous = await Promise.all([
      request.post(`${apiUrl}/setup/admin`, { data: setupPayload }),
      request.post(`${apiUrl}/setup/admin`, { data: setupPayload }),
    ]);
    expect(simultaneous.map((response) => response.status()).sort()).toEqual([
      201, 409,
    ]);
  }
  expect(
    (
      await request.post(`${apiUrl}/auth/login`, {
        data: { username, password },
      })
    ).ok(),
  ).toBe(true);
  const csrfToken = (
    (await (await request.get(`${apiUrl}/auth/csrf`)).json()) as {
      csrfToken: string;
    }
  ).csrfToken;
  return { "x-csrf-token": csrfToken };
}

test("serves the matching offline extension from the web deployment", async ({
  request,
}) => {
  test.skip(!apiUrl, "Set INFOSTEED_API_URL to a running InfoSteed deployment");

  const deploymentOrigin = new URL(apiUrl!).origin;
  const response = await request.get(
    `${deploymentOrigin}/downloads/extension-offline.zip`,
  );
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/zip");

  const zip = await JSZip.loadAsync(Buffer.from(await response.body()));
  const manifestText = await zip.file("manifest.json")?.async("string");
  expect(manifestText).toBeTruthy();
  const manifest = JSON.parse(manifestText!) as {
    manifest_version: number;
    key?: string;
  };
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.key).toBeTruthy();
  expect(zip.file("background.js")).toBeTruthy();
  expect(zip.file("contentScript.js")).toBeTruthy();
  expect(zip.file("src/popup.html")).toBeTruthy();
});

test("creates and exports an offline guide over HTTP", async ({ request }) => {
  const mutationHeaders = await authenticate(request);

  const create = await request.post(`${apiUrl}/recordings`, {
    headers: mutationHeaders,
    data: {
      title: "Test workflow",
      purpose: "Acceptance test",
      audience: "Internal users",
    },
  });
  expect(create.ok()).toBe(true);
  const { id } = (await create.json()) as { id: string };

  const events = await request.post(`${apiUrl}/recordings/${id}/events`, {
    headers: mutationHeaders,
    data: {
      events: [
        {
          actionType: "click",
          pageTitle: "Demo",
          sanitizedUrl: "https://example.test/demo",
          elementName: "Login",
          elementRole: "button",
          boundingBox: {
            x: 1,
            y: 1,
            width: 10,
            height: 10,
            devicePixelRatio: 1,
            scrollX: 0,
            scrollY: 0,
          },
          metadata: {},
        },
      ],
    },
  });
  expect(events.ok()).toBe(true);
  const event = ((await events.json()) as { events: Array<{ id: string }> })
    .events[0];

  const screenshot = await request.post(
    `${apiUrl}/recordings/${id}/screenshots`,
    {
      headers: mutationHeaders,
      data: {
        eventId: event.id,
        filename: "step-001-login.webp",
        contentType: "image/png",
        imageBase64: onePixelPng,
        targetBox: {
          x: 1,
          y: 1,
          width: 10,
          height: 10,
          devicePixelRatio: 1,
          scrollX: 0,
          scrollY: 0,
        },
      },
    },
  );
  expect(screenshot.ok()).toBe(true);

  const finalized = await request.post(`${apiUrl}/recordings/${id}/finalize`, {
    headers: mutationHeaders,
  });
  expect(finalized.ok()).toBe(true);

  const exported = await request.get(`${apiUrl}/recordings/${id}/export`);
  expect(exported.ok()).toBe(true);
  const zip = await JSZip.loadAsync(Buffer.from(await exported.body()));
  const guide = await zip.file("workflow-guide/guide.md")?.async("string");

  const workflowImagePath =
    guide?.match(/\.\/(images\/step-001-login-[^)]+\.webp)/)?.[1] ?? "";
  expect(workflowImagePath).toMatch(
    /^images\/step-001-login-\d{8}T\d{9}\.webp$/,
  );
  expect(guide).not.toMatch(
    /https?:\/\/|s3:\/\/|blob:|data:|chrome-extension:/i,
  );
  expect(zip.file("workflow-guide/recording.json")).toBeTruthy();
  expect(zip.file(`workflow-guide/${workflowImagePath}`)).toBeTruthy();

  const wiziwigExport = await request.get(
    `${apiUrl}/recordings/${id}/export/wiziwig`,
  );
  expect(wiziwigExport.ok()).toBe(true);
  expect(wiziwigExport.headers()["content-type"]).toContain("application/zip");
  expect(wiziwigExport.headers()["content-disposition"]).toContain(
    `infosteed-guide-${id}-wiziwig.zip`,
  );
  const wiziwigZip = await JSZip.loadAsync(
    Buffer.from(await wiziwigExport.body()),
  );
  const wiziwigHtml = await wiziwigZip.file("guide.html")?.async("string");
  const wiziwigImagePath =
    wiziwigHtml?.match(/src="(images\/step-001-login-[^"]+\.jpg)"/)?.[1] ?? "";
  expect(wiziwigImagePath).toMatch(/^images\/step-001-login-\d{8}T\d{9}\.jpg$/);
  expect(wiziwigHtml).not.toContain("data:image/");
  expect(wiziwigZip.file(wiziwigImagePath)).toBeTruthy();
  expect(wiziwigZip.file("images/step-001-login.webp")).toBeNull();

  const sanityExport = await request.get(
    `${apiUrl}/recordings/${id}/export/sanity`,
  );
  expect(sanityExport.ok()).toBe(true);
  expect(sanityExport.headers()["content-type"]).toContain("application/gzip");
  expect(sanityExport.headers()["content-disposition"]).toContain(
    `infosteed-guide-${id}-sanity.tar.gz`,
  );

  const sanityFiles = readTarGz(Buffer.from(await sanityExport.body()));
  const sanityDocument = JSON.parse(
    sanityFiles.get("data.ndjson")!.toString("utf8"),
  );
  expect(sanityDocument._id).toBe(`infosteed-${id}`);
  expect(sanityDocument._type).toBe("workflowGuide");
  const sanityImagePath = sanityDocument.content[0].image._sanityAsset.replace(
    "image@file://./",
    "",
  );
  expect(sanityImagePath).toMatch(/^images\/step-001-login-\d{8}T\d{9}\.webp$/);
  expect(sanityFiles.get(sanityImagePath)).toBeTruthy();

  const capability = await request.get(`${apiUrl}/capabilities/video`);
  expect(capability.ok()).toBe(true);
  const videoCapability = (await capability.json()) as {
    enabled: boolean;
    transcription: {
      enabled: boolean;
      model: string | null;
      maxUploadBytes: number | null;
    };
  };
  expect(videoCapability.enabled).toBe(true);
  expect(typeof videoCapability.transcription.enabled).toBe("boolean");
});

test("runs the video recording lifecycle over HTTP", async ({ request }) => {
  const mutationHeaders = await authenticate(request);
  const videoCapability = (await (
    await request.get(`${apiUrl}/capabilities/video`)
  ).json()) as {
    enabled: boolean;
    transcription: { enabled: boolean };
  };

  const createVideo = await request.post(`${apiUrl}/recordings`, {
    headers: mutationHeaders,
    data: { title: "Video-only acceptance", captureMode: "video" },
  });
  expect(createVideo.ok()).toBe(true);
  const videoRecordingId = ((await createVideo.json()) as { id: string }).id;
  const videoEventResponse = await request.post(
    `${apiUrl}/recordings/${videoRecordingId}/events`,
    {
      headers: mutationHeaders,
      data: {
        events: [
          {
            actionType: "click",
            pageTitle: "Demo",
            sanitizedUrl: "https://example.test/video",
            elementName: "Publish",
            videoOffsetMs: 1200,
            metadata: {},
          },
        ],
      },
    },
  );
  expect(videoEventResponse.ok()).toBe(true);

  const initializedVideo = await request.post(
    `${apiUrl}/recordings/${videoRecordingId}/video`,
    {
      headers: mutationHeaders,
      data: {
        captureSettings: {
          tabAudio: true,
          microphone: false,
          webcam: false,
          maxWidth: 1920,
          maxHeight: 1080,
          frameRate: 30,
        },
        assets: [
          {
            kind: "composite",
            mimeType: "video/webm",
            codec: "vp9,opus",
            width: 1280,
            height: 720,
          },
          {
            kind: "screen",
            mimeType: "video/webm",
            codec: "vp9,opus",
            width: 1280,
            height: 720,
          },
          { kind: "transcription", mimeType: "audio/webm", codec: "opus" },
        ],
      },
    },
  );
  expect(initializedVideo.ok()).toBe(true);
  const videoMetadata = (await initializedVideo.json()) as {
    assets: Array<{ id: string; kind: string }>;
  };
  for (const asset of videoMetadata.assets) {
    const uploaded = await request.put(
      `${apiUrl}/recordings/${videoRecordingId}/video/assets/${asset.id}/parts/1`,
      {
        headers: {
          ...mutationHeaders,
          "content-type": "application/octet-stream",
          "x-infosteed-start-ms": "0",
          "x-infosteed-end-ms": "2500",
        },
        data: Buffer.from(`mock-${asset.kind}-webm`),
      },
    );
    expect(uploaded.ok()).toBe(true);
  }

  const videoFinalized = await request.post(
    `${apiUrl}/recordings/${videoRecordingId}/video/finalize`,
    {
      headers: mutationHeaders,
      data: {
        durationMs: 2500,
        assets: videoMetadata.assets.map((asset) => ({
          assetId: asset.id,
          durationMs: 2500,
        })),
      },
    },
  );
  expect(videoFinalized.ok()).toBe(true);
  const finalizedVideo = await videoFinalized.json();
  expect(finalizedVideo.status).toBe("ready");
  expect(finalizedVideo.chapters).toEqual([
    expect.objectContaining({ title: "Click Publish", offsetMs: 1200 }),
  ]);
  expect(
    videoCapability.transcription.enabled
      ? ["pending", "processing", "ready", "failed"]
      : ["disabled"],
  ).toContain(finalizedVideo.transcriptionStatus);

  const transcriptResponse = await request.get(
    `${apiUrl}/recordings/${videoRecordingId}/video/transcript`,
  );
  expect(transcriptResponse.ok()).toBe(true);
  const transcript = await transcriptResponse.json();
  expect(transcript).toEqual(
    expect.objectContaining({
      status: expect.any(String),
      text: expect.any(String),
      segments: expect.any(Array),
      words: expect.any(Array),
    }),
  );

  const videoOnlyRecording = await (
    await request.get(`${apiUrl}/recordings/${videoRecordingId}`)
  ).json();
  expect(videoOnlyRecording.captureMode).toBe("video");
  expect(videoOnlyRecording.steps).toEqual([]);
  expect(videoOnlyRecording.items).toEqual([]);

  const ranged = await request.get(
    `${apiUrl}/recordings/${videoRecordingId}/video/content`,
    { headers: { Range: "bytes=0-3" } },
  );
  expect(ranged.status()).toBe(206);
  expect(ranged.headers()["content-range"]).toContain("bytes 0-3/");
  expect(
    (
      await request.post(
        `${apiUrl}/recordings/${videoRecordingId}/video/publish`,
        { headers: mutationHeaders },
      )
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.delete(`${apiUrl}/recordings/${videoRecordingId}/video`, {
        headers: mutationHeaders,
      })
    ).status(),
  ).toBe(204);
});

test("keeps combined guide and video output synchronized over HTTP", async ({
  request,
}) => {
  const mutationHeaders = await authenticate(request);

  const createBoth = await request.post(`${apiUrl}/recordings`, {
    headers: mutationHeaders,
    data: { title: "Synchronized acceptance", captureMode: "both" },
  });
  const bothId = ((await createBoth.json()) as { id: string }).id;
  const bothEventResponse = await request.post(
    `${apiUrl}/recordings/${bothId}/events`,
    {
      headers: mutationHeaders,
      data: {
        events: [
          {
            actionType: "click",
            pageTitle: "Demo",
            sanitizedUrl: "https://example.test/both",
            elementName: "Continue",
            videoOffsetMs: 800,
            metadata: {},
          },
        ],
      },
    },
  );
  const bothEvent = (
    (await bothEventResponse.json()) as { events: Array<{ id: string }> }
  ).events[0];
  expect(
    (
      await request.post(`${apiUrl}/recordings/${bothId}/screenshots`, {
        headers: mutationHeaders,
        data: {
          eventId: bothEvent.id,
          filename: "step-001-continue.webp",
          contentType: "image/png",
          imageBase64: onePixelPng,
        },
      })
    ).ok(),
  ).toBe(true);
  const bothInitialized = await request.post(
    `${apiUrl}/recordings/${bothId}/video`,
    {
      headers: mutationHeaders,
      data: {
        captureSettings: {
          tabAudio: true,
          microphone: false,
          webcam: false,
          maxWidth: 1920,
          maxHeight: 1080,
          frameRate: 30,
        },
        assets: [
          {
            kind: "composite",
            mimeType: "video/webm",
            width: 1280,
            height: 720,
          },
          { kind: "screen", mimeType: "video/webm", width: 1280, height: 720 },
        ],
      },
    },
  );
  const bothAssets = (
    (await bothInitialized.json()) as {
      assets: Array<{ id: string; kind: string }>;
    }
  ).assets;
  for (const asset of bothAssets) {
    expect(
      (
        await request.put(
          `${apiUrl}/recordings/${bothId}/video/assets/${asset.id}/parts/1`,
          {
            headers: {
              ...mutationHeaders,
              "content-type": "application/octet-stream",
            },
            data: Buffer.from(`both-${asset.kind}`),
          },
        )
      ).ok(),
    ).toBe(true);
  }
  const bothFinalized = await request.post(
    `${apiUrl}/recordings/${bothId}/video/finalize`,
    {
      headers: mutationHeaders,
      data: {
        durationMs: 1800,
        assets: bothAssets.map((asset) => ({
          assetId: asset.id,
          durationMs: 1800,
        })),
      },
    },
  );
  const bothVideo = await bothFinalized.json();
  expect(bothVideo.chapters[0]).toMatchObject({ offsetMs: 800 });
  expect(bothVideo.chapters[0].guideItemId).toBeTruthy();
  const bothRecording = await (
    await request.get(`${apiUrl}/recordings/${bothId}`)
  ).json();
  expect(bothRecording.captureMode).toBe("both");
  expect(bothRecording.items).toHaveLength(1);
  expect(
    (
      await request.delete(`${apiUrl}/recordings/${bothId}/video`, {
        headers: mutationHeaders,
      })
    ).status(),
  ).toBe(204);
  expect((await request.get(`${apiUrl}/recordings/${bothId}`)).ok()).toBe(true);
});
