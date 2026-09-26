import { describe, expect, it } from "vitest";
import { buildD1TextSearchFilter } from "../functions/_lib/db/search";

describe("buildD1TextSearchFilter", () => {
  it("uses bound contains matching without treating LIKE metacharacters specially", () => {
    const filter = buildD1TextSearchFilter("  50%_off  ", ["u.email", "u.first_name"]);

    expect(filter.sql).toContain("INSTR(");
    expect(filter.sql).not.toContain("LIKE");
    expect(filter.sql).not.toContain("50%_off");
    expect(filter.bindings).toEqual(["50%_off", "50%_off"]);
  });

  it("preserves contains matching for a complete long email address", () => {
    const email = "e2e-duplicate-1787220512185@e2e-users-dup-1787220512185.test";
    const filter = buildD1TextSearchFilter(email, ["u.email", "ue.email"]);

    expect(filter.sql).toContain("INSTR(");
    expect(filter.sql).not.toContain(email);
    expect(filter.bindings).toEqual([email, email]);
  });

  it("requires at least one trusted SQL expression and a non-empty query", () => {
    expect(() => buildD1TextSearchFilter("value", [])).toThrow("At least one");
    expect(() => buildD1TextSearchFilter("  ", ["name"])).toThrow("must not be empty");
  });
});
