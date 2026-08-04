// SPDX-License-Identifier: AGPL-3.0-only
import React, { useState } from "react";
import type { CurrentUser } from "@infosteed/shared";
import { login, setupAdmin } from "../api";
import { errorMessage } from "../errors";

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
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const result =
        mode === "setup"
          ? await setupAdmin({
              username,
              displayName: displayName || username,
              password,
              setupToken,
            })
          : await login({ username, password });
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
        <p>{mode === "setup" ? "First Run" : "InfoSteed"}</p>
        <h1>{mode === "setup" ? "Create the first admin" : "Sign in"}</h1>
        <label>
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
          />
        </label>
        {mode === "setup" && (
          <label>
            Display name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
        )}
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={
              mode === "setup" ? "new-password" : "current-password"
            }
          />
        </label>
        {mode === "setup" && (
          <label>
            Setup token
            <input
              type="password"
              value={setupToken}
              onChange={(event) => setSetupToken(event.target.value)}
              autoComplete="off"
              minLength={32}
            />
          </label>
        )}
        <button disabled={submitting}>
          {submitting
            ? "Working..."
            : mode === "setup"
              ? "Create Admin"
              : "Log In"}
        </button>
        {error && <p className="error">{error}</p>}
        <a href="/?view=legal">About and legal</a>
      </form>
    </main>
  );
}
