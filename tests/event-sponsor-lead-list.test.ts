import { generateBadgeCredential } from "../assets/shared/schemas/badge-credential";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { queryAll } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import {
  sponsorLeadListSchema,
  sponsorLeadSponsorsSchema,
  sponsorLeadCapturesSchema,
} from "../assets/shared/schemas/event-sponsor-lead-list";
import { captureSponsorLead } from "../functions/_lib/services/event-participation/sponsor-leads";
import { hashBadgeCredential } from "../functions/_lib/services/event-participation/scanning";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { exportSponsorLeads } from "../functions/_lib/services/event-participation/lead-export";
import { eventContactAccessSql } from "../functions/_lib/services/event-participation/evidence-retention";
import { listSponsorLeads } from "../functions/_lib/services/event-participation/lead-list";
import { sponsorLeadQuerySchema } from "../assets/shared/schemas/event-sponsor-lead-list";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import {
  registrationManageSchema,
  registrationManageUpdateResponseSchema,
} from "../assets/shared/schemas/registration";
import {
  leadCaptureRequestSchema,
  leadCaptureResponseSchema,
} from "../assets/shared/schemas/event-participation-reporting";

const eventId = crypto.randomUUID(),
  sponsorId = crypto.randomUUID(),
  foreignSponsor = crypto.randomUUID(),
  foreignEvent = crypto.randomUUID(),
  operator = crypto.randomUUID();
let token: string;
async function request(path = `/sponsors/${sponsorId}/leads`, query = "") {
  return callApi(env, `/api/v1/events/live-leads${path}${query}`, { headers: { Authorization: `Bearer ${token}` } });
}
async function grant(
  permission = "agenda:leads_view",
  contextType = "event_sponsor",
  contextId = sponsorId,
  userId: string = operator,
) {
  await env.DB.prepare(
    "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,?,?,?,?)",
  )
    .bind(crypto.randomUUID(), userId, permission, contextType, contextId, "2026-10-04T10:00:00.000Z")
    .run();
}
beforeEach(async () => {
  await resetDb();
  await env.DB.prepare("INSERT INTO users(id,email,normalized_email,first_name,last_name,active) VALUES(?,?,?,?,?,1)")
    .bind(operator, "operator@synthetic.test", "operator@synthetic.test", "Casey", "Scanner")
    .run();
  for (const [id, slug] of [
    [eventId, "live-leads"],
    [foreignEvent, "foreign-leads"],
  ])
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at) VALUES(?,?,?,'UTC','{}',?,?)",
    )
      .bind(id, slug, slug, "2026-10-04T10:00:00.000Z", "2026-10-04T10:00:00.000Z")
      .run();
  for (const [id, event, name] of [
    [sponsorId, eventId, "Our sponsor"],
    [foreignSponsor, foreignEvent, "Foreign sponsor"],
  ])
    await env.DB.prepare(
      "INSERT INTO sponsorships(id,sponsor_type,event_id,non_member_name,pipeline_stage,created_at,updated_at) VALUES(?,'event',?,?,'active',?,?)",
    )
      .bind(id, event, name, "2026-10-04T10:00:00.000Z", "2026-10-04T10:00:00.000Z")
      .run();
  await env.DB.prepare(
    "INSERT INTO event_terms(id,event_id,audience_type,term_key,version,active,created_at) VALUES(? ,?,'attendee','sponsor-data-sharing','1',1,?)",
  )
    .bind(crypto.randomUUID(), eventId, "2026-10-04T10:00:00.000Z")
    .run();
  for (let i = 0; i < 3; i++) {
    const userId = crypto.randomUUID(),
      regId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users(id,email,normalized_email,first_name,last_name,organization_name,active) VALUES(?,?,?,?,?,'Synthetic org',1)",
    )
      .bind(userId, `attendee${i}@synthetic.test`, `attendee${i}@synthetic.test`, `Person ${i}`, "Example")
      .run();
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(regId, eventId, userId, crypto.randomUUID(), "2026-10-04T10:00:00.000Z", "2026-10-04T10:00:00.000Z")
      .run();
    await env.DB.prepare(
      "INSERT INTO consent_acceptances(id,registration_id,event_id,user_id,audience_type,term_key,term_version,accepted_at) VALUES(?,?,?,?,'attendee','sponsor-data-sharing','1',?)",
    )
      .bind(crypto.randomUUID(), regId, eventId, userId, "2026-10-04T10:00:00.000Z")
      .run();
    await env.DB.prepare(
      "INSERT INTO event_sponsor_leads(id,event_id,sponsor_id,user_id,operator_user_id,observed_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(crypto.randomUUID(), eventId, sponsorId, userId, operator, `2026-10-04T10:0${i}:00.000Z`)
      .run();
  }
  await grant();
  token = await createAdminSession(env.DB, operator, crypto.randomUUID());
});
describe("sponsor live lead viewing through the mounted API", () => {
  it("shares real captures between two independently authorized sponsor staff and refuses unrelated or ended scope", async () => {
    const secondOperator = await insertUser(env.DB, "colleague@synthetic.test");
    const unrelatedOperator = await insertUser(env.DB, "unrelated-staff@synthetic.test");
    await env.DB.prepare("UPDATE users SET first_name='Jordan',last_name='Colleague' WHERE id=?")
      .bind(secondOperator)
      .run();
    await grant("agenda:leads_view", "event_sponsor", sponsorId, secondOperator);
    for (const userId of [operator, secondOperator])
      for (const permission of ["agenda:leads_capture", "agenda:leads_export"])
        await grant(permission, "event_sponsor", sponsorId, userId);
    for (const userId of [secondOperator, unrelatedOperator])
      await grant("agenda:leads_view", "event_sponsor", foreignSponsor, userId);
    const secondToken = await createAdminSession(env.DB, secondOperator, crypto.randomUUID());
    const unrelatedToken = await createAdminSession(env.DB, unrelatedOperator, crypto.randomUUID());
    const attendee = await env.DB.prepare(
      "SELECT lead.user_id,person.email FROM event_sponsor_leads lead JOIN users person ON person.id=lead.user_id WHERE lead.event_id=? ORDER BY lead.observed_at LIMIT 1",
    )
      .bind(eventId)
      .first<{ user_id: string; email: string }>();
    expect(attendee).not.toBeNull();
    await env.DB.prepare("DELETE FROM event_sponsor_leads WHERE event_id=? AND sponsor_id=? AND user_id=?")
      .bind(eventId, sponsorId, attendee!.user_id)
      .run();
    const credential = generateBadgeCredential();
    await env.DB.prepare(
      "INSERT INTO event_badge_credentials(id,event_id,user_id,credential_hash,created_at) VALUES(?,?,?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        eventId,
        attendee!.user_id,
        await hashBadgeCredential(credential),
        new Date().toISOString(),
      )
      .run();
    const base = `/api/v1/events/live-leads/sponsors/${sponsorId}/leads`;
    const read = (actorToken: string, path = base) =>
      callApi(env, path, { headers: { authorization: `Bearer ${actorToken}` } });
    const capture = (userId: string, actorToken: string) =>
      callApi(env, base, {
        method: "POST",
        headers: { authorization: `Bearer ${actorToken}`, "content-type": "application/json" },
        body: JSON.stringify(
          leadCaptureRequestSchema.parse({
            operatorUserId: userId,
            operationId: crypto.randomUUID(),
            deviceId: crypto.randomUUID(),
            badgeId: credential,
            consentConfirmed: true,
            observedAt: new Date().toISOString(),
          }),
        ),
      });
    for (const [userId, actorToken] of [
      [operator, token],
      [secondOperator, secondToken],
    ] as const) {
      const response = await capture(userId, actorToken);
      expect(response.status, await response.clone().text()).toBe(200);
      expect(leadCaptureResponseSchema.parse(await response.json())).toEqual({
        captured: true,
        recorded: true,
        reason: "captured",
      });
    }
    const pages = [];
    for (const actorToken of [token, secondToken]) {
      const response = await read(actorToken, `${base}?q=${encodeURIComponent(attendee!.email)}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const page = sponsorLeadListSchema.parse(await response.json());
      expect(page.page.total).toBe(1);
      expect(page.leads).toHaveLength(1);
      expect(page.leads[0]).toMatchObject({ userId: attendee!.user_id, email: attendee!.email });
      pages.push(page);
    }
    expect(pages[1]).toEqual(pages[0]);
    const historyPath = `${base}/${pages[0]!.leads[0]!.id}/captures`;
    const histories = [];
    for (const actorToken of [token, secondToken]) {
      const response = await read(actorToken, `${historyPath}?sort=receivedAt`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const history = sponsorLeadCapturesSchema.parse(await response.json());
      expect(history.page.total).toBe(2);
      expect(history.captures).toHaveLength(2);
      expect(history.captures.map((row) => row.operatorUserId).sort()).toEqual([operator, secondOperator].sort());
      expect(history.captures.map((row) => row.operatorName).sort()).toEqual(["Casey Scanner", "Jordan Colleague"]);
      histories.push(history);
      const csv = await read(actorToken, `${base}.csv`);
      expect(csv.status).toBe(200);
      expect(await csv.text()).toContain(attendee!.email);
    }
    expect(histories[1]).toEqual(histories[0]);
    const attempts = () =>
      queryAll(env.DB, "SELECT id,operator_user_id,operation_id,outcome,reason FROM event_scan_attempts ORDER BY id");
    const beforeRefusals = await attempts();
    expect(beforeRefusals).toHaveLength(2);
    const otherScope = await read(unrelatedToken, `/api/v1/events/foreign-leads/sponsors/${foreignSponsor}/leads`);
    expect(otherScope.status).toBe(200);
    expect(sponsorLeadListSchema.parse(await otherScope.json()).leads).toEqual([]);
    for (const path of [base, historyPath, `${base}.csv`]) {
      const refused = await read(unrelatedToken, path);
      expect(refused.status).toBe(403);
      expect(await refused.text()).not.toContain(attendee!.email);
    }
    expect((await capture(unrelatedOperator, unrelatedToken)).status).toBe(403);
    await env.DB.prepare(
      "UPDATE permission_grants SET revoked_at=? WHERE user_id=? AND context_type='event_sponsor' AND context_id=?",
    )
      .bind(new Date().toISOString(), secondOperator, sponsorId)
      .run();
    for (const path of [base, historyPath, `${base}.csv`]) {
      const refused = await read(secondToken, path);
      expect(refused.status).toBe(403);
      expect(await refused.text()).not.toContain(attendee!.email);
    }
    expect((await capture(secondOperator, secondToken)).status).toBe(403);
    expect(await attempts()).toEqual(beforeRefusals);
    const retainedHistory = await read(token, `${historyPath}?sort=receivedAt`);
    expect(retainedHistory.status).toBe(200);
    expect(sponsorLeadCapturesSchema.parse(await retainedHistory.json())).toEqual(histories[0]);
    expect(await queryAll(env.DB, "SELECT id FROM event_attendance_observations")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM event_session_admissions")).toEqual([]);
  });
  it("paginates unique live contacts, searches and attributes capture without creating attendance", async () => {
    const response = await request(undefined, "?limit=2&sort=name");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const page = sponsorLeadListSchema.parse(await response.json());
    expect(page.page).toEqual({ limit: 2, offset: 0, total: 3, hasMore: true });
    expect(page.leads.map((row) => row.name)).toEqual(["Person 0 Example", "Person 1 Example"]);
    expect(page.leads[0]).toMatchObject({
      operatorUserId: operator,
      operatorName: "Casey Scanner",
      capturedAt: "2026-10-04T10:00:00.000Z",
    });
    const last = sponsorLeadListSchema.parse(await (await request(undefined, "?limit=2&offset=2&sort=name")).json());
    expect(last.page.hasMore).toBe(false);
    expect(last.leads).toHaveLength(1);
    const searched = sponsorLeadListSchema.parse(
      await (await request(undefined, "?q=attendee1@synthetic.test")).json(),
    );
    expect(searched.page.total).toBe(1);
    const empty = sponsorLeadListSchema.parse(await (await request(undefined, "?offset=10")).json());
    expect(empty.leads).toEqual([]);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS total FROM event_attendance_observations").first<{ total: number }>())
        ?.total,
    ).toBe(0);
    expect((await request(undefined, "?sort=private&limit=101")).status).toBe(400);
  });
  it("exposes discovery only for exact sponsor grants and independently reports capture/export scopes", async () => {
    await grant("agenda:leads_capture");
    const response = await request("/sponsors/leads", "?q=Our&limit=1");
    expect(response.status).toBe(200);
    const result = sponsorLeadSponsorsSchema.parse(await response.json());
    expect(result.sponsors).toEqual([
      { id: sponsorId, name: "Our sponsor", canView: true, canCapture: true, canExport: false },
    ]);
    await env.DB.prepare(
      "UPDATE permission_grants SET revoked_at='2026-10-04T10:00:00.000Z' WHERE permission='agenda:leads_capture'",
    ).run();
    await env.DB.prepare(
      "UPDATE permission_grants SET permission='agenda:leads_export' WHERE permission='agenda:leads_view'",
    ).run();
    const exportOnly = sponsorLeadSponsorsSchema.parse(await (await request("/sponsors/leads")).json());
    expect(exportOnly.sponsors[0]).toMatchObject({ canView: false, canCapture: false, canExport: true });
    expect((await request()).status).toBe(403);
  });
  it("rejects revoked, expired, capture-only and global administrative scopes", async () => {
    await env.DB.prepare("UPDATE permission_grants SET revoked_at='2026-10-04T10:00:00.000Z'").run();
    expect((await request()).status).toBe(401);
    await expect(
      listSponsorLeads(env.DB, eventId, sponsorId, operator, sponsorLeadQuerySchema.parse({})),
    ).rejects.toMatchObject({ status: 403 });
    await env.DB.prepare("UPDATE permission_grants SET revoked_at=NULL,expires_at='2000-01-01T00:00:00.000Z'").run();
    expect((await request()).status).toBe(401);
    await expect(
      listSponsorLeads(env.DB, eventId, sponsorId, operator, sponsorLeadQuerySchema.parse({})),
    ).rejects.toMatchObject({ status: 403 });
    await env.DB.prepare("UPDATE permission_grants SET expires_at=NULL,permission='agenda:leads_capture'").run();
    expect((await request()).status).toBe(403);
    await env.DB.prepare(
      "UPDATE permission_grants SET permission='agenda:leads_view',context_type=NULL,context_id=NULL",
    ).run();
    await expect(
      listSponsorLeads(env.DB, eventId, sponsorId, operator, sponsorLeadQuerySchema.parse({})),
    ).rejects.toMatchObject({ status: 403 });
    const discovery = await request("/sponsors/leads");
    expect(discovery.status).toBe(200);
    expect(sponsorLeadSponsorsSchema.parse(await discovery.json()).sponsors).toEqual([]);
  });
  it("excludes consent changes, inactive attendees and cancelled registrations on every refresh", async () => {
    await env.DB.prepare(
      "UPDATE consent_acceptances SET term_version='old' WHERE user_id=(SELECT user_id FROM event_sponsor_leads ORDER BY observed_at LIMIT 1)",
    ).run();
    let result = sponsorLeadListSchema.parse(await (await request()).json());
    expect(result.page.total).toBe(2);
    await env.DB.prepare(
      "UPDATE registrations SET status='cancelled' WHERE user_id=(SELECT user_id FROM event_sponsor_leads ORDER BY observed_at LIMIT 1 OFFSET 1)",
    ).run();
    result = sponsorLeadListSchema.parse(await (await request()).json());
    expect(result.page.total).toBe(1);
    await env.DB.prepare(
      "UPDATE users SET active=0 WHERE id=(SELECT user_id FROM event_sponsor_leads ORDER BY observed_at LIMIT 1 OFFSET 2)",
    ).run();
    result = sponsorLeadListSchema.parse(await (await request()).json());
    expect(result.leads).toEqual([]);
    expect(result.page.total).toBe(0);
  });
  it("refuses foreign sponsors/events and inactive sponsorships even with explicit scope", async () => {
    await grant("agenda:leads_view", "event_sponsor", foreignSponsor);
    expect((await request(`/sponsors/${foreignSponsor}/leads`)).status).toBe(404);
    await expect(
      listSponsorLeads(env.DB, foreignEvent, sponsorId, operator, sponsorLeadQuerySchema.parse({})),
    ).rejects.toMatchObject({ status: 404 });
    await env.DB.prepare("UPDATE sponsorships SET pipeline_stage='cancelled' WHERE id=?").bind(sponsorId).run();
    expect((await request()).status).toBe(404);
    const discovery = sponsorLeadSponsorsSchema.parse(await (await request("/sponsors/leads")).json());
    expect(discovery.sponsors).toEqual([]);
  });
  it("paginates capture history across operators and conceals it after consent withdrawal", async () => {
    const otherOperator = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users(id,email,normalized_email,first_name,last_name,active) VALUES(?,?,?,?,?,1)")
      .bind(otherOperator, "second@synthetic.test", "second@synthetic.test", "Jordan", "Scanner")
      .run();
    const lead = await env.DB.prepare("SELECT id,user_id FROM event_sponsor_leads ORDER BY observed_at LIMIT 1").first<{
      id: string;
      user_id: string;
    }>();
    expect(lead).not.toBeNull();
    for (const [index, capturer] of [operator, otherOperator].entries())
      await env.DB.prepare(
        "INSERT INTO event_scan_attempts(id,event_id,sponsor_id,user_id,operator_user_id,device_id,operation_id,request_hash,outcome,reason,action,observed_at,created_at) VALUES(?,?,?,?,?,?,?,?,'eligible','eligible','lead',?,?)",
      )
        .bind(
          crypto.randomUUID(),
          eventId,
          sponsorId,
          lead!.user_id,
          capturer,
          crypto.randomUUID(),
          crypto.randomUUID(),
          "a".repeat(64),
          `2026-10-04T10:0${index}:00.000Z`,
          `2026-10-04T11:0${index}:00.000Z`,
        )
        .run();
    const path = `/sponsors/${sponsorId}/leads/${lead!.id}/captures`;
    const response = await request(path, "?limit=1&sort=receivedAt");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const firstPage = sponsorLeadCapturesSchema.parse(await response.json());
    expect(firstPage.page.total).toBe(2);
    expect(firstPage.page.hasMore).toBe(true);
    expect(firstPage.captures[0]).toMatchObject({
      operatorUserId: operator,
      operatorName: "Casey Scanner",
      observedAt: "2026-10-04T10:00:00.000Z",
      receivedAt: "2026-10-04T11:00:00.000Z",
    });
    const last = sponsorLeadCapturesSchema.parse(
      await (await request(path, "?limit=1&offset=1&sort=receivedAt")).json(),
    );
    expect(last.captures[0].operatorUserId).toBe(otherOperator);
    expect(last.page.hasMore).toBe(false);
    const registrationId = await env.DB.prepare("SELECT id FROM registrations WHERE event_id=? AND user_id=?")
      .bind(eventId, lead!.user_id)
      .first<string>("id");
    const manageToken = await issueDatabaseCapability({
      db: env.DB,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
      purpose: "registration_manage",
      resourceId: registrationId!,
    });
    const withdrawn = await callApi(env, `/api/v1/registrations/access/${encodeURIComponent(manageToken)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(registrationManageSchema.parse({ action: "withdraw_sponsor_sharing" })),
    });
    expect(withdrawn.status, await withdrawn.clone().text()).toBe(200);
    expect(registrationManageUpdateResponseSchema.parse(await withdrawn.json()).sponsorSharing.allowed).toBe(false);
    expect(
      await env.DB.prepare("SELECT COUNT(*) FROM consent_acceptances WHERE user_id=? AND withdrawn_at IS NOT NULL")
        .bind(lead!.user_id)
        .first<number>("COUNT(*)"),
    ).toBe(1);
    expect((await request(path)).status).toBe(404);
    const email = await env.DB.prepare("SELECT email FROM users WHERE id=?").bind(lead!.user_id).first<string>("email");
    expect(
      sponsorLeadListSchema.parse(await (await request(undefined, `?q=${encodeURIComponent(email!)}`)).json()).page
        .total,
    ).toBe(0);
    await grant("agenda:leads_export");
    const csv = await request(`/sponsors/${sponsorId}/leads.csv`);
    expect(csv.status).toBe(200);
    expect(await csv.text()).not.toContain(email!);
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS total FROM event_scan_attempts").first<{ total: number }>())?.total,
    ).toBe(2);
  });
});

it("blocks expired sponsor contact views, count/search/export while preserving account email and original leads", async () => {
  await grant("agenda:leads_export");
  await env.DB.prepare("UPDATE events SET ends_at='2020-01-01T10:00:00.000Z' WHERE id=?").bind(eventId).run();
  await env.DB.prepare(
    "INSERT INTO retention_policies(event_id,user_retention_days,updated_at) VALUES(?,1,'2026-10-04T10:00:00.000Z')",
  )
    .bind(eventId)
    .run();
  for (const query of ["", "?q=Person&limit=1", "?q=synthetic.test&sort=email"])
    expect((await request(undefined, query)).status).toBe(410);
  await expect(exportSponsorLeads(env.DB, eventId, sponsorId, operator)).rejects.toMatchObject({
    status: 410,
    code: "EVENT_CONTACT_RETENTION_EXPIRED",
  });
  const lead = await env.DB.prepare("SELECT id,user_id FROM event_sponsor_leads WHERE event_id=? LIMIT 1")
    .bind(eventId)
    .first<{ id: string; user_id: string }>();
  expect((await request(`/sponsors/${sponsorId}/leads/${lead!.id}/captures`)).status).toBe(410);
  expect(
    await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM event_sponsor_leads lead WHERE lead.event_id=? AND ${eventContactAccessSql("lead.event_id")}`,
    )
      .bind(eventId)
      .first(),
  ).toEqual({ count: 0 });
  expect(
    await env.DB.prepare("SELECT COUNT(*) AS count FROM event_sponsor_leads WHERE event_id=?").bind(eventId).first(),
  ).toEqual({ count: 3 });
  expect(
    (await env.DB.prepare("SELECT email FROM users WHERE id=?").bind(lead!.user_id).first<{ email: string }>())!.email,
  ).toContain("@synthetic.test");
});

it("rechecks contact expiry in the same page/count batch after a successful preflight", async () => {
  const raced = mutateBeforeNextBatch(env.DB, async () => {
    await env.DB.prepare("UPDATE events SET ends_at='2020-01-01T10:00:00.000Z' WHERE id=?").bind(eventId).run();
    await env.DB.prepare(
      "INSERT INTO retention_policies(event_id,user_retention_days,updated_at) VALUES(?,0,'2026-10-04T10:00:00.000Z')",
    )
      .bind(eventId)
      .run();
  });
  const result = await listSponsorLeads(
    raced,
    eventId,
    sponsorId,
    operator,
    sponsorLeadQuerySchema.parse({ q: "Person", limit: 1 }),
  );
  expect(result.leads).toEqual([]);
  expect(result.page.total).toBe(0);
});
it("records recognized denials without collecting leads when contact expiry precedes or races atomic capture", async () => {
  await grant("agenda:leads_capture");
  const lead = await env.DB.prepare("SELECT user_id FROM event_sponsor_leads WHERE event_id=? LIMIT 1")
    .bind(eventId)
    .first<{ user_id: string }>();
  const credential = generateBadgeCredential();
  await env.DB.prepare(
    "INSERT INTO event_badge_credentials(id,event_id,user_id,credential_hash,created_at) VALUES(?,?,?,?,?)",
  )
    .bind(
      crypto.randomUUID(),
      eventId,
      lead!.user_id,
      await hashBadgeCredential(credential),
      "2026-10-04T10:00:00.000Z",
    )
    .run();
  const expire = async () => {
    await env.DB.prepare("UPDATE events SET ends_at='2020-01-01T10:00:00.000Z' WHERE id=?").bind(eventId).run();
    await env.DB.prepare(
      "INSERT INTO retention_policies(event_id,user_retention_days,updated_at) VALUES(?,0,'2026-10-04T10:00:00.000Z')",
    )
      .bind(eventId)
      .run();
  };
  const input = {
    operatorUserId: operator,
    operationId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
    consentConfirmed: true,
    badgeId: credential,
    observedAt: "2026-10-04T10:00:00.000Z",
  };
  const result = await captureSponsorLead(mutateBeforeNextBatch(env.DB, expire), eventId, sponsorId, operator, input);
  expect(result).toEqual({ captured: false, recorded: true, reason: "contact_retention_expired" });
  expect(
    await env.DB.prepare("SELECT outcome,reason FROM event_scan_attempts WHERE operation_id=?")
      .bind(input.operationId)
      .first(),
  ).toEqual({ outcome: "denied", reason: "contact_retention_expired" });
  expect(
    await captureSponsorLead(env.DB, eventId, sponsorId, operator, { ...input, operationId: crypto.randomUUID() }),
  ).toEqual({ captured: false, recorded: true, reason: "contact_retention_expired" });
  expect(
    await env.DB.prepare("SELECT COUNT(*) AS count FROM event_sponsor_leads WHERE event_id=?").bind(eventId).first(),
  ).toEqual({ count: 3 });
});
