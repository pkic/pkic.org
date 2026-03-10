import { describe, it, expect } from "vitest";
import { D1DatabaseShim } from "./helpers/d1-shim";
import { createEnv, createContext, seedEventAndAdmin } from "./helpers/context";
import { createInvite } from "../functions/_lib/services/invites";
import {
  onRequestGet as declineGet,
  onRequestPost as declinePost,
} from "../functions/api/v1/invites/[token]/decline";

describe("invite decline", () => {
  it("GET redirects to the Hugo-managed decline page", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    const env = createEnv(db);

    const { token } = await createInvite(db, {
      eventId,
      inviteeEmail: "form-get@example.test",
      inviteType: "attendee",
      ttlHours: 24,
    });

    const response = await declineGet(
      createContext(env, new Request(`https://app.test/api/v1/invites/${token}/decline`), { token }),
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/invite/decline/");
    expect(location).toContain(token);
  });

  it("GET always redirects — invite state is resolved by the decline-info endpoint", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    const env = createEnv(db);

    const { token } = await createInvite(db, {
      eventId,
      inviteeEmail: "already-done@example.test",
      inviteType: "attendee",
      ttlHours: 24,
    });

    // Decline via POST first
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

    const response = await declineGet(
      createContext(env, new Request(`https://app.test/api/v1/invites/${token}/decline`), { token }),
    );

    // GET always redirects; the Hugo page JS calls decline-info to determine state
    expect(response.status).toBe(302);
    expect(response.headers.get("location") ?? "").toContain("/invite/decline/");
  });

  it("requires reasonNote when reasonCode is other", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    const env = createEnv(db);

    const { token } = await createInvite(db, {
      eventId,
      inviteeEmail: "other-no-note@example.test",
      inviteType: "attendee",
      ttlHours: 24,
    });

    await expect(
      declinePost(
        createContext(
          env,
          new Request(`https://app.test/api/v1/invites/${token}/decline`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ reasonCode: "other" }),
          }),
          { token },
        ),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("stores structured reason and unsubscribe choice", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    const env = createEnv(db);

    const { token } = await createInvite(db, {
      eventId,
      inviteeEmail: "reason-store@example.test",
      inviteType: "attendee",
      ttlHours: 24,
    });

    const response = await declinePost(
      createContext(
        env,
        new Request(`https://app.test/api/v1/invites/${token}/decline`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reasonCode: "schedule_conflict", unsubscribeFuture: true }),
        }),
        { token },
      ),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({ success: true, forwarded: [] });

    const invite = db.raw<{ decline_reason_code: string; decline_reason_note: string | null }>(
      "SELECT decline_reason_code, decline_reason_note FROM invites WHERE invitee_email = ?",
      ["reason-store@example.test"],
    )[0];
    expect(invite.decline_reason_code).toBe("schedule_conflict");
    expect(invite.decline_reason_note).toBeNull();

    const unsub = db.raw<{ total: number }>(
      "SELECT COUNT(*) AS total FROM unsubscribes WHERE email = ? AND channel = 'invites'",
      ["reason-store@example.test"],
    )[0];
    expect(Number(unsub.total)).toBe(1);
  });

  it("creates new invites (via createInvite) for forwarded contacts", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    const env = createEnv(db);

    const { token } = await createInvite(db, {
      eventId,
      inviteeEmail: "decliner@example.test",
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
            reasonCode: "travel_not_possible",
            forwards: [
              { email: "colleague1@example.test", firstName: "Alice" },
              { email: "colleague2@example.test" },
            ],
          }),
        }),
        { token },
      ),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.forwarded).toContain("colleague1@example.test");
    expect(data.forwarded).toContain("colleague2@example.test");

    const fwd1 = db.raw<{ source_type: string; invitee_first_name: string }>(
      "SELECT source_type, invitee_first_name FROM invites WHERE invitee_email = ?",
      ["colleague1@example.test"],
    )[0];
    expect(fwd1.source_type).toBe("declined-forward");
    expect(fwd1.invitee_first_name).toBe("Alice");

    const fwd2 = db.raw<{ source_type: string }>(
      "SELECT source_type FROM invites WHERE invitee_email = ?",
      ["colleague2@example.test"],
    )[0];
    expect(fwd2.source_type).toBe("declined-forward");
  });

  it("silently skips unsubscribed contacts when forwarding", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    const env = createEnv(db);

    const unsubId = crypto.randomUUID();
    await db.exec(
      `INSERT INTO unsubscribes (id, email, channel, scope_type, reason, created_at)
       VALUES ('${unsubId}', 'unsub-fwd@example.test', 'invites', 'global', 'manual', datetime('now'))`,
    );

    const { token } = await createInvite(db, {
      eventId,
      inviteeEmail: "decliner-unsub@example.test",
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
            forwards: [{ email: "unsub-fwd@example.test" }],
          }),
        }),
        { token },
      ),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.forwarded).toEqual([]);
  });
});
