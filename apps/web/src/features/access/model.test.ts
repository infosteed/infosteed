// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { currentUser, project, recording } from "../../test/fixtures";
import {
  canManageProjectMembers,
  canMoveRecording,
  editableProjects,
} from "./model";

describe("access permissions", () => {
  it("allows administrators and project owners to manage members", () => {
    expect(
      canManageProjectMembers(currentUser({ role: "admin" }), undefined),
    ).toBe(true);
    expect(
      canManageProjectMembers(
        currentUser({ role: "user" }),
        project({ role: "owner" }),
      ),
    ).toBe(true);
    expect(
      canManageProjectMembers(
        currentUser({ role: "user" }),
        project({ role: "editor" }),
      ),
    ).toBe(false);
  });

  it("allows editors but not viewers to move recordings", () => {
    expect(canMoveRecording(recording({ userRole: "editor" }))).toBe(true);
    expect(canMoveRecording(recording({ userRole: "viewer" }))).toBe(false);
  });

  it("returns only projects that accept moved recordings", () => {
    expect(
      editableProjects([
        project({ id: "owner", role: "owner" }),
        project({ id: "editor", role: "editor" }),
        project({ id: "viewer", role: "viewer" }),
      ]).map((candidate) => candidate.id),
    ).toEqual(["owner", "editor"]);
  });
});
