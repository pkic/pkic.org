import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { createUserBackedAuthAdmin, createServiceAuthAdmin } from "../functions/_lib/auth/admin-identity";
import { preparePermissionsAuthorizationGuard } from "../functions/_lib/auth/permissions";

const fixture = createEventScannerFixture();
describe("Live sessions at permission mutation boundaries", () => {
  beforeEach(fixture.setup);
  async function actor() {
    const session = await env.DB.prepare("SELECT id FROM sessions WHERE user_id=?")
      .bind(fixture.operatorId)
      .first<{ id: string }>();
    return createUserBackedAuthAdmin({
      id: fixture.operatorId,
      email: "operator@example.test",
      sessionId: session!.id,
    });
  }
  const requirements = [{ permission: "agenda:attendance_record", context: { type: "event", id: fixture.eventId } }];
  it.each(["revoked", "expired", "foreign"])(
    "rejects an otherwise authorized actor whose session is %s",
    async (state) => {
      const authenticated = await actor();
      await env.DB.batch([preparePermissionsAuthorizationGuard(env.DB, authenticated, requirements)]);
      if (state === "revoked")
        await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE id=?")
          .bind(new Date().toISOString(), authenticated.sessionId)
          .run();
      if (state === "expired")
        await env.DB.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?")
          .bind(authenticated.sessionId)
          .run();
      if (state === "foreign")
        await env.DB.prepare("UPDATE sessions SET user_id=? WHERE id=?")
          .bind(fixture.userId, authenticated.sessionId)
          .run();
      await expect(
        env.DB.batch([preparePermissionsAuthorizationGuard(env.DB, authenticated, requirements)]),
      ).rejects.toThrow();
    },
  );
  it("preserves explicit sessionless user and service authorization boundaries", async () => {
    const authenticated = await actor();
    const { sessionId: _sessionId, ...trusted } = authenticated;
    await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), fixture.operatorId)
      .run();
    await env.DB.batch([preparePermissionsAuthorizationGuard(env.DB, trusted, requirements)]);
    const service = createServiceAuthAdmin({
      id: "test-service",
      email: "service@example.test",
      role: "admin",
      scopes: ["agenda:attendance_record"],
    });
    await env.DB.batch([preparePermissionsAuthorizationGuard(env.DB, service, requirements)]);
  });
});
