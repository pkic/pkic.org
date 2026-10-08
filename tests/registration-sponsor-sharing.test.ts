import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  registrationManageSchema,
  registrationManageReadResponseSchema,
  registrationManageUpdateResponseSchema,
} from "../assets/shared/schemas/registration";
import { eventRegistrationManagementUpdateSchema } from "../assets/shared/schemas/route-contracts-event-registration-management";
import { eventRegistrationsQuerySchema } from "../assets/shared/schemas/event-registrations";
import { sponsorAttendeesListQuerySchema } from "../assets/shared/schemas/sponsor-access";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import { getRegistrationByManageToken } from "../functions/_lib/services/registrations/queries";
import { withdrawRegistrationSponsorSharing } from "../functions/_lib/services/registrations/sponsor-sharing";
import { listEventRegistrations } from "../functions/_lib/services/registrations/event-registrations";
import { buildRegistrationCsv } from "../functions/_lib/services/registrations/export";
import { getEventById } from "../functions/_lib/services/events";
import { toEventFormResolutionEvent } from "../functions/_lib/services/forms";
import {
  listSponsorAttendeesForExport,
  listSponsorAttendeesPage,
} from "../functions/_lib/services/sponsorship/sponsor-access";
import { prepareEventAnalyticsStatements } from "../functions/_lib/services/events/analytics-queries";
import { signAdminManageJwt } from "../functions/_lib/utils/jwt";
import { sha256Hex } from "../functions/_lib/utils/crypto";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { mutateAfterNextStatement, mutateBeforeNextBatch } from "./helpers/database-races";
import { insertUser, insertIndividualMember } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);

async function fixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const userId = await insertUser(env.DB, "sharing@synthetic.example");
  const registrationId = crypto.randomUUID();
  const at = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET first_name='Sharing',last_name='Attendee',email_verified_at=? WHERE id=?`).bind(
      at,
      userId,
    ),
    env.DB.prepare(
      `INSERT INTO registrations
      (id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,confirmed_at,created_at,updated_at)
      VALUES(?,?,?,'registered','in_person','test',?,?,?,?)`,
    ).bind(registrationId, eventId, userId, crypto.randomUUID(), at, at, at),
    env.DB.prepare(
      `INSERT INTO event_terms(id,event_id,audience_type,term_key,version,required,active,created_at)
      VALUES(?,?,'attendee','sponsor-data-sharing','v1',0,1,?)`,
    ).bind(crypto.randomUUID(), eventId, at),
  ]);
  for (const [termKey, version] of [
    ["sponsor-data-sharing", "v1"],
    ["sponsor-data-sharing", "v0"],
    ["privacy-policy", "v1"],
  ]) {
    await env.DB.prepare(
      `INSERT INTO consent_acceptances
      (id,registration_id,event_id,user_id,audience_type,term_key,term_version,accepted_at,ip_hash,user_agent_hash)
      VALUES(?,?,?,?,'attendee',?,?,?,?,?)`,
    )
      .bind(crypto.randomUUID(), registrationId, eventId, userId, termKey, version, at, "1".repeat(64), "2".repeat(64))
      .run();
  }
  const token = await issueDatabaseCapability({
    db: env.DB,
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
    purpose: "registration_manage",
    resourceId: registrationId,
  });
  const path = `/api/v1/registrations/access/${encodeURIComponent(token)}`;
  return { eventId, userId, registrationId, token, path };
}

async function withdraw(path: string, session?: string, cookieSession?: string) {
  return callApi(env, path, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(session ? { authorization: `Bearer ${session}` } : {}),
      ...(cookieSession ? { cookie: `pkic_session=${encodeURIComponent(cookieSession)}` } : {}),
    },
    body: JSON.stringify(registrationManageSchema.parse({ action: "withdraw_sponsor_sharing" })),
  });
}
async function read(path: string) {
  const response = await callApi(env, path);
  expect(response.status, await response.clone().text()).toBe(200);
  return registrationManageReadResponseSchema.parse(await response.json());
}
async function registrationRow(id: string) {
  return env.DB.prepare("SELECT * FROM registrations WHERE id=?").bind(id).first();
}
async function acceptanceRows(id: string) {
  return (
    await env.DB.prepare("SELECT * FROM consent_acceptances WHERE registration_id=? ORDER BY term_key,term_version")
      .bind(id)
      .all<Record<string, unknown>>()
  ).results;
}
async function auditCount(id: string) {
  return env.DB.prepare(
    "SELECT COUNT(*) AS count FROM audit_log WHERE entity_id=? AND action='sponsor_sharing_withdrawn'",
  )
    .bind(id)
    .first<number>("count");
}

describe("attendee sponsor sharing withdrawal", () => {
  it("withdraws all sponsor versions once, preserves every acceptance and registration field, and returns canonical state", async () => {
    const f = await fixture();
    const before = await acceptanceRows(f.registrationId);
    const registration = await registrationRow(f.registrationId);
    const outbox = await env.DB.prepare("SELECT COUNT(*) AS count FROM email_outbox").first<number>("count");
    expect((await read(f.path)).sponsorSharing).toEqual({ allowed: true, withdrawnAt: null });
    const response = await withdraw(f.path);
    expect(response.status, await response.clone().text()).toBe(200);
    const receipt = registrationManageUpdateResponseSchema.parse(await response.json());
    expect(receipt.emailChanged).toBe(false);
    expect(receipt.sponsorSharing.allowed).toBe(false);
    expect(receipt.sponsorSharing.withdrawnAt).not.toBeNull();
    const after = await acceptanceRows(f.registrationId);
    expect(after).toHaveLength(before.length);
    after.forEach((row, index) => {
      expect({ ...row, withdrawn_at: null }).toEqual(before[index]);
      expect(row.withdrawn_at).toBe(
        row.term_key === "sponsor-data-sharing" ? receipt.sponsorSharing.withdrawnAt : null,
      );
    });
    expect(await registrationRow(f.registrationId)).toEqual(registration);
    expect(await auditCount(f.registrationId)).toBe(1);
    const retry = await withdraw(f.path);
    expect(retry.status).toBe(200);
    expect(registrationManageUpdateResponseSchema.parse(await retry.json())).toEqual(receipt);
    expect((await read(f.path)).sponsorSharing).toEqual(receipt.sponsorSharing);
    expect(await acceptanceRows(f.registrationId)).toEqual(after);
    expect(await registrationRow(f.registrationId)).toEqual(registration);
    expect(await auditCount(f.registrationId)).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM email_outbox").first<number>("count")).toBe(outbox);
  });

  it("uses the same live consent for legacy sponsor contact lists/CSV and registration filters/CSV/stats", async () => {
    const f = await fixture();
    const query = sponsorAttendeesListQuerySchema.parse({});
    expect((await listSponsorAttendeesPage(env.DB, f.eventId, query)).total).toBe(1);
    expect(await listSponsorAttendeesForExport(env.DB, f.eventId, 10)).toHaveLength(1);
    expect((await withdraw(f.path)).status).toBe(200);
    expect((await listSponsorAttendeesPage(env.DB, f.eventId, query)).attendees).toEqual([]);
    expect(await listSponsorAttendeesForExport(env.DB, f.eventId, 10)).toEqual([]);
    const permitted = await listEventRegistrations(
      env.DB,
      f.eventId,
      eventRegistrationsQuerySchema.parse({ consent: "true" }),
    );
    expect(permitted.total).toBe(0);
    const withdrawn = await listEventRegistrations(
      env.DB,
      f.eventId,
      eventRegistrationsQuerySchema.parse({ consent: "false" }),
    );
    expect(withdrawn.total).toBe(1);
    expect(withdrawn.registrations[0]?.sponsor_consent).toBe(false);
    expect(withdrawn.stats.consentCount).toBe(0);
    const storedEvent = await getEventById(env.DB, f.eventId);
    const event = toEventFormResolutionEvent({ id: storedEvent.id, source_mode: storedEvent.source_mode });
    const csv = await buildRegistrationCsv(env.DB, event, { maxRows: 10, maxBytes: 100000 });
    expect(csv.recordCount).toBe(1);
    expect(csv.csv).toMatch(/,No(?:\r?\n)?$/);
    const statistics = await env.DB.batch(prepareEventAnalyticsStatements(env.DB, f.eventId, false));
    expect(statistics[5]?.results).toEqual([{ count: 0 }]);
    await env.DB.prepare("UPDATE event_terms SET version='v0' WHERE event_id=? AND term_key='sponsor-data-sharing'")
      .bind(f.eventId)
      .run();
    expect((await read(f.path)).sponsorSharing.allowed).toBe(false);
    expect(await listSponsorAttendeesForExport(env.DB, f.eventId, 10)).toEqual([]);
  });

  it("refuses another user's authenticated registration and a revoked capability without consent or audit changes", async () => {
    const f = await fixture();
    const before = await acceptanceRows(f.registrationId);
    const other = await insertIndividualMember(env.DB, "H6", "other@synthetic.example");
    const session = await createMemberSession(env.DB, other.userId, crypto.randomUUID(), undefined, other.identityId);
    expect((await withdraw(`/api/v1/registrations/${f.registrationId}`, session)).status).toBe(404);
    expect((await withdraw(f.path, session)).status).toBe(403);
    expect((await withdraw(f.path, undefined, session)).status).toBe(403);
    expect(await acceptanceRows(f.registrationId)).toEqual(before);
    expect(await auditCount(f.registrationId)).toBe(0);
    await env.DB.prepare("UPDATE registrations SET manage_link_secret=? WHERE id=?")
      .bind(crypto.randomUUID(), f.registrationId)
      .run();
    expect((await withdraw(f.path)).status).toBe(404);
    expect(await acceptanceRows(f.registrationId)).toEqual(before);
    expect(await auditCount(f.registrationId)).toBe(0);
  });

  it("allows only the owner's live session and refuses delegated administration and mixed actions", async () => {
    const f = await fixture();
    const fingerprint = await sha256Hex("");
    const delegated = await signAdminManageJwt(env.INTERNAL_SIGNING_SECRET!, {
      sub: f.registrationId,
      actor: "api-key",
      event: "pqc-2026",
      iphash: fingerprint,
      uahash: fingerprint,
      ttlSeconds: 3600,
    });
    const delegatedPath = `/api/v1/registrations/access/${encodeURIComponent(delegated)}`;
    expect((await read(delegatedPath)).sponsorSharing.allowed).toBe(true);
    expect((await withdraw(delegatedPath)).status).toBe(403);
    expect(
      registrationManageSchema.safeParse({ action: "withdraw_sponsor_sharing", attendanceType: "virtual" }).success,
    ).toBe(false);
    expect(eventRegistrationManagementUpdateSchema.safeParse({ action: "withdraw_sponsor_sharing" }).success).toBe(
      false,
    );
    expect(await auditCount(f.registrationId)).toBe(0);
    const session = await createMemberSession(env.DB, f.userId, crypto.randomUUID(), undefined, null);
    const response = await withdraw(`/api/v1/registrations/${f.registrationId}`, session);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(registrationManageUpdateResponseSchema.parse(await response.json()).sponsorSharing.allowed).toBe(false);
  });

  it("refuses rotation between capability verification and the selected row read", async () => {
    const f = await fixture();
    const expected = await getRegistrationByManageToken(env.DB, f.token, env.INTERNAL_SIGNING_SECRET!);
    const before = await acceptanceRows(f.registrationId);
    const raced = mutateAfterNextStatement(env.DB, () =>
      env.DB.prepare("UPDATE registrations SET manage_link_secret=? WHERE id=?")
        .bind(crypto.randomUUID(), f.registrationId)
        .run(),
    );
    await expect(
      withdrawRegistrationSponsorSharing(raced, f.token, env.INTERNAL_SIGNING_SECRET!, expected),
    ).rejects.toMatchObject({ status: 403, code: "REGISTRATION_CONSENT_AUTHORITY_REQUIRED" });
    expect(await acceptanceRows(f.registrationId)).toEqual(before);
    expect(await auditCount(f.registrationId)).toBe(0);
  });

  it.each(["capability", "session", "registration"] as const)(
    "rolls back when %s authority changes in the final batch",
    async (kind) => {
      const f = await fixture();
      const expected = await getRegistrationByManageToken(env.DB, f.token, env.INTERNAL_SIGNING_SECRET!);
      const before = await acceptanceRows(f.registrationId);
      const sessionId = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)")
        .bind(
          sessionId,
          f.userId,
          "session-hash",
          new Date(Date.now() + 3600000).toISOString(),
          new Date().toISOString(),
        )
        .run();
      const raced = mutateBeforeNextBatch(env.DB, () => {
        if (kind === "session")
          return env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE id=?")
            .bind(new Date().toISOString(), sessionId)
            .run();
        if (kind === "registration")
          return env.DB.prepare("UPDATE registrations SET transition_revision=transition_revision+1 WHERE id=?")
            .bind(f.registrationId)
            .run();
        return env.DB.prepare("UPDATE registrations SET manage_link_secret=? WHERE id=?")
          .bind(crypto.randomUUID(), f.registrationId)
          .run();
      });
      const authority = kind === "session" ? { resourceId: f.registrationId, userId: f.userId, sessionId } : f.token;
      await expect(
        withdrawRegistrationSponsorSharing(raced, authority, env.INTERNAL_SIGNING_SECRET!, expected),
      ).rejects.toMatchObject({ status: 409, code: "REGISTRATION_CONSENT_AUTHORITY_CHANGED" });
      expect(await acceptanceRows(f.registrationId)).toEqual(before);
      expect(await auditCount(f.registrationId)).toBe(0);
    },
  );

  it("rolls back the withdrawal if its audit cannot be written", async () => {
    const f = await fixture();
    const before = await acceptanceRows(f.registrationId);
    await env.DB.prepare(
      "CREATE TRIGGER test_withdrawal_audit BEFORE INSERT ON audit_log WHEN NEW.action='sponsor_sharing_withdrawn' BEGIN SELECT RAISE(ABORT,'TEST_AUDIT_FAILURE'); END",
    ).run();
    try {
      expect((await withdraw(f.path)).status).toBe(500);
      expect(await acceptanceRows(f.registrationId)).toEqual(before);
      expect(await auditCount(f.registrationId)).toBe(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER test_withdrawal_audit").run();
    }
  });

  it("enforces canonical withdrawal time, optional term scope and immutable acceptance evidence in D1", async () => {
    const f = await fixture();
    const invalid = ["2020-01-01T00:00:00.000Z", "2026-10-05 12:00:00", "not-a-time"];
    for (const at of invalid)
      await expect(
        env.DB.prepare(
          "UPDATE consent_acceptances SET withdrawn_at=? WHERE registration_id=? AND term_version='v1' AND term_key='sponsor-data-sharing'",
        )
          .bind(at, f.registrationId)
          .run(),
      ).rejects.toThrow("CONSENT_WITHDRAWAL_INVALID");
    await expect(
      env.DB.prepare(
        "UPDATE consent_acceptances SET withdrawn_at=? WHERE registration_id=? AND term_key='privacy-policy'",
      )
        .bind(new Date().toISOString(), f.registrationId)
        .run(),
    ).rejects.toThrow("CONSENT_WITHDRAWAL_INVALID");
    await expect(
      env.DB.prepare(
        "UPDATE consent_acceptances SET withdrawn_at=?,ip_hash='rewritten' WHERE registration_id=? AND term_key='sponsor-data-sharing'",
      )
        .bind(new Date().toISOString(), f.registrationId)
        .run(),
    ).rejects.toThrow("CONSENT_WITHDRAWAL_EVIDENCE_IMMUTABLE");
    expect((await withdraw(f.path)).status).toBe(200);
    await expect(
      env.DB.prepare(
        "UPDATE consent_acceptances SET withdrawn_at=NULL WHERE registration_id=? AND term_key='sponsor-data-sharing'",
      )
        .bind(f.registrationId)
        .run(),
    ).rejects.toThrow("CONSENT_WITHDRAWAL_INVALID");
  });
});
