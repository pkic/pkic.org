import { describe, expect, it } from "vitest";
import { buildD1JsonMembershipFilter } from "../functions/_lib/db/json-membership";

describe("buildD1JsonMembershipFilter", () => {
  it("uses one binding for a maximum-size canonical page", () => {
    const ids = Array.from({ length: 200 }, (_, index) => `id-${index}`);
    const filter = buildD1JsonMembershipFilter("resource_id", ids);

    expect(filter.sql).toBe("resource_id IN (SELECT value FROM json_each(?))");
    expect(filter.bindings).toHaveLength(1);
    expect(JSON.parse(filter.bindings[0])).toEqual(ids);
  });

  it("returns an always-false predicate for an empty set", () => {
    expect(buildD1JsonMembershipFilter("resource_id", [])).toEqual({ sql: "0 = 1", bindings: [] });
  });

  it("requires a trusted SQL expression", () => {
    expect(() => buildD1JsonMembershipFilter("  ", ["id"])).toThrow("trusted SQL expression");
  });
});
