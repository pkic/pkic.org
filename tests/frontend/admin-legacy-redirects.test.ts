import { describe, expect, it } from "vitest";
import { ADMIN_ACCOUNT_REDIRECT_TARGET, legacyAdminRedirectTarget } from "../../assets/ts/admin/shell/legacy-redirects";

describe("legacy admin route redirects", () => {
  it("moves account settings to the canonical portal route while preserving unrelated routes", () => {
    expect(legacyAdminRedirectTarget("/account")).toBe(ADMIN_ACCOUNT_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/account?from=bookmark")).toBe(ADMIN_ACCOUNT_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/users")).toBeNull();
  });
});
