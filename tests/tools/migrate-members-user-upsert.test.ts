import { describe, expect, it, vi } from "vitest";
import { upsertMemberUser } from "../../scripts/migrate-members/user-upsert.mjs";

describe("upsertMemberUser", () => {
  it("normalizes links through the common codec and tracks the claimed email", () => {
    const upsertUser = vi.fn(() => "ada@example.test");
    const claimedEmails = new Set<string>();
    const invalidLinks: Array<{ file: string; name: string; url: string }> = [];
    const ctx = { upsertUser, claimedEmails, report: { invalidLinks } };

    const normalizedEmail = upsertMemberUser(ctx, {
      email: "Ada@Example.test",
      firstName: "Ada",
      lastName: "Lovelace",
      jobTitle: "Engineer",
      biography: null,
      links: ["https://example.test/ada", "ttps://invalid"],
      headshotR2Key: null,
      sourceFile: "ada.yaml",
      sourceName: "Ada Lovelace",
    });

    expect(normalizedEmail).toBe("ada@example.test");
    expect(claimedEmails).toEqual(new Set(["ada@example.test"]));
    expect(upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({ linksJson: JSON.stringify(["https://example.test/ada"]) }),
    );
    expect(invalidLinks).toEqual([{ file: "ada.yaml", name: "Ada Lovelace", url: "ttps://invalid" }]);
  });
});
