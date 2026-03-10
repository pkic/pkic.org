import { describe, it, expect } from "vitest";
import { onRequestPost as requestLink } from "../functions/api/v1/admin/auth/request-link";
import { onRequestPost as verifyLink } from "../functions/api/v1/admin/auth/verify-link";
import { createContext, createEnv, seedEventAndAdmin } from "./helpers/context";
import { D1DatabaseShim } from "./helpers/d1-shim";

function extractTokenFromMagicLinkPayload(payloadJson: string): string {
  const payload = JSON.parse(payloadJson) as { magicLinkUrl: string };
  const url = new URL(payload.magicLinkUrl);
  return url.searchParams.get("token") as string;
}

describe("admin magic-link auth", () => {
  it("allows allowlisted admin and blocks replay", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    await seedEventAndAdmin(db);
    const env = createEnv(db);

    await requestLink(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/auth/request-link", {
          method: "POST",
          body: JSON.stringify({ email: "admin@pkic.org" }),
          headers: { "content-type": "application/json" },
        }),
        {},
      ),
    );

    const outboxRows = db.raw<{ payload_json: string }>("SELECT payload_json FROM email_outbox");
    expect(outboxRows).toHaveLength(1);

    const token = extractTokenFromMagicLinkPayload(outboxRows[0].payload_json);

    const verifyResponse = await verifyLink(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/auth/verify-link", {
          method: "POST",
          body: JSON.stringify({ token }),
          headers: { "content-type": "application/json" },
        }),
        {},
      ),
    );

    expect(verifyResponse.status).toBe(200);

    await expect(
      verifyLink(
        createContext(
          env,
          new Request("https://app.test/api/v1/admin/auth/verify-link", {
            method: "POST",
            body: JSON.stringify({ token }),
            headers: { "content-type": "application/json" },
          }),
          {},
        ),
      ),
    ).rejects.toMatchObject({ code: "MAGIC_LINK_USED" });
  });

  it("returns success for non-allowlisted email without creating token", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    await seedEventAndAdmin(db);
    const env = createEnv(db);

    const response = await requestLink(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/auth/request-link", {
          method: "POST",
          body: JSON.stringify({ email: "unknown@pkic.org" }),
          headers: { "content-type": "application/json" },
        }),
        {},
      ),
    );

    expect(response.status).toBe(200);

    const rows = db.raw<{ total: number }>("SELECT COUNT(*) AS total FROM auth_magic_links");
    expect(Number(rows[0].total)).toBe(0);
  });
});
