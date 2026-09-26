import { describe, expect, it } from "vitest";
import { resolveMappedOrderBy, resolveOrderBy } from "../functions/_lib/db/sort";

describe("shared SQL sort builders", () => {
  it("adds a deterministic tie-breaker to default and requested ordering", () => {
    expect(resolveOrderBy(undefined, ["name", "created_at"], "ORDER BY created_at DESC", "id ASC")).toBe(
      "ORDER BY created_at DESC, id ASC",
    );
    expect(resolveOrderBy("-name", ["name", "created_at"], "ORDER BY created_at DESC", "id ASC")).toBe(
      "ORDER BY name DESC, id ASC",
    );
  });

  it("never interpolates an unallowlisted request value", () => {
    expect(resolveOrderBy("name; DROP TABLE users", ["name"], "ORDER BY name ASC", "id ASC")).toBe(
      "ORDER BY name ASC, id ASC",
    );
  });

  it("does not duplicate a tie-breaker already present in the fallback", () => {
    expect(resolveOrderBy(undefined, ["template_key"], "ORDER BY template_key ASC", "template_key ASC")).toBe(
      "ORDER BY template_key ASC",
    );
  });

  it("maps public sort keys to trusted SQL expressions with the same stable ordering", () => {
    expect(
      resolveMappedOrderBy("-createdAt", { createdAt: "record.created_at" }, "record.created_at DESC", "record.id ASC"),
    ).toBe("ORDER BY record.created_at DESC, record.id ASC");
  });
});
