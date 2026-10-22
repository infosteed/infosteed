// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { CurrentUser } from "@infosteed/shared";
import { PasswordResetDialog } from "./PasswordResetDialog";

const user: CurrentUser = {
  id: "user-1",
  username: "aideen",
  displayName: "Aideen",
  role: "user",
  enabled: true,
  twoFactorEnabled: false,
  twoFactorRequired: false,
  themePreference: "system",
};
afterEach(cleanup);

it("keeps failures in the dialog and allows retrying the selected user's reset", async () => {
  const onReset = vi
    .fn()
    .mockRejectedValueOnce(new Error("Reset unavailable"))
    .mockResolvedValueOnce(undefined);
  const onSuccess = vi.fn();
  const actions = userEvent.setup();
  render(
    <PasswordResetDialog
      user={user}
      onReset={onReset}
      onSuccess={onSuccess}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByText(/This signs them out/).textContent).toContain(
    "aideen",
  );
  const password = screen.getByLabelText("New password") as HTMLInputElement;
  await actions.type(password, "replacement-password");
  await actions.click(screen.getByRole("button", { name: "Show password" }));
  expect(password.type).toBe("text");
  await actions.click(screen.getByRole("button", { name: "Reset password" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Reset unavailable",
  );
  expect(onSuccess).not.toHaveBeenCalled();
  await actions.click(screen.getByRole("button", { name: "Reset password" }));
  await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  expect(onReset).toHaveBeenLastCalledWith(user.id, "replacement-password");
  expect(password.value).toBe("");
});

it("blocks duplicate resets while a request is pending", async () => {
  let finish!: () => void;
  const onReset = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const onSuccess = vi.fn();
  const onClose = vi.fn();
  const actions = userEvent.setup();
  render(
    <PasswordResetDialog
      user={user}
      onReset={onReset}
      onSuccess={onSuccess}
      onClose={onClose}
    />,
  );
  await actions.type(
    screen.getByLabelText("New password"),
    "replacement-password",
  );
  await actions.click(screen.getByRole("button", { name: "Reset password" }));
  expect(
    (screen.getByRole("button", { name: "Saving..." }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await actions.keyboard("{Escape}");
  expect(onClose).not.toHaveBeenCalled();
  finish();
  await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  expect(onReset).toHaveBeenCalledOnce();
});
