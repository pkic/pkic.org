import { describe, it, expect } from "vitest";
import { D1DatabaseShim } from "./helpers/d1-shim";
import { createEnv, createContext, seedEventAndAdmin } from "./helpers/context";
import { createInvite } from "../functions/_lib/services/invites";
import { onRequestGet as declineInfoGet } from "../functions/api/v1/invites/[token]/decline-info";
import {
  onRequestPost as declinePost,
} from "../functions/api/v1/invites/[token]/decline";

describe("invite decline-info", () => {
  it("returns valid status with event name and first name for an active invite", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    const env = createEnv(db);

    const { token } = await createInvite(db, {
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
    const data = await response.json() as { status: string; inviteeFirstName: string | null };
    expect(data.status).toBe("valid");
    expect(data.inviteeFirstName).toBe("Alice");
  });

  it("returns already_processed when the invite was declined", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    const env = createEnv(db);

    const { token } = await createInvite(db, {
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
    const data = await response.json() as { status: string };
    expect(data.status).toBe("already_processed");
  });

  it("returns invalid for an unknown token", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    await seedEventAndAdmin(db);
    const env = createEnv(db);

    const response = await declineInfoGet(
      createContext(
        env,
        new Request("https://app.test/api/v1/invites/notarealtoken12345/decline-info"),
        { token: "notarealtoken12345" },
      ),
    );

    expect(response.status).toBe(200);
    const data = await response.json() as { status: string };
    expect(data.status).toBe("invalid");
  });

  it("stores npsScore when included in POST", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    const env = createEnv(db);

    const { token } = await createInvite(db, {
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

    const row = db.raw<{ nps_score: number }>(
      "SELECT nps_score FROM invites WHERE invitee_email = ?",
      ["nps-test@example.test"],
    )[0];

    expect(row.nps_score).toBe(8);
  });
});
