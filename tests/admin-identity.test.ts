import { describe, expect, it } from "vitest";
import {
  adminDatabaseUserId,
  createServiceAuthAdmin,
  createUserBackedAuthAdmin,
  isUserBackedAuthAdmin,
  publicAuthAdmin,
  requireAdminDatabaseUserId,
} from "../functions/_lib/auth/admin-identity";

describe("admin identity boundaries", () => {
  it("uses one canonical id for a user-backed admin", () => {
    const actor = createUserBackedAuthAdmin({
      id: "user-admin",
      email: "admin@example.test",
      role: "admin",
      scopes: ["admin:read"],
      grants: [{ permission: "admin:read", contextType: null, contextId: null }],
      sessionId: "private-session-id",
      expiresAt: "2099-01-01T00:00:00.000Z",
      state: "private-bookmark",
    });

    expect(isUserBackedAuthAdmin(actor)).toBe(true);
    expect(adminDatabaseUserId(actor)).toBe("user-admin");
    expect(requireAdminDatabaseUserId(actor)).toBe("user-admin");
    expect(publicAuthAdmin(actor)).toEqual({
      id: "user-admin",
      email: "admin@example.test",
      role: "admin",
      scopes: ["admin:read"],
      grants: [{ permission: "admin:read", contextType: null, contextId: null }],
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
  });

  it("supports synthetic audit actors only for nullable database attribution", () => {
    const actor = createServiceAuthAdmin({ id: "api-key", email: "api-key", role: "admin" });

    expect(isUserBackedAuthAdmin(actor)).toBe(false);
    expect(adminDatabaseUserId(actor)).toBeNull();
    expect(() => requireAdminDatabaseUserId(actor)).toThrow();
    try {
      requireAdminDatabaseUserId(actor);
    } catch (error) {
      expect(error).toMatchObject({ status: 403, code: "USER_BACKED_ADMIN_REQUIRED" });
    }
  });

  it("does not expose service provenance or internal auth state", () => {
    const actor = createServiceAuthAdmin({
      id: "api-key",
      email: "api-key",
      role: "admin",
      scopes: ["admin:read"],
    });

    expect(publicAuthAdmin(actor)).toEqual({
      id: "api-key",
      email: "api-key",
      role: "admin",
      scopes: ["admin:read"],
      grants: [],
      expiresAt: null,
    });
  });
});
