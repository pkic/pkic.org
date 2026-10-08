import { composeBadgePrintSvg } from "../assets/shared/badge-print-svg";
import { formatBadgeCredential } from "../assets/shared/schemas/badge-credential";
import { sealBadgeCredential } from "../functions/_lib/services/event-participation/badge-print-protection";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import QRCode from "qrcode";
import {
  badgeCredentialMetadataSchema,
  badgeCredentialsResponseSchema,
  badgeIssueResponseSchema,
  badgePrintRequestSchema,
  badgePrintResponseSchema,
  badgePrintingResponseSchema,
} from "../assets/shared/schemas/route-contracts-event-badges";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { hashBadgeCredential } from "../functions/_lib/services/event-participation/badge-hash";
import type { DatabaseLike, Env } from "../functions/_lib/types";

const fixture = createEventScannerFixture();
const base = "/api/v1/events/scan-test/badges";
async function badge() {
  const row = await env.DB.prepare("SELECT id FROM event_badge_credentials WHERE event_id=? AND credential_hash=?")
    .bind(fixture.eventId, await hashBadgeCredential(fixture.badgeId))
    .first<{ id: string }>();
  if (!row) throw new Error("Missing issued fixture badge");
  return row.id;
}
function request(path: string, init: RequestInit = {}, overrides: Partial<Env> = {}, token = fixture.token) {
  return callApi({ ...env, ...overrides }, path, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
  });
}
async function print(
  id: string,
  operationId = crypto.randomUUID(),
  overrides: Partial<Env> = {},
  token = fixture.token,
) {
  const contextResponse = await request(`${base}/printing`, {}, overrides);
  if (!contextResponse.ok) return contextResponse;
  const context = badgePrintingResponseSchema.parse(await contextResponse.json());
  return request(
    `${base}/${id}/print`,
    {
      method: "POST",
      body: JSON.stringify(badgePrintRequestSchema.parse({ operationId, printingRevision: context.revision })),
    },
    overrides,
    token,
  );
}
async function state() {
  return Promise.all(
    [
      "event_badge_credentials",
      "registrations",
      "agenda_session_participations",
      "event_session_admissions",
      "event_attendance_observations",
      "event_evidence_retention_state",
      "event_contact_retention_state",
      "users",
    ].map(async (table) => (await env.DB.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results),
  );
}
async function audits() {
  return (
    await env.DB.prepare(
      "SELECT id,actor_id,action,entity_id,details_json,idempotency_key FROM audit_log ORDER BY id",
    ).all()
  ).results;
}
function race(mutation: () => Promise<unknown>): DatabaseLike {
  let armed = false;
  const raced = mutateBeforeNextBatch(env.DB, mutation);
  return {
    prepare(sql) {
      // Target only the print command, never an earlier permission/read batch.
      if (sql.includes("badge.print_credential_json=?")) armed = true;
      return env.DB.prepare(sql);
    },
    batch: (statements) => (armed ? raced : env.DB).batch(statements),
  };
}
describe("Authenticated recovery of the same active badge print", () => {
  beforeEach(async () => {
    await fixture.setup();
    await env.DB.prepare("UPDATE users SET first_name='Ada',last_name='Lovelace' WHERE id=?")
      .bind(fixture.userId)
      .run();
  });
  it("recovers the exact original QR after metadata reload, without rotating or storing a plaintext credential", async () => {
    const id = await badge(),
      before = await state(),
      operationId = crypto.randomUUID();
    const metadata = badgeCredentialMetadataSchema.parse(await (await request(`${base}/${id}`)).json());
    expect(metadata.reprintAvailable).toBe(true);
    expect(JSON.stringify(metadata)).not.toContain(fixture.badgeId);
    const response = await print(id, operationId);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const artifact = badgePrintResponseSchema.parse(await response.json());
    expect(artifact.id).toBe(id);
    expect(artifact.displayName).toBe("Ada Lovelace");
    expect(artifact.svg).toBe(
      composeBadgePrintSvg(
        await QRCode.toString(fixture.badgeId, {
          type: "svg",
          errorCorrectionLevel: "M",
          margin: 4,
        }),
        fixture.badgeId,
      ),
    );
    expect(artifact.svg).toContain(formatBadgeCredential(fixture.badgeId));
    expect(Object.keys(artifact)).not.toContain("credential");
    expect(await state()).toEqual(before);
    const replay = await print(id, operationId);
    expect(replay.status).toBe(200);
    expect(badgePrintResponseSchema.parse(await replay.json())).toEqual(artifact);
    const printAudits = (await audits()).filter((row) => row.action === "badge_print_prepared");
    expect(printAudits).toHaveLength(1);
    expect(JSON.stringify(printAudits)).not.toContain(fixture.badgeId);
    expect(JSON.stringify(printAudits)).not.toContain("sealed");
    const stored = await env.DB.prepare("SELECT print_credential_json FROM event_badge_credentials WHERE id=?")
      .bind(id)
      .first<{ print_credential_json: string }>();
    expect(stored?.print_credential_json).not.toContain(fixture.badgeId);
    const inventory = badgeCredentialsResponseSchema.parse(await (await request(base)).json());
    expect(JSON.stringify(inventory)).not.toContain(fixture.badgeId);
    const scan = await fixture.scan(fixture.scanBody({ action: "attendance", occurrenceId: null }));
    expect(scan.status).toBe(200);
    expect(await scan.json()).toMatchObject({
      outcome: "eligible",
      attendanceRecorded: true,
    });
  });
  it("refuses an unsupported sealed credential instead of printing another format", async () => {
    const id = crypto.randomUUID(),
      credential = "abcdefab-cdef-4abc-8abc-abcdefabcdef";
    const credentialHash = await hashBadgeCredential(credential);
    const envelope = await sealBadgeCredential(
      env,
      { eventId: fixture.eventId, id, userId: fixture.userId, credentialHash },
      credential,
    );
    await env.DB.prepare(
      "INSERT INTO event_badge_credentials(id,event_id,user_id,credential_hash,created_at,expires_at,print_credential_json) VALUES(?,?,?,?,?,?,?)",
    )
      .bind(
        id,
        fixture.eventId,
        fixture.userId,
        credentialHash,
        new Date().toISOString(),
        "2099-01-01T00:00:00.000Z",
        envelope,
      )
      .run();
    const before = await state(),
      beforeAudits = await audits(),
      response = await print(id);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "BADGE_PRINT_UNAVAILABLE" } });
    expect(await state()).toEqual(before);
    expect(await audits()).toEqual(beforeAudits);
  });
  it("keeps issuance retries metadata-only while explicit print remains available", async () => {
    const body = { userId: fixture.userId, operationId: crypto.randomUUID() };
    const issue = () => request(base, { method: "POST", body: JSON.stringify(body) });
    const fresh = badgeIssueResponseSchema.parse(await (await issue()).json());
    expect(fresh.result).toBe("issued");
    const before = await state();
    expect(badgeIssueResponseSchema.parse(await (await issue()).json())).toMatchObject({
      result: "replayed",
      credential: null,
      id: fresh.id,
    });
    expect((await print(fresh.id)).status).toBe(200);
    expect(await state()).toEqual(before);
  });
  it("requires real event-management authority and exact event-owned credential IDs", async () => {
    const id = await badge(),
      token = await createAdminSession(env.DB, fixture.userId, crypto.randomUUID());
    const before = await state(),
      log = await audits();
    expect((await print(id, crypto.randomUUID(), {}, token)).status).toBe(403);
    const anonymous = await callApi(env, `${base}/${id}/print`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        badgePrintRequestSchema.parse({
          operationId: crypto.randomUUID(),
          printingRevision: badgePrintingResponseSchema.parse(await (await request(`${base}/printing`)).json())
            .revision,
        }),
      ),
    });
    expect(anonymous.status).toBe(401);
    expect((await print(crypto.randomUUID())).status).toBe(404);
    const now = new Date().toISOString(),
      other = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at) VALUES(?,'other-print','Other','UTC','{}',?,?)",
    )
      .bind(other, now, now)
      .run();
    expect(
      (
        await request(`/api/v1/events/other-print/badges/${id}/print`, {
          method: "POST",
          body: JSON.stringify(
            badgePrintRequestSchema.parse({
              operationId: crypto.randomUUID(),
              printingRevision: badgePrintingResponseSchema.parse(
                await (await request("/api/v1/events/other-print/badges/printing")).json(),
              ).revision,
            }),
          ),
        })
      ).status,
    ).toBe(404);
    expect(await state()).toEqual(before);
    expect(await audits()).toEqual(log);
  });
  it.each(["missing_envelope", "revoked", "expired"] as const)(
    "refuses %s credentials without replacement or print audit",
    async (kind) => {
      const id = await badge();
      if (kind === "missing_envelope")
        await env.DB.prepare("UPDATE event_badge_credentials SET print_credential_json=NULL WHERE id=?").bind(id).run();
      if (kind === "revoked")
        await env.DB.prepare("UPDATE event_badge_credentials SET revoked_at=? WHERE id=?")
          .bind(new Date().toISOString(), id)
          .run();
      if (kind === "expired")
        await env.DB.prepare("UPDATE event_badge_credentials SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?")
          .bind(id)
          .run();
      const before = await state(),
        log = await audits();
      expect(badgeCredentialMetadataSchema.parse(await (await request(`${base}/${id}`)).json()).reprintAvailable).toBe(
        false,
      );
      expect((await print(id)).status).toBe(409);
      expect(await state()).toEqual(before);
      expect(await audits()).toEqual(log);
    },
  );
  it("retains recovery with an old decryption key when the active issuance key changes", async () => {
    const id = await badge();
    const previous: { activeKeyId: string; keys: Record<string, string> } = JSON.parse(
      env.BADGE_PRINT_ENCRYPTION_KEYS!,
    );
    const response = await print(id, crypto.randomUUID(), {
      BADGE_PRINT_ENCRYPTION_KEYS: JSON.stringify({
        activeKeyId: "synthetic-next",
        keys: {
          ...previous.keys,
          "synthetic-next": "synthetic-next-test-key-at-least-32-characters",
        },
      }),
    });
    expect(response.status).toBe(200);
  });
  it.each(["missing", "wrong-key", "tampered", "owner"] as const)(
    "refuses %s recovery without exposing crypto errors or committing effects",
    async (kind) => {
      const id = await badge();
      const overrides: Partial<Env> = {};
      if (kind === "missing") overrides.BADGE_PRINT_ENCRYPTION_KEYS = undefined;
      if (kind === "wrong-key") {
        const previous: { activeKeyId: string } = JSON.parse(env.BADGE_PRINT_ENCRYPTION_KEYS!);
        overrides.BADGE_PRINT_ENCRYPTION_KEYS = JSON.stringify({
          activeKeyId: previous.activeKeyId,
          keys: {
            [previous.activeKeyId]: "synthetic-wrong-test-key-at-least-32-characters",
          },
        });
      }
      if (kind === "tampered")
        await env.DB.prepare("UPDATE event_badge_credentials SET print_credential_json='{}' WHERE id=?").bind(id).run();
      if (kind === "owner")
        await env.DB.prepare("UPDATE event_badge_credentials SET user_id=? WHERE id=?")
          .bind(fixture.operatorId, id)
          .run();
      const before = await state(),
        log = await audits();
      const response = await print(id, crypto.randomUUID(), overrides);
      // A mismatched owner has no event registration, so the metadata boundary refuses it before recovery.
      expect(response.status).toBe(kind === "owner" ? 404 : 503);
      expect(await response.text()).not.toContain(fixture.badgeId);
      expect(await state()).toEqual(before);
      expect(await audits()).toEqual(log);
    },
  );
  it("fails new issuance before any writes if no encryption key is configured", async () => {
    const before = await state(),
      log = await audits();
    const response = await request(
      base,
      {
        method: "POST",
        body: JSON.stringify({
          userId: fixture.userId,
          operationId: crypto.randomUUID(),
        }),
      },
      { BADGE_PRINT_ENCRYPTION_KEYS: undefined },
    );
    expect(response.status).toBe(503);
    expect(await state()).toEqual(before);
    expect(await audits()).toEqual(log);
  });
  it("refuses a forbidden owner merge without changing the original printable badge", async () => {
    const id = await badge(),
      operationId = crypto.randomUUID();
    const first = await print(id, operationId);
    expect(first.status).toBe(200);
    const artifact = badgePrintResponseSchema.parse(await first.json());
    const before = await state(),
      log = await audits();
    await expect(
      env.DB.prepare("UPDATE users SET merged_into_user_id=? WHERE id=?")
        .bind(fixture.operatorId, fixture.userId)
        .run(),
    ).rejects.toThrow("USER_IDENTITY_MERGE_DISABLED");
    expect(await state()).toEqual(before);
    expect(await audits()).toEqual(log);
    const replay = await print(id, operationId);
    expect(replay.status).toBe(200);
    expect(badgePrintResponseSchema.parse(await replay.json())).toEqual(artifact);
    expect(await state()).toEqual(before);
    expect(await audits()).toEqual(log);
  });
  it.each(["session", "permission", "revocation", "expiry", "registration", "purge", "redaction", "contact"] as const)(
    "does not disclose the print after a final-batch %s race, including retries",
    async (kind) => {
      const id = await badge(),
        operationId = crypto.randomUUID();
      expect((await print(id, operationId)).status).toBe(200);
      let before = await state(),
        log = await audits();
      const db = race(async () => {
        if (kind === "session")
          await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?")
            .bind(new Date().toISOString(), fixture.operatorId)
            .run();
        if (kind === "permission")
          await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=? AND role_id='role-admin'")
            .bind(new Date().toISOString(), fixture.operatorId)
            .run();
        if (kind === "revocation")
          await env.DB.prepare("UPDATE event_badge_credentials SET revoked_at=? WHERE id=?")
            .bind(new Date().toISOString(), id)
            .run();
        if (kind === "expiry")
          await env.DB.prepare("UPDATE event_badge_credentials SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?")
            .bind(id)
            .run();
        if (kind === "registration")
          await env.DB.prepare("DELETE FROM registrations WHERE event_id=? AND user_id=?")
            .bind(fixture.eventId, fixture.userId)
            .run();
        if (kind === "purge")
          await env.DB.prepare("UPDATE event_evidence_retention_state SET capture_closed_at=? WHERE event_id=?")
            .bind(new Date().toISOString(), fixture.eventId)
            .run();
        if (kind === "redaction")
          await env.DB.prepare("UPDATE users SET pii_redacted_at=? WHERE id=?")
            .bind(new Date().toISOString(), fixture.userId)
            .run();
        if (kind === "contact") {
          const now = new Date().toISOString();
          await env.DB.prepare(
            "INSERT INTO event_contact_retention_state(event_id,closed_at,deadline_at) VALUES(?,?,?)",
          )
            .bind(fixture.eventId, now, now)
            .run();
        }
        before = await state();
        log = await audits();
      });
      const response = await print(id, operationId, { DB: db });
      expect(response.status, await response.clone().text()).toBe(403);
      expect(await state()).toEqual(before);
      expect(await audits()).toEqual(log);
    },
  );
});
