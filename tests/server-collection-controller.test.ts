import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildServerCollectionUrl, createLatestRequestGate } from "../assets/ts/hooks/useServerCollection";
import { paginatedResponseSchema } from "../assets/shared/schemas/pagination";

describe("server collection controller", () => {
  it("builds stable collection URLs and omits empty filters", () => {
    expect(buildServerCollectionUrl("/api/items", { sort: "name", q: "", offset: "20", limit: "20" })).toBe(
      "/api/items?limit=20&offset=20&sort=name",
    );
  });

  it("aborts and invalidates a stale request when a newer request starts", () => {
    const gate = createLatestRequestGate();
    const first = gate.start();
    const second = gate.start();

    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(second.signal.aborted).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  it("rejects malformed page envelopes before a collection can render", () => {
    const schema = paginatedResponseSchema("items", z.object({ id: z.string() }));
    expect(() => schema.parse({ items: [{ id: "one" }], page: { total: 1, hasMore: false } })).toThrow();
    expect(
      schema.parse({
        items: [{ id: "one" }],
        page: { limit: 20, offset: 0, total: 1, hasMore: false },
      }).items,
    ).toEqual([{ id: "one" }]);
  });
});
