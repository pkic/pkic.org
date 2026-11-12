import type { DatabaseLike } from "../functions/_lib/types";
import { eventBadgePrintPopulationResponseSchema } from "../assets/shared/schemas/event-badge-printing";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  registrationManageSchema,
  registrationManageReadResponseSchema,
  registrationManageUpdateResponseSchema,
} from "../assets/shared/schemas/registration";
import { eventRegistrationManagementUpdateSchema } from "../assets/shared/schemas/route-contracts-event-registration-management";
import {
  eventAttendanceRegistrationsListResponseSchema,
  eventRegistrationsQuerySchema,
} from "../assets/shared/schemas/event-registrations";
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
import { createGroup } from "../functions/_lib/services/groups";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { seedEventAndAdmin } from "./helpers/context";
import { mutateAfterNextStatement, mutateBeforeNextBatch, mutateBeforeMatchingQuery } from "./helpers/database-races";
import {
  addRepresentative,
  insertOrganization,
  seedOrganizationAggregate,
  insertUser,
  insertIndividualMember,
} from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);

async function fixture() {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
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
      (id,event_id,user_id,status,source_type,manage_link_secret,confirmed_at,created_at,updated_at)
      VALUES(?,?,?,'registered','test',?,?,?,?)`,
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
  return { eventId, userId, registrationId, token, path, admin };
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

async function managedRoster(f: Awaited<ReturnType<typeof fixture>>) {
  const group = await createGroup(env.DB, f.admin, {
    typeKey: "working_group",
    name: "Output tests",
    visibility: "authenticated",
    eligibilityMode: "open",
  });
  await env.DB.prepare("UPDATE events SET owner_group_id=? WHERE id=?").bind(group.id, f.eventId).run();
  const token = await createAdminSession(env.DB, f.admin.id, crypto.randomUUID());
  return (suffix: string, authorized = true, db: DatabaseLike = env.DB) =>
    callApi(
      { ...env, DB: db as typeof env.DB },
      `/api/v1/groups/${group.id}/events/${f.eventId}/registrations${suffix}`,
      {
        headers: authorized ? { authorization: `Bearer ${token}` } : {},
      },
    );
}

it.each(["registered", "pending_email_confirmation", "cancelled"])(
  "exports selected %s attendees with current sponsor consent and excludes them after withdrawal",
  async (status) => {
    const f = await fixture();
    const get = await managedRoster(f);
    await env.DB.prepare("UPDATE registrations SET status=? WHERE id=?").bind(status, f.registrationId).run();
    const url = `/exports?audience=sponsor&ids=${f.registrationId}`;
    const permitted = await get(url);
    expect(permitted.status).toBe(200);
    expect(await permitted.text()).toContain("sharing@synthetic.example");
    expect((await withdraw(f.path)).status).toBe(200);
    const withdrawn = await get(url);
    expect(withdrawn.status).toBe(200);
    expect(await withdrawn.text()).not.toContain("sharing@synthetic.example");
  },
);

it.each(["missing", "withdrawn", "outdated", "another_attendee", "inactive_term"])(
  "sponsor CSV excludes %s consent even for explicit selection",
  async (caseName) => {
    const f = await fixture(),
      get = await managedRoster(f);
    const url = `/exports?audience=sponsor&ids=${f.registrationId}`;
    const permitted = await get(url);
    expect(permitted.status).toBe(200);
    expect(await permitted.text()).toContain("sharing@synthetic.example");
    if (caseName === "missing")
      await env.DB.prepare(
        "DELETE FROM consent_acceptances WHERE registration_id=? AND term_key='sponsor-data-sharing'",
      )
        .bind(f.registrationId)
        .run();
    if (caseName === "withdrawn") expect((await withdraw(f.path)).status).toBe(200);
    if (caseName === "outdated")
      await env.DB.prepare("UPDATE event_terms SET version='v2' WHERE event_id=? AND term_key='sponsor-data-sharing'")
        .bind(f.eventId)
        .run();
    if (caseName === "another_attendee") {
      const user = await insertUser(env.DB),
        registration = crypto.randomUUID(),
        now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(
          "DELETE FROM consent_acceptances WHERE registration_id=? AND term_key='sponsor-data-sharing'",
        ).bind(f.registrationId),
        env.DB.prepare(
          "INSERT INTO registrations(id,event_id,user_id,status,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','test',?,?,?)",
        ).bind(registration, f.eventId, user, crypto.randomUUID(), now, now),
        env.DB.prepare(
          "INSERT INTO consent_acceptances(id,registration_id,event_id,user_id,audience_type,term_key,term_version,accepted_at,ip_hash,user_agent_hash) VALUES(?,?,?,?,'attendee','sponsor-data-sharing','v1',?,?,?)",
        ).bind(crypto.randomUUID(), registration, f.eventId, user, now, "1".repeat(64), "2".repeat(64)),
      ]);
    }
    if (caseName === "inactive_term")
      await env.DB.prepare("UPDATE event_terms SET active=0 WHERE event_id=? AND term_key='sponsor-data-sharing'")
        .bind(f.eventId)
        .run();
    const response = await get(url);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("sharing@synthetic.example");
    expect((await get(url, false)).status).toBe(401);
    const list = eventAttendanceRegistrationsListResponseSchema.parse(await (await get("?consent=false")).json());
    expect(list.registrations.map((row) => row.id)).toContain(f.registrationId);
    expect(list.registrations[0].sponsor_consent).toBe(false);
    const population = eventBadgePrintPopulationResponseSchema.parse(
      await (await get("/badges/population?consent=true")).json(),
    );
    expect(population.registrations.map((row) => row.id)).not.toContain(f.registrationId);
  },
);

it("keeps job title, typed country and attendee role filters identical for roster, print population and exports", async () => {
  const f = await fixture(),
    get = await managedRoster(f);
  const organization = await insertOrganization(env.DB, "Synthetic Security");
  const member = await seedOrganizationAggregate(env.DB, organization);
  const identityId = await addRepresentative(env.DB, member, f.userId, { jobTitle: "Security Architect" });
  const formId = crypto.randomUUID(),
    fieldId = crypto.randomUUID(),
    submissionId = crypto.randomUUID(),
    now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE identities SET job_title='Security Architect' WHERE id=?").bind(identityId),
    env.DB.prepare("UPDATE registrations SET registration_identity_id=? WHERE id=?").bind(identityId, f.registrationId),
    env.DB.prepare(
      "INSERT INTO registration_badge_role_overrides(registration_id,role,set_by_user_id,created_at,updated_at) VALUES(?,'staff',?,?,?)",
    ).bind(f.registrationId, f.admin.id, now, now),
    env.DB.prepare(
      "INSERT INTO forms(id,key,scope_type,scope_ref,purpose,status,title,created_at,updated_at) VALUES(?,?,'event',?,'event_registration','active','Country test',?,?)",
    ).bind(formId, formId, f.eventId, now, now),
    env.DB.prepare(
      "INSERT INTO form_fields(id,form_id,key,label,field_type,required,validation_json,sort_order,created_at) VALUES(?,?,'home_country','Country','select',0,'{\"format\":\"iso_country\"}',1,?)",
    ).bind(fieldId, formId, now),
    env.DB.prepare(
      "INSERT INTO form_submissions(id,form_id,submitted_by_user_id,context_type,context_ref,status,submitted_at) VALUES(?,?,?,'registration',?,'submitted',?)",
    ).bind(submissionId, formId, f.userId, f.registrationId, now),
    env.DB.prepare(
      "INSERT INTO form_submission_answers(id,submission_id,field_id,field_key,data_json,created_at) VALUES(?,?,?,'home_country','\"NL\"',?)",
    ).bind(crypto.randomUUID(), submissionId, fieldId, now),
  ]);
  for (const [suffix, matches] of [
    ["?job_title=architect&country=NL&badge_role=staff&consent=true", true],
    ["?job_title=director", false],
    ["?country=BE", false],
    ["?badge_role=speaker", false],
    ["?consent=false", false],
  ] as const) {
    const roster = eventAttendanceRegistrationsListResponseSchema.parse(await (await get(suffix)).json());
    expect(roster.registrations.map((row) => row.id)).toEqual(matches ? [f.registrationId] : []);
    const print = eventBadgePrintPopulationResponseSchema.parse(
      await (await get(`/badges/population${suffix}`)).json(),
    );
    expect(print.registrations.map((row) => row.id)).toEqual(matches ? [f.registrationId] : []);
    const csv = await (await get(`/exports${suffix}`)).text();
    expect(csv.includes("sharing@synthetic.example")).toBe(matches);
  }
  const sponsor = await (await get("/exports?audience=sponsor&consent=false")).text();
  expect(sponsor).not.toContain("sharing@synthetic.example");
  const sponsorHeaders = (await (await get("/exports?audience=sponsor")).text()).split("\n")[0];
  expect(sponsorHeaders).not.toMatch(/Source|Registered|Sponsor consent|Country test/);
});

it("rechecks sponsor consent changes at audited CSV release and returns no stale data", async () => {
  const f = await fixture(),
    get = await managedRoster(f);
  const raced = mutateBeforeMatchingQuery(
    env.DB,
    (sql) => sql.includes("FROM json_each(?) expected"),
    async () => {
      expect((await withdraw(f.path)).status).toBe(200);
    },
  );
  const response = await get("/exports?audience=sponsor", true, raced);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "SPONSOR_CONSENT_CHANGED" } });
  expect(
    await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action='admin_registration_export' AND entity_id=?",
    )
      .bind(f.eventId)
      .first<number>("count"),
  ).toBe(0);
});
