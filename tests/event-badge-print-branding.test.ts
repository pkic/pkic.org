import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  badgePrintingResponseSchema,
  badgePrintingRouteSchema,
  badgePrintRouteSchema,
  badgePrintRequestSchema,
  badgePrintResponseSchema,
  badgeCredentialMetadataSchema,
} from "../assets/shared/schemas/route-contracts-event-badges";
import { eventBadgeTemplateSchema } from "../assets/shared/schemas/event-badge-template";
import { eventResourceCoreSchema } from "../assets/shared/schemas/event-management";
import {
  registrationBadgePatchSchema,
  registrationBadgeResponseSchema,
} from "../assets/shared/schemas/participant-roles";
import { sanitizeSvgLogo } from "../functions/_lib/utils/svg-logo";
import { hashBadgeCredential } from "../functions/_lib/services/event-participation/badge-hash";
import type { DatabaseLike, Env } from "../functions/_lib/types";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { agendaSponsorChoicesResponseSchema } from "../assets/shared/schemas/event-agenda-sponsors";
import { mutateBeforeNextBatch, mutateBeforeMatchingQuery } from "./helpers/database-races";
import { addRepresentative, insertOrganization, seedOrganizationAggregate } from "./helpers/membership";

const fixture = createEventScannerFixture();
const base = "/api/v1/events/scan-test/badges";
const artwork =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="white"/><path d="M20 20H70V60H20Z" fill="red"/><script>alert(1)</script></svg>';
const template = eventBadgeTemplateSchema.parse({
  version: 1,
  name: "Sponsor badge",
  widthMm: 90,
  heightMm: 60,
  frontHtml:
    "<div>{{firstName}} {{lastName}}</div><div>{{organization}}</div><div>{{qr}}</div><section>{{sponsors:leaders}}</section>",
  backHtml: "",
  css: "",
  assets: {},
  sponsorGroups: [
    { key: "leaders", tierName: "Leader" },
    { key: "empty", tierName: "Ambassador" },
  ],
});
function request(path: string, init: RequestInit = {}, overrides: Partial<Env> = {}) {
  return callApi({ ...env, ...overrides }, path, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${fixture.token}` },
  });
}
async function context(overrides: Partial<Env> = {}) {
  const response = await request(`${base}/printing`, {}, overrides);
  expect(response.status, await response.clone().text()).toBe(200);
  return badgePrintingResponseSchema.parse(await response.json());
}
async function badgeId() {
  const row = await env.DB.prepare("SELECT id FROM event_badge_credentials WHERE event_id=? AND credential_hash=?")
    .bind(fixture.eventId, await hashBadgeCredential(fixture.badgeId))
    .first<{ id: string }>();
  if (!row) throw new Error("Missing issued badge");
  return row.id;
}
async function registrationId() {
  const row = await env.DB.prepare("SELECT id FROM registrations WHERE event_id=? AND user_id=?")
    .bind(fixture.eventId, fixture.userId)
    .first<{ id: string }>();
  if (!row) throw new Error("Missing registration");
  return row.id;
}
async function print(revision: string, overrides: Partial<Env> = {}) {
  return request(
    `${base}/${await badgeId()}/print`,
    {
      method: "POST",
      body: JSON.stringify(
        badgePrintRequestSchema.parse({ operationId: crypto.randomUUID(), printingRevision: revision }),
      ),
    },
    overrides,
  );
}
async function sponsor({
  eventId = fixture.eventId,
  stage = "active",
  tier = "Leader",
  logo = artwork,
  name = "Event sponsor",
}: { eventId?: string; stage?: string; tier?: string; logo?: string; name?: string } = {}) {
  const id = crypto.randomUUID(),
    key = `sponsor-logos/${id}/logo.svg`,
    now = new Date().toISOString();
  await env.ASSETS_BUCKET!.put(key, logo, { httpMetadata: { contentType: "image/svg+xml" } });
  await env.DB.prepare(
    "INSERT INTO sponsorships(id,sponsor_type,non_member_name,non_member_logo_r2_key,event_id,tier,pipeline_stage,created_at,updated_at) VALUES(?,'event',?,?,?,?,?,?,?)",
  )
    .bind(id, name, key, eventId, tier, stage, now, now)
    .run();
  return { id, key };
}
function printRace(mutation: () => Promise<unknown>): DatabaseLike {
  let armed = false;
  const raced = mutateBeforeNextBatch(env.DB, mutation);
  return {
    prepare(sql) {
      if (sql.includes("badge.print_credential_json=?")) armed = true;
      return env.DB.prepare(sql);
    },
    batch: (statements) => (armed ? raced : env.DB).batch(statements),
  };
}
async function printAudits() {
  return (await env.DB.prepare("SELECT details_json FROM audit_log WHERE action='badge_print_prepared'").all()).results;
}

describe("Event-owned authenticated badge print metadata and branding", () => {
  let catalog: { tier: string; active: number; display_weight: number }[] = [];
  beforeEach(async () => {
    catalog = (
      await env.DB.prepare(
        "SELECT tier,active,display_weight FROM sponsorship_tier_catalog WHERE sponsor_type='event' AND tier IN('Leader','Ambassador')",
      ).all<{ tier: string; active: number; display_weight: number }>()
    ).results;
    await fixture.setup();
    await env.DB.prepare(
      "UPDATE users SET first_name='Ada',last_name='Lovelace',organization_name='Unrelated profile' WHERE id=?",
    )
      .bind(fixture.userId)
      .run();
    await env.DB.prepare("UPDATE events SET settings_json=? WHERE id=?")
      .bind(JSON.stringify({ badgeTemplate: template }), fixture.eventId)
      .run();
  });
  afterEach(async () => {
    // resetDb preserves system reference data; restore exactly the catalog this case captured.
    await env.DB.batch(
      catalog.map((row) =>
        env.DB.prepare(
          "UPDATE sponsorship_tier_catalog SET active=?,display_weight=? WHERE sponsor_type='event' AND tier=?",
        ).bind(row.active, row.display_weight, row.tier),
      ),
    );
  });
  it("supplies a complete generic badge using the actual event name and visible tier bindings when no override exists", async () => {
    const selected = await sponsor();
    await env.DB.prepare("UPDATE events SET name='Actual local conference',settings_json='{}' WHERE id=?")
      .bind(fixture.eventId)
      .run();
    const captured = await context();
    expect(captured.template).not.toBeNull();
    expect(captured.template!.frontHtml).toContain("Actual local conference");
    expect(JSON.stringify(captured.template)).not.toContain("Amsterdam");
    expect(captured.template!.sponsorGroups).toHaveLength(1);
    expect(captured.template!.sponsorGroups[0].tierName).toBe("Leader");
    expect(captured.branding).toMatchObject([
      { key: captured.template!.sponsorGroups[0].key, tierName: "Leader", sponsors: [{ id: selected.id }] },
    ]);
    expect((await print(captured.revision)).status).toBe(200);
    await env.DB.prepare("UPDATE events SET name='Renamed local conference' WHERE id=?").bind(fixture.eventId).run();
    expect((await print(captured.revision)).status).toBe(409);
    const fresh = await context();
    expect(fresh.template!.frontHtml).toContain("Renamed local conference");
    expect(fresh.revision).not.toBe(captured.revision);
  });
  it("refuses a canonical persisted event title that cannot fit the generic template without print effects", async () => {
    const captured = await context();
    const eventName = eventResourceCoreSchema.shape.name.parse("Persisted event " + "x".repeat(40000));
    await env.DB.prepare("UPDATE events SET name=?,settings_json='{}' WHERE id=?")
      .bind(eventName, fixture.eventId)
      .run();
    const before = await printAudits();
    const responses = [
      { response: await request(`${base}/printing`), contract: badgePrintingRouteSchema.responses["422"] },
      { response: await print(captured.revision), contract: badgePrintRouteSchema.responses["422"] },
    ];
    for (const { response, contract } of responses) {
      expect(response.status).toBe(422);
      const refusal = contract.content["application/json"].schema.parse(await response.json());
      expect(refusal).toMatchObject({ error: { code: "BADGE_TEMPLATE_INVALID" } });
      expect(JSON.stringify(refusal)).not.toContain(eventName);
    }
    expect(await printAudits()).toEqual(before);
  });
  it("keeps explicit uploaded templates as overrides and uses self-contained generic artwork without a bucket", async () => {
    expect((await context()).template).toEqual(template);
    await env.DB.prepare("UPDATE events SET settings_json='{}' WHERE id=?").bind(fixture.eventId).run();
    const generic = await context({ ASSETS_BUCKET: undefined });
    expect(generic.template).not.toBeNull();
    expect(generic.template!.assets).toHaveProperty("mark");
    expect(generic.template!.assets).toHaveProperty("roboto_latin");
    expect(generic.template!.sponsorGroups).toEqual([]);
    expect(generic.branding).toEqual([]);
  });
  it("loads only active visible sponsors of this event, normalizes owned vector artwork, and omits empty groups", async () => {
    const included = await sponsor();
    await sponsor({ stage: "prospect", name: "Not approved" });
    const other = crypto.randomUUID(),
      now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,created_at,updated_at) VALUES(?,'other-branding','Other','UTC',?,?)",
    )
      .bind(other, now, now)
      .run();
    await sponsor({ eventId: other, name: "Other event" });
    await env.DB.prepare(
      "UPDATE sponsorship_tier_catalog SET display_weight=0 WHERE sponsor_type='event' AND tier='Ambassador'",
    ).run();
    await sponsor({ tier: "Ambassador", name: "Hidden tier" });
    const output = await context();
    const cleaned = await sanitizeSvgLogo(new TextEncoder().encode(artwork).buffer);
    expect(output.branding).toEqual([
      {
        key: "leaders",
        tierName: "Leader",
        sponsors: [{ id: included.id, name: "Event sponsor", svg: new TextDecoder().decode(cleaned.buffer) }],
      },
    ]);
    expect(output.branding[0].sponsors[0].svg).not.toContain("script");
    expect(output.branding[0].sponsors[0].svg).not.toContain("<rect");
    expect(JSON.stringify(output)).not.toContain(fixture.badgeId);
    expect(JSON.stringify(output)).not.toContain("Ada");
    const response = await print(output.revision);
    expect(response.status, await response.clone().text()).toBe(200);
    const badge = badgePrintResponseSchema.parse(await response.json());
    expect(badge).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      badgeRole: "attendee",
      printingRevision: output.revision,
    });
    expect(Object.keys(badge)).not.toContain("branding");
    expect(Object.keys(badge)).not.toContain("template");
    expect(JSON.stringify(await printAudits())).not.toContain("Ada");
  });
  it("does not revive an inactive event tier through the organization's consortium sponsorship", async () => {
    const organization = await insertOrganization(env.DB, "Consortium-only visibility"),
      now = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE organizations SET sponsor_tier='Gold',logo_r2_key='org-logos/not-read/logo.svg' WHERE id=?",
    )
      .bind(organization)
      .run();
    await env.DB.prepare(
      "INSERT INTO sponsorships(id,sponsor_type,organization_id,event_id,tier,pipeline_stage,created_at,updated_at) VALUES(?,'event',?,?,'Leader','active',?,?)",
    )
      .bind(crypto.randomUUID(), organization, fixture.eventId, now, now)
      .run();
    await env.DB.prepare(
      "UPDATE sponsorship_tier_catalog SET active=0 WHERE sponsor_type='event' AND tier='Leader'",
    ).run();
    expect((await context()).branding).toEqual([]);
    const choices = await request("/api/v1/events/scan-test/agenda/sponsors");
    expect(choices.status, await choices.clone().text()).toBe(200);
    expect(agendaSponsorChoicesResponseSchema.parse(await choices.json()).sponsors).toEqual([]);
  });
  it("requires live event-management authority before returning document artwork", async () => {
    const anonymous = await callApi(env, `${base}/printing`);
    expect(anonymous.status).toBe(401);
    const token = await createAdminSession(env.DB, fixture.userId, crypto.randomUUID());
    const denied = await callApi(env, `${base}/printing`, { headers: { authorization: `Bearer ${token}` } });
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain("Sponsor badge");
  });
  it("refuses a changed active sponsor population at the final context release guard", async () => {
    const selected = await sponsor();
    const raced = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("json_group_array(json(source_json))"),
      () => env.DB.prepare("UPDATE sponsorships SET pipeline_stage='prospect' WHERE id=?").bind(selected.id).run(),
    );
    const response = await request(`${base}/printing`, {}, { DB: raced as D1Database });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("Event sponsor");
  });
  it("rejects excess sponsor population before any artwork access", async () => {
    const now = new Date().toISOString();
    await env.DB.batch(
      Array.from({ length: 41 }, (_, index) =>
        env.DB.prepare(
          "INSERT INTO sponsorships(id,sponsor_type,non_member_name,non_member_logo_r2_key,event_id,tier,pipeline_stage,created_at,updated_at) VALUES(?,'event',?,'sponsor-logos/not-read/logo.svg',?,'Leader','active',?,?)",
        ).bind(crypto.randomUUID(), `Sponsor ${index}`, fixture.eventId, now, now),
      ),
    );
    const response = await request(`${base}/printing`, {}, { ASSETS_BUCKET: undefined });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "BADGE_SPONSOR_LIMIT" } });
  });
  it("uses the selected registration representation and an authorized sponsor display override without granting duties", async () => {
    const organization = await insertOrganization(env.DB, "Selected organization"),
      member = await seedOrganizationAggregate(env.DB, organization, "A"),
      identity = await addRepresentative(env.DB, member, fixture.userId);
    const registration = await registrationId();
    await env.DB.prepare(
      "UPDATE registrations SET registration_identity_id=?,registration_organization_name='Selected organization' WHERE id=?",
    )
      .bind(identity, registration)
      .run();
    const before = (
      await env.DB.prepare("SELECT * FROM effective_event_participant_roles WHERE event_id=? AND user_id=?")
        .bind(fixture.eventId, fixture.userId)
        .all()
    ).results;
    const response = await request(`/api/v1/events/scan-test/registrations/${registration}/badge`, {
      method: "PATCH",
      body: JSON.stringify(registrationBadgePatchSchema.parse({ role: "sponsor" })),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(registrationBadgeResponseSchema.parse(await response.json()).effective_role).toBe("sponsor");
    const output = await context(),
      printed = await print(output.revision);
    expect(printed.status, await printed.clone().text()).toBe(200);
    expect(badgePrintResponseSchema.parse(await printed.json())).toMatchObject({
      organization: "Selected organization",
      badgeRole: "sponsor",
    });
    expect(
      (
        await env.DB.prepare("SELECT * FROM effective_event_participant_roles WHERE event_id=? AND user_id=?")
          .bind(fixture.eventId, fixture.userId)
          .all()
      ).results,
    ).toEqual(before);
    const metadata = badgeCredentialMetadataSchema.parse(await (await request(`${base}/${await badgeId()}`)).json());
    expect(Object.keys(metadata)).not.toContain("organization");
    expect(Object.keys(metadata)).not.toContain("badgeRole");
  });
  it.each([
    ["moderator", "speaker"],
    ["organizer", "staff"],
  ] as const)("maps the canonical active %s role to the %s display band", async (role, displayRole) => {
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO event_participants(id,event_id,user_id,role,status,source_type,created_at,updated_at) VALUES(?,?,?,?,'active','test',?,?)",
    )
      .bind(crypto.randomUUID(), fixture.eventId, fixture.userId, role, now, now)
      .run();
    const captured = await context(),
      response = await print(captured.revision);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(badgePrintResponseSchema.parse(await response.json()).badgeRole).toBe(displayRole);
  });
  it("keeps closed contact labels redacted in every new print metadata field", async () => {
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO event_contact_retention_state(event_id,closed_at,deadline_at) VALUES(?,?,?)")
      .bind(fixture.eventId, now, now)
      .run();
    const captured = await context(),
      response = await print(captured.revision);
    expect(response.status, await response.clone().text()).toBe(200);
    const artifact = badgePrintResponseSchema.parse(await response.json());
    expect(artifact).toMatchObject({ displayName: null, firstName: null, lastName: null, organization: null });
    expect(JSON.stringify(artifact)).not.toContain("Unrelated profile");
  });
  it("refreshes new artifacts after template or sponsor updates and refuses stale context without print audit", async () => {
    const selected = await sponsor(),
      initial = await context();
    await env.DB.prepare("UPDATE sponsorships SET non_member_name='Updated sponsor' WHERE id=?")
      .bind(selected.id)
      .run();
    const denied = await print(initial.revision);
    expect(denied.status).toBe(409);
    expect(await denied.json()).toMatchObject({ error: { code: "BADGE_PRINTING_CHANGED" } });
    expect(await printAudits()).toEqual([]);
    const fresh = await context();
    expect(fresh.revision).not.toBe(initial.revision);
    expect(fresh.branding[0].sponsors[0].name).toBe("Updated sponsor");
    await env.DB.prepare("UPDATE events SET settings_json=? WHERE id=?")
      .bind(JSON.stringify({ badgeTemplate: { ...template, name: "Changed layout" } }), fixture.eventId)
      .run();
    expect((await print(fresh.revision)).status).toBe(409);
  });
  it("detects same-key artwork replacement on the final document context read", async () => {
    const selected = await sponsor(),
      initial = await context();
    await env.ASSETS_BUCKET!.put(
      selected.key,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><path d="M5 5H40V40H5Z" fill="blue"/></svg>',
    );
    const fresh = await context();
    expect(fresh.revision).toBe(initial.revision);
    expect(fresh.branding).not.toEqual(initial.branding);
  });
  it("keeps the recorded print organization when the account employer changes in flight", async () => {
    await env.DB.prepare(
      "UPDATE registrations SET registration_organization_name='Recorded event organization' WHERE id=?",
    )
      .bind(await registrationId())
      .run();
    const captured = await context();
    const response = await print(captured.revision, {
      DB: printRace(() =>
        env.DB.prepare("UPDATE users SET organization_name='Later employer' WHERE id=?").bind(fixture.userId).run(),
      ) as D1Database,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(badgePrintResponseSchema.parse(await response.json())).toMatchObject({
      organization: "Recorded event organization",
    });
    expect(await printAudits()).toHaveLength(1);
  });

  it.each(["logo", "role", "organization", "event_name"] as const)(
    "refuses an in-flight %s change atomically before releasing personal print data",
    async (kind) => {
      const selected = await sponsor(),
        captured = await context(),
        registration = await registrationId();
      const response = await print(captured.revision, {
        DB: printRace(async () => {
          if (kind === "logo")
            await env.DB.prepare(
              "UPDATE sponsorships SET non_member_logo_r2_key='sponsor-logos/replaced/logo.svg' WHERE id=?",
            )
              .bind(selected.id)
              .run();
          if (kind === "role")
            await env.DB.prepare(
              "INSERT INTO registration_badge_role_overrides(registration_id,role,set_by_user_id,created_at,updated_at) VALUES(?,'staff',?,?,?)",
            )
              .bind(registration, fixture.operatorId, new Date().toISOString(), new Date().toISOString())
              .run();
          if (kind === "event_name")
            await env.DB.prepare("UPDATE events SET name='Changed name' WHERE id=?").bind(fixture.eventId).run();
          if (kind === "organization")
            await env.DB.prepare(
              "UPDATE registrations SET registration_organization_name='Changed organization' WHERE id=?",
            )
              .bind(registration)
              .run();
        }) as D1Database,
      });
      expect(response.status).toBe(403);
      expect(await printAudits()).toEqual([]);
      expect(await response.text()).not.toContain("Ada");
    },
  );
  it("requires replacement of legacy raster-only logos instead of wrapping or dropping them", async () => {
    await sponsor({ logo: "not SVG raster bytes" });
    const response = await request(`${base}/printing`);
    expect(response.status).toBe(422);
    expect(
      badgePrintingRouteSchema.responses["422"].content["application/json"].schema.parse(await response.json()),
    ).toMatchObject({ error: { code: "BADGE_SPONSOR_SVG_REQUIRED" } });
  });
  it("refuses unavailable owned artwork storage through the declared context contract", async () => {
    await sponsor();
    const before = await printAudits();
    const response = await request(`${base}/printing`, {}, { ASSETS_BUCKET: undefined });
    expect(response.status).toBe(503);
    expect(
      badgePrintingRouteSchema.responses["503"].content["application/json"].schema.parse(await response.json()),
    ).toMatchObject({ error: { code: "UPLOADS_NOT_CONFIGURED" } });
    expect(await printAudits()).toEqual(before);
  });
  it("fails explicitly on oversized owned source artwork before retaining its body", async () => {
    await sponsor({ logo: "x".repeat(1024 * 1024 + 1) });
    const response = await request(`${base}/printing`);
    expect(response.status).toBe(413);
    expect(
      badgePrintingRouteSchema.responses["413"].content["application/json"].schema.parse(await response.json()),
    ).toMatchObject({ error: { code: "BADGE_SPONSOR_LOGO_TOO_LARGE" } });
  });
});
