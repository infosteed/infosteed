// SPDX-License-Identifier: AGPL-3.0-only
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PublicSystemInfo } from "@infosteed/shared";
import { connectServer, disconnectServer } from "./apiClient";
import { BrandMark } from "./BrandMark";
import { errorMessage } from "./errors";
import { t } from "./i18n";
import { LanguageSelect } from "./LanguageSelect";
import "./options.css";

document.title = t("Configure InfoSteed");

export function Options() {
  const [serverUrl, setServerUrl] = useState("");
  const [info, setInfo] = useState<PublicSystemInfo>();
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void chrome.storage.local
      .get([
        "serverOrigin",
        "connectedSystemInfo",
        "recorderStatus",
        "recordingId",
      ])
      .then((stored) => {
        setServerUrl(stored.serverOrigin ?? "");
        setInfo(stored.connectedSystemInfo);
        setBlocked(
          (stored.recorderStatus ?? "idle") !== "idle" ||
            Boolean(stored.recordingId),
        );
      });
  }, []);

  async function connect() {
    setBusy(true);
    setError(undefined);
    try {
      const connection = await connectServer(serverUrl);
      setServerUrl(connection.serverOrigin);
      setInfo(connection.systemInfo);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(undefined);
    try {
      await disconnectServer();
      setServerUrl("");
      setInfo(undefined);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <div className="product-header">
        <BrandMark />
        <div>
          <p className="product-name">InfoSteed</p>
          <h1>{t("Connect your self-hosted server")}</h1>
        </div>
      </div>
      <p>
        {t(
          "The extension sends recordings only to the server you select and approve here.",
        )}
      </p>
      <section className="card">
        <label>
          {t("Server URL")}
          <input
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            placeholder="https://guides.example.com"
            disabled={blocked || busy}
          />
        </label>
        <small>
          {t(
            "HTTPS is required except for localhost and 127.0.0.1. Permission is requested only for this origin.",
          )}
        </small>
        <div className="actions">
          <button
            disabled={blocked || busy || !serverUrl}
            onClick={() => void connect()}
          >
            {busy ? t("Checking...") : t("Connect and verify")}
          </button>
          {info && (
            <button
              className="secondary"
              disabled={blocked || busy}
              onClick={() => void disconnect()}
            >
              {t("Disconnect")}
            </button>
          )}
        </div>
        {blocked && (
          <p className="error">
            {t(
              "Finish or discard the active or recoverable recording before changing servers.",
            )}
          </p>
        )}
        {error && <p className="error">{error}</p>}
        {info && (
          <div className="status">
            <strong>
              {info.productName} {info.releaseVersion}
            </strong>
            <br />
            <small>
              {t("Protocol {protocol}; commit {commit}", {
                protocol: info.protocolVersion,
                commit: info.releaseCommit,
              })}
            </small>
          </div>
        )}
      </section>
      <h2>{t("Language")}</h2>
      <LanguageSelect />
      <h2>{t("Privacy and legal")}</h2>
      <p>
        {t(
          "No telemetry is enabled by default. Depending on your choices, the selected server may receive page metadata, interaction data, screenshots, video, microphone, tab audio, webcam, transcription text, narration text, and generated speech.",
        )}
      </p>
      <p>
        {t(
          "This software is provided under AGPL-3.0-only without warranty. The server's About and Legal view links to the corresponding source for its exact version.",
        )}
      </p>
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Options />);
