// SPDX-License-Identifier: AGPL-3.0-only
import React, { useState } from "react";
import QRCode from "qrcode";
import type { CurrentUser } from "@infosteed/shared";
import { completeTwoFactorLogin, login, setupAdmin } from "../api";
import { errorMessage } from "../errors";
import { t } from "../i18n";
import { BrandMark } from "./BrandMark";
import { LanguageSelect } from "./LanguageSelect";

export function AuthForm({
  mode,
  onDone,
}: {
  mode: "setup" | "login";
  onDone: (user: CurrentUser) => void;
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [stage, setStage] = useState<
    "password" | "verify" | "enroll" | "recovery"
  >("password");
  const [continuationToken, setContinuationToken] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [manualSecret, setManualSecret] = useState("");
  const [otpauthUri, setOtpauthUri] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [completedUser, setCompletedUser] = useState<CurrentUser>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      if (stage === "recovery" && completedUser) {
        onDone(completedUser);
        return;
      }
      if (mode === "setup") {
        const result = await setupAdmin({
          username,
          displayName: displayName || username,
          password,
          setupToken,
        });
        onDone(result.user);
        return;
      }
      if (stage === "password") {
        const result = await login({ username, password });
        if ("user" in result) {
          onDone(result.user);
          return;
        }
        setContinuationToken(result.continuationToken);
        if (result.status === "two_factor_required") {
          setStage("verify");
          return;
        }
        setManualSecret(result.manualSecret);
        setOtpauthUri(result.otpauthUri);
        setQrCode(await QRCode.toDataURL(result.otpauthUri));
        setStage("enroll");
        return;
      }
      const result = await completeTwoFactorLogin({
        continuationToken,
        code: twoFactorCode,
      });
      if (result.recoveryCodes?.length) {
        setRecoveryCodes(result.recoveryCodes);
        setCompletedUser(result.user);
        setStage("recovery");
        return;
      }
      onDone(result.user);
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <div className="auth-brand">
          <BrandMark />
          <p>{mode === "setup" ? t("First Run") : "InfoSteed"}</p>
        </div>
        <h1>
          {mode === "setup"
            ? t("Create the first admin")
            : stage === "verify"
              ? t("Enter your 2FA code")
              : stage === "enroll"
                ? t("Set up 2FA")
                : stage === "recovery"
                  ? t("Save recovery codes")
                  : t("Sign in")}
        </h1>
        {stage === "password" && (
          <label>
            {t("Username")}
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
            />
          </label>
        )}
        {mode === "setup" && stage === "password" && (
          <label>
            {t("Display name")}
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
        )}
        {stage === "password" && (
          <label>
            {t("Password")}
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={
                mode === "setup" ? "new-password" : "current-password"
              }
            />
          </label>
        )}
        {mode === "setup" && stage === "password" && (
          <label>
            {t("Setup token")}
            <input
              type="password"
              value={setupToken}
              onChange={(event) => setSetupToken(event.target.value)}
              autoComplete="off"
              minLength={32}
            />
          </label>
        )}
        {stage === "enroll" && (
          <div className="two-factor-setup">
            {qrCode && <img src={qrCode} alt={t("2FA QR code")} />}
            <p>{t("Scan the QR code or enter this setup key manually.")}</p>
            <code>{manualSecret}</code>
            <small>{otpauthUri}</small>
          </div>
        )}
        {(stage === "verify" || stage === "enroll") && (
          <label>
            {stage === "verify"
              ? t("2FA or recovery code")
              : t("Authenticator code")}
            <input
              value={twoFactorCode}
              onChange={(event) => setTwoFactorCode(event.target.value)}
              autoComplete="one-time-code"
              inputMode="numeric"
            />
          </label>
        )}
        {stage === "recovery" && (
          <div className="recovery-codes">
            <p>
              {t(
                "These recovery codes are shown once. Store them somewhere safe.",
              )}
            </p>
            <pre>{recoveryCodes.join("\n")}</pre>
          </div>
        )}
        <button disabled={submitting}>
          {submitting
            ? t("Working...")
            : stage === "recovery"
              ? t("Continue")
              : mode === "setup"
                ? t("Create Admin")
                : stage === "verify"
                  ? t("Verify")
                  : stage === "enroll"
                    ? t("Enable and sign in")
                    : t("Log In")}
        </button>
        {error && <p className="error">{error}</p>}
        <a href="/?view=legal">{t("About and legal")}</a>
        <LanguageSelect compact />
      </form>
    </main>
  );
}
