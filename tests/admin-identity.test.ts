import { describe, expect, it } from "vitest";
import {
  adminDatabaseUserId,
  publicAuthAdmin,
  requireAdminDatabaseUserId,
} from "../functions/_lib/auth/admin-identity";
import type { AuthAdmin } from "../functions/_lib/types";

describe("admin identity boundaries", () => {
  it("keeps database attribution internal to a user-backed admin", () => {
    const actor: AuthAdmin = {
      id: "audit-admin",
      databaseUserId: "user-admin",
      email: "admin@example.test",
      role: "admin",
    };

    expect(adminDatabaseUserId(actor)).toBe("user-admin");
    expect(requireAdminDatabaseUserId(actor)).toBe("user-admin");
    expect(publicAuthAdmin(actor)).toEqual({
      id: "audit-admin",
      email: "admin@example.test",
      role: "admin",
    });
  });

  it("supports synthetic audit actors only for nullable database attribution", () => {
    const actor: AuthAdmin = { id: "api-key", databaseUserId: null, email: "api-key", role: "admin" };

    expect(adminDatabaseUserId(actor)).toBeNull();
    expect(() => requireAdminDatabaseUserId(actor)).toThrow();
    try {
      requireAdminDatabaseUserId(actor);
    } catch (error) {
      expect(error).toMatchObject({ status: 403, code: "USER_BACKED_ADMIN_REQUIRED" });
    }
  });

  it("fails closed when a caller omits the database identity classification", () => {
    const unclassified: AuthAdmin = { id: "legacy-admin", email: "admin@example.test", role: "admin" };

    expect(() => adminDatabaseUserId(unclassified)).toThrow();
    try {
      adminDatabaseUserId(unclassified);
    } catch (error) {
      expect(error).toMatchObject({ status: 500, code: "ADMIN_IDENTITY_UNCLASSIFIED" });
    }
  });
});
