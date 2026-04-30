import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { createContext, seedEventAndAdmin, queryAll } from "./helpers/context";
import { run } from "../functions/_lib/db/queries";
import { createInvite } from "../functions/_lib/services/invites";
import { onRequestGet as declineInfoGet } from "../functions/api/v1/invites/[token]/decline-info";
import { onRequestPost as declinePost } from "../functions/api/v1/invites/[token]/decline";

describe("invite decline-info", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("returns valid status with event name and first name for an active invite", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const { token } = await createInvite(env.DB, {
      eventId,
      inviteeEmail: "info-valid@example.test",
      inviteeFirstName: "Alice",
      inviteType: "attendee",
      ttlHours: 24,
    });

    const response = await declineInfoGet(
      createContext(env, new Request(`https://app.test/api/v1/invites/${token}/decline-info`), { token }),
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { status: string; inviteeFirstName: string | null };
    expect(data.status).toBe("valid");
    expect(data.inviteeFirstName).toBe("Alice");
  });

  it("returns already_processed when the invite was declined", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const { token } = await createInvite(env.DB, {
      eventId,
      inviteeEmail: "info-declined@example.test",
      inviteType: "attendee",
      ttlHours: 24,
    });

    await declinePost(
      createContext(
        env,
        new Request(`https://app.test/api/v1/invites/${token}/decline`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reasonCode: "not_interested" }),
        }),
        { token },
      ),
    );

    const response = await declineInfoGet(
      createContext(env, new Request(`https://app.test/api/v1/invites/${token}/decline-info`), { token }),
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { status: string };
    expect(data.status).toBe("already_processed");
  });

  it("returns invalid for an unknown token", async () => {
    await seedEventAndAdmin(env.DB);

    const response = await declineInfoGet(
      createContext(env, new Request("https://app.test/api/v1/invites/notarealtoken12345/decline-info"), {
        token: "notarealtoken12345",
      }),
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { status: string };
    expect(data.status).toBe("invalid");
  });

  it("keeps decline-info valid even when expires_at is in the past", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const { token, invite } = await createInvite(env.DB, {
      eventId,
      inviteeEmail: "decline-past-expiry@example.test",
      inviteType: "attendee",
      ttlHours: 24,
    });

    await run(env.DB, "UPDATE invites SET expires_at = datetime('now', '-1 day') WHERE id = ?", [invite.id]);

    const response = await declineInfoGet(
      createContext(env, new Request(`https://app.test/api/v1/invites/${token}/decline-info`), { token }),
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { status: string };
    expect(data.status).toBe("valid");
  });

  it("stores npsScore when included in POST", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const { token } = await createInvite(env.DB, {
      eventId,
      inviteeEmail: "nps-test@example.test",
      inviteType: "attendee",
      ttlHours: 24,
    });

    const response = await declinePost(
      createContext(
        env,
        new Request(`https://app.test/api/v1/invites/${token}/decline`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reasonCode: "schedule_conflict",
            npsScore: 8,
          }),
        }),
        { token },
      ),
    );

    expect(response.status).toBe(200);

    const row = (
      await queryAll<{ nps_score: number }>(env.DB, "SELECT nps_score FROM invites WHERE invitee_email = ?", [
        "nps-test@example.test",
      ])
    )[0];

    expect(row.nps_score).toBe(8);
  });
});
