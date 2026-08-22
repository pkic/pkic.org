import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { buildApplicationDocumentPageStatements } from "../functions/_lib/services/membership/applications/documents";
import { resetDb } from "./helpers/reset-db";

describe("application document D1 query plan", () => {
  beforeEach(resetDb);

  it("uses the application and upload-order index for the default bounded page", async () => {
    const statement = buildApplicationDocumentPageStatements("00000000-0000-4000-8000-000000000001", {
      limit: 25,
      offset: 0,
      sort: "-uploadedAt",
    }).page;
    const result = await env.DB.prepare(`EXPLAIN QUERY PLAN ${statement.sql} ${statement.orderBy ?? ""}`)
      .bind(...(statement.bindings ?? []))
      .all<{ detail: string }>();
    const plan = result.results.map((row) => row.detail).join("\n");

    expect(plan).toContain("idx_application_documents_app");
    expect(plan).not.toContain("USE TEMP B-TREE FOR ORDER BY");
  });
});
