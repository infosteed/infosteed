// SPDX-License-Identifier: AGPL-3.0-only
import {
  normalizeRawEvents,
  type ElementHints,
  type RawRecorderEvent,
} from "@infosteed/recorder-core";
import { t } from "./i18n";
import { PRODUCT_IDENTIFIERS } from "@infosteed/shared";

interface RecorderInstallation {
  cleanup: () => void;
}
const recorderWindow = window as Window & {
  __infosteedRecorderInstalled?: boolean;
  __infosteedRecorderInstallation?: RecorderInstallation;
};
try {
  recorderWindow.__infosteedRecorderInstallation?.cleanup();
} catch {
  /* invalidated extension context */
}
delete recorderWindow.__infosteedRecorderInstalled;
const listenerAbort = new AbortController();

const handleRuntimeMessage = (
  message: { type?: string },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => {
  if (message?.type !== PRODUCT_IDENTIFIERS.recorderPing) return false;
  sendResponse({ ok: true });
  return false;
};
chrome.runtime.onMessage.addListener(handleRuntimeMessage);

async function isConfiguredWebAppOrigin(origin: string): Promise<boolean> {
  const stored = await chrome.storage.local.get("serverOrigin");
  if (!stored.serverOrigin) return false;
  try {
    return new URL(stored.serverOrigin).origin === origin;
  } catch {
    return false;
  }
}

window.addEventListener(
  "message",
  (event) => {
    if (event.source !== window) return;
    const data = event.data as {
      source?: string;
      type?: string;
      recordingId?: string;
      requestId?: string;
    };
    if (
      data?.source !== PRODUCT_IDENTIFIERS.webMessageSource ||
      data.type !== "start-capture-existing"
    )
      return;

    void (async () => {
      const requestId = data.requestId;
      try {
        if (!(await isConfiguredWebAppOrigin(window.location.origin))) {
          throw new Error(
            t("InfoSteed extension is not configured for this web app origin"),
          );
        }
        if (!data.recordingId) throw new Error(t("Missing recording id"));
        const result = await chrome.runtime.sendMessage({
          type: "start-recording-existing",
          recordingId: data.recordingId,
        });
        window.postMessage(
          {
            source: PRODUCT_IDENTIFIERS.extensionMessageSource,
            type: "start-capture-existing-result",
            requestId,
            result,
          },
          window.location.origin,
        );
      } catch (error) {
        window.postMessage(
          {
            source: PRODUCT_IDENTIFIERS.extensionMessageSource,
            type: "start-capture-existing-result",
            requestId,
            result: {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            },
          },
          window.location.origin,
        );
      }
    })();
  },
  { signal: listenerAbort.signal },
);

function text(value: string | null | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

const ACTIONABLE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "label",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='tab']",
  "[role='option']",
  "[aria-label]",
  "[title]",
  "[tabindex]:not([tabindex='-1'])",
  "canvas",
].join(",");

function meaningfulTarget(target: Element): Element {
  return target.closest(ACTIONABLE_SELECTOR) ?? target;
}

function shouldRecordClick(element: Element, rect: DOMRect): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag === "html" || tag === "body") return false;
  if (tag === "canvas") return true;

  const html = element as HTMLElement;
  const role = html.getAttribute("role");
  const hasExplicitName = Boolean(
    html.getAttribute("aria-label") || html.title || labelFor(element),
  );
  const isNativeControl = [
    "button",
    "a",
    "input",
    "select",
    "textarea",
    "label",
  ].includes(tag);
  const isInteractiveRole = Boolean(
    role && /^(button|link|menuitem|checkbox|radio|tab|option)$/.test(role),
  );
  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
  const targetArea = Math.max(1, rect.width * rect.height);

  if (isNativeControl || isInteractiveRole || hasExplicitName) return true;
  if (targetArea / viewportArea > 0.2) return false;

  return Boolean(text(html.innerText || html.textContent));
}

function labelFor(element: Element): string | undefined {
  if (!(element instanceof HTMLElement)) return undefined;
  if (element.id) {
    const label = document.querySelector(
      `label[for="${CSS.escape(element.id)}"]`,
    );
    if (label) return text(label.textContent);
  }
  const wrapped = element.closest("label");
  return text(wrapped?.textContent);
}

function nearbyHeading(element: Element): string | undefined {
  const dialog = element.closest(
    "[role='dialog'], dialog, [aria-modal='true']",
  );
  const dialogTitle = dialog?.querySelector("h1,h2,h3,[role='heading']");
  if (dialogTitle) return text(dialogTitle.textContent);

  let current: Element | null = element;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const heading = current.querySelector?.("h1,h2,h3,[role='heading']");
    if (heading) return text(heading.textContent);
    current = current.parentElement;
  }
  return undefined;
}

function elementHints(element: Element): ElementHints {
  const html = element as HTMLElement;
  const input = element as HTMLInputElement;

  return {
    tagName: element.tagName,
    type: "type" in input ? input.type : undefined,
    role: html.getAttribute("role"),
    name: "name" in input ? input.name : undefined,
    id: html.id,
    labelText: labelFor(element),
    ariaLabel: html.getAttribute("aria-label"),
    placeholder: "placeholder" in input ? input.placeholder : undefined,
    title: html.title,
    text: text(html.innerText || html.textContent),
    autocomplete: "autocomplete" in input ? input.autocomplete : undefined,
  };
}

function canvasPosition(event: MouseEvent, rect: DOMRect) {
  const xRatio = Math.max(
    0,
    Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)),
  );
  const yRatio = Math.max(
    0,
    Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)),
  );
  const horizontal =
    xRatio < 1 / 3 ? "left" : xRatio > 2 / 3 ? "right" : "centre";
  const vertical =
    yRatio < 1 / 3 ? "upper" : yRatio > 2 / 3 ? "lower" : "middle";
  const region =
    horizontal === "centre" && vertical === "middle"
      ? "centre area"
      : vertical === "middle"
        ? `${horizontal} side`
        : horizontal === "centre"
          ? `${vertical} centre area`
          : `${vertical}-${horizontal} area`;
  return { xRatio, yRatio, region };
}

function pointTargetBox(event: MouseEvent, rect: DOMRect) {
  const size = Math.min(40, Math.max(1, rect.width), Math.max(1, rect.height));
  return {
    x: Math.max(
      rect.left,
      Math.min(rect.right - size, event.clientX - size / 2),
    ),
    y: Math.max(
      rect.top,
      Math.min(rect.bottom - size, event.clientY - size / 2),
    ),
    width: size,
    height: size,
    devicePixelRatio: window.devicePixelRatio || 1,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
}

function rawClickEvent(event: MouseEvent): RawRecorderEvent | undefined {
  const eventTarget = event.target;
  if (!(eventTarget instanceof Element)) return undefined;
  const target = meaningfulTarget(eventTarget);
  const rect = target.getBoundingClientRect();
  if (!shouldRecordClick(target, rect)) return undefined;
  const isCanvas = target.tagName.toLowerCase() === "canvas";
  const position = isCanvas ? canvasPosition(event, rect) : undefined;
  const hints = elementHints(target);
  if (position && !hints.ariaLabel)
    hints.ariaLabel = `the ${position.region} of the map`;

  return {
    actionType: "click",
    timestamp: Date.now(),
    pageTitle: document.title,
    url: window.location.href,
    element: hints,
    nearbyHeading: nearbyHeading(target),
    canvasPosition: position,
    boundingBox: isCanvas
      ? pointTargetBox(event, rect)
      : {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          devicePixelRatio: window.devicePixelRatio || 1,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        },
  };
}

let preparedCaptureId: string | undefined;
let preparedCaptureAt = 0;
let preparedCaptureReady: Promise<unknown> | undefined;
let preparedEvent: ReturnType<typeof normalizeRawEvents>[number] | undefined;
let preparedPointerId: number | undefined;
let preparedPointerX = 0;
let preparedPointerY = 0;
let lastPointerActionAt = 0;

function prepareScreenshot(event: PointerEvent) {
  clearPreparedPointer();
  if (event.button !== 0) return;
  const raw = rawClickEvent(event);
  if (!raw) return;
  const [normalized] = normalizeRawEvents([raw]);
  if (!normalized) return;

  preparedCaptureId = crypto.randomUUID();
  preparedCaptureAt = Date.now();
  preparedEvent = normalized;
  preparedPointerId = event.pointerId;
  preparedPointerX = event.clientX;
  preparedPointerY = event.clientY;
  preparedCaptureReady = chrome.runtime.sendMessage({
    type: "prepare-action-screenshot",
    captureId: preparedCaptureId,
    targetBox: normalized.boundingBox,
  });
  void preparedCaptureReady.catch(() => undefined);
}

function sendAction(
  event: ReturnType<typeof normalizeRawEvents>[number],
  captureId?: string,
  captureReady?: Promise<unknown>,
) {
  void (async () => {
    await captureReady?.catch(() => undefined);
    await chrome.runtime.sendMessage({
      type: "record-action",
      event,
      captureId,
    });
  })();
}

function clearPreparedPointer() {
  preparedCaptureId = undefined;
  preparedCaptureAt = 0;
  preparedCaptureReady = undefined;
  preparedEvent = undefined;
  preparedPointerId = undefined;
}

function recordPreparedPointer(event: PointerEvent) {
  if (event.pointerId !== preparedPointerId || !preparedEvent) return;
  const moved = Math.hypot(
    event.clientX - preparedPointerX,
    event.clientY - preparedPointerY,
  );
  const normalized = preparedEvent;
  const captureId = preparedCaptureId;
  const captureReady = preparedCaptureReady;
  clearPreparedPointer();
  if (moved > 8) return;
  lastPointerActionAt = Date.now();
  sendAction(normalized, captureId, captureReady);
}

window.addEventListener("pointerdown", prepareScreenshot, {
  capture: true,
  signal: listenerAbort.signal,
});
window.addEventListener("pointerup", recordPreparedPointer, {
  capture: true,
  signal: listenerAbort.signal,
});
window.addEventListener("pointercancel", clearPreparedPointer, {
  capture: true,
  signal: listenerAbort.signal,
});

document.addEventListener(
  "click",
  (event) => {
    // Pointer interactions are committed on pointerup because canvas-heavy apps
    // often suppress the later click. Keep click for keyboard activation.
    if (Date.now() - lastPointerActionAt < 750) return;
    const raw = rawClickEvent(event);
    if (!raw) return;
    const [normalized] = normalizeRawEvents([raw]);
    if (!normalized) return;
    const captureId =
      preparedCaptureId && Date.now() - preparedCaptureAt < 3000
        ? preparedCaptureId
        : undefined;
    const captureReady = preparedCaptureReady;
    clearPreparedPointer();
    sendAction(normalized, captureId, captureReady);
  },
  { capture: true, signal: listenerAbort.signal },
);

recorderWindow.__infosteedRecorderInstallation = {
  cleanup: () => {
    listenerAbort.abort();
    try {
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    } catch {
      /* invalidated extension context */
    }
  },
};
