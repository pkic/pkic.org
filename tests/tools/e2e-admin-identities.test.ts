import { readFileSync } from "node:fs";
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

  /*
   * The scope list is declared twice: once as the runtime array and once as
   * the `.d.mts` literal union the specs are type-checked against. A scope
   * added to only one of them fails in a way that names the wrong thing —
   * either TypeScript rejects a scope that works, or a spec compiles and then
   * throws "Unknown E2E admin scope" the moment it runs.
   */
  it("declares the same scopes to TypeScript as it does at runtime", () => {
    const declaration = readFileSync(new URL("../../scripts/e2e-admin-identities.d.mts", import.meta.url), "utf8");
    const declared = [...declaration.matchAll(/^\s*"([a-z0-9-]+)",$/gm)].map((match) => match[1]);
    expect(declared).toEqual([...E2E_ADMIN_SCOPES]);
  });

  it("rejects unknown scopes and invalid worker counts", () => {
    expect(() => formatE2eAdminEmail("unknown" as E2eAdminScope, 0)).toThrow("Unknown E2E admin scope");
    expect(() => e2eAdminEmailsForWorkerCount(0)).toThrow("Invalid E2E worker count");
  });
});
