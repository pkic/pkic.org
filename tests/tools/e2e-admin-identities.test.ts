import { describe, expect, it } from "vitest";
import {
  E2E_ADMIN_SCOPES,
  e2eAdminEmailsForWorkerCount,
  formatE2eAdminEmail,
  type E2eAdminScope,
} from "../../scripts/e2e-admin-identities.mjs";

describe("E2E admin identities", () => {
  it("keeps every scenario and worker identity distinct", () => {
    const emails = e2eAdminEmailsForWorkerCount(3);
    expect(new Set(emails).size).toBe(E2E_ADMIN_SCOPES.length * 3);
    expect(emails).toContain("admin@pkic.org");
    expect(emails).toContain("admin.browser-waitlist.w2@pkic.org");
    expect(emails).toContain("admin.meeting-guest.w2@pkic.org");
  });

  it("rejects unknown scopes and invalid worker counts", () => {
    expect(() => formatE2eAdminEmail("unknown" as E2eAdminScope, 0)).toThrow("Unknown E2E admin scope");
    expect(() => e2eAdminEmailsForWorkerCount(0)).toThrow("Invalid E2E worker count");
  });
});
