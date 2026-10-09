import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  badgeIssueRequestSchema,
  badgeIssueResponseSchema,
  badgePrintingResponseSchema,
} from "../assets/shared/schemas/route-contracts-event-badges";
import { currentBadgeResponseSchema } from "../assets/shared/schemas/route-contracts-event-current-badge";
import { badgeCredentialSchema } from "../assets/shared/schemas/badge-credential";
import { badgeCredentialSvg } from "../functions/_lib/services/event-participation/badge-print";
import { hashBadgeCredential } from "../functions/_lib/services/event-participation/badge-hash";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";

const fixture = createEventScannerFixture();
const base = "/api/v1/events/scan-test/badges";

function call(path: string, token: string | null, init: RequestInit = {}) {
  return callApi(env, path, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}
const ticket = (token: string | null) => call(`${base}/current`, token, { method: "PUT" });
async function sessionFor(userId: string) {
  return createAdminSession(env.DB, userId, crypto.randomUUID());
}
async function person(status = "registered") {
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users(id,email,normalized_email,active,first_name,last_name) VALUES(?,?,?,1,'Grace','Hopper')",
  )
    .bind(id, `${id}@example.test`, `${id}@example.test`)
    .run();
  await env.DB.prepare(
    "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,registration_job_title,created_at,updated_at) VALUES(?,?,?,?,'in_person','test',?,'Rear admiral',?,?)",
  )
    .bind(crypto.randomUUID(), fixture.eventId, id, status, crypto.randomUUID(), now, now)
    .run();
  return id;
}
async function badges(userId: string) {
  return (
    await env.DB.prepare(
      "SELECT id,revoked_at,print_credential_json IS NOT NULL AS sealed FROM event_badge_credentials WHERE event_id=? AND user_id=? ORDER BY created_at,id",
    )
      .bind(fixture.eventId, userId)
      .all<{ id: string; revoked_at: string | null; sealed: number }>()
  ).results;
}
/** The readable code printed under the QR is the scanner payload in display form. */
function printedCode(svg: string) {
  const code = /([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})<\/text>/.exec(svg)?.[1];
  if (!code) throw new Error("The badge SVG carries no readable code.");
  return badgeCredentialSchema.parse(code);
}

describe("The holder's own badge ticket", () => {
  beforeEach(async () => {
    await fixture.setup();
  });

  it("returns the organizer-issued badge with the exact QR the scanner accepts and the print design", async () => {
    const before = await badges(fixture.userId);
    const response = await ticket(await sessionFor(fixture.userId));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = currentBadgeResponseSchema.parse(await response.json());
    expect(body.badge.id).toBe(before[0]!.id);
    expect(body.badge.svg).toBe(await badgeCredentialSvg(fixture.badgeId));
    expect(printedCode(body.badge.svg)).toBe(fixture.badgeId);
    expect(await badges(fixture.userId)).toEqual(before);
    const organizerContext = badgePrintingResponseSchema.parse(
      await (await call(`${base}/printing`, fixture.token)).json(),
    );
    expect(body.printing).toEqual(organizerContext);
    expect(body.badge.printingRevision).toBe(organizerContext.revision);
    const scan = await fixture.scan(fixture.scanBody({ action: "attendance", occurrenceId: null }));
    expect(await scan.json()).toMatchObject({ outcome: "eligible", attendanceRecorded: true });
  });

  it("issues one credential to a confirmed registration without a badge, and the scanner admits its code", async () => {
    const userId = await person();
    const token = await sessionFor(userId);
    const [first, concurrent] = await Promise.all([ticket(token), ticket(token)]);
    expect(first.status, await first.clone().text()).toBe(200);
    expect(concurrent.status, await concurrent.clone().text()).toBe(200);
    const issued = currentBadgeResponseSchema.parse(await first.json());
    expect(currentBadgeResponseSchema.parse(await concurrent.json()).badge.id).toBe(issued.badge.id);
    const rows = await badges(userId);
    expect(rows).toEqual([{ id: issued.badge.id, revoked_at: null, sealed: 1 }]);
    const again = currentBadgeResponseSchema.parse(await (await ticket(token)).json());
    expect(again.badge).toEqual(issued.badge);
    const credential = printedCode(issued.badge.svg);
    const stored = await env.DB.prepare("SELECT credential_hash FROM event_badge_credentials WHERE id=?")
      .bind(issued.badge.id)
      .first<{ credential_hash: string }>();
    expect(stored?.credential_hash).toBe(await hashBadgeCredential(credential));
    expect(issued.badge.svg).toBe(await badgeCredentialSvg(credential));
    const audit = await env.DB.prepare(
      "SELECT actor_id,details_json FROM audit_log WHERE action='badge_issued' AND entity_id=?",
    )
      .bind(issued.badge.id)
      .first<{ actor_id: string; details_json: string }>();
    expect(audit?.actor_id).toBe(userId);
    expect(audit?.details_json).not.toContain(credential);
    const scan = await fixture.scan(
      fixture.scanBody({ action: "attendance", occurrenceId: null, badgeId: credential }),
    );
    expect(await scan.json()).toMatchObject({ outcome: "eligible", attendanceRecorded: true });
  });

  it("never returns another attendee's badge", async () => {
    const userId = await person();
    const body = currentBadgeResponseSchema.parse(await (await ticket(await sessionFor(userId))).json());
    const [original] = await badges(fixture.userId);
    expect(body.badge.id).not.toBe(original!.id);
    expect(body.badge.svg).not.toContain(fixture.badgeId.slice(0, 4) + "-" + fixture.badgeId.slice(4, 8));
    expect(body.badge.displayName).toBe("Grace Hopper");
    expect(body.badge.jobTitle).toBe("Rear admiral");
  });

  it.each(["pending_email_confirmation", "cancelled"])("refuses a %s registration without issuing", async (status) => {
    const userId = await person(status);
    const response = await ticket(await sessionFor(userId));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "BADGE_REGISTRATION_REQUIRED" } });
    expect(await badges(userId)).toEqual([]);
  });

  it("refuses an attendee registered only for another event, and an anonymous caller", async () => {
    const outsider = await person();
    const otherEventId = crypto.randomUUID(),
      now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO events (id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES (?,'other-test','Other test','UTC','invite_or_open','{}',?,?)",
    )
      .bind(otherEventId, now, now)
      .run();
    await env.DB.prepare("UPDATE registrations SET event_id=? WHERE user_id=?").bind(otherEventId, outsider).run();
    const response = await ticket(await sessionFor(outsider));
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await badges(outsider)).toEqual([]);
    expect((await ticket(null)).status).toBe(401);
  });

  it("keeps an organizer revocation instead of issuing a replacement", async () => {
    const [original] = await badges(fixture.userId);
    expect((await call(`${base}/${original!.id}`, fixture.token, { method: "DELETE" })).status).toBe(200);
    const response = await ticket(await sessionFor(fixture.userId));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "BADGE_REVOKED" } });
    expect(await badges(fixture.userId)).toHaveLength(1);
  });

  it("lets organizer printing reuse the holder's active badge instead of adding a credential", async () => {
    const userId = await person();
    const holder = currentBadgeResponseSchema.parse(await (await ticket(await sessionFor(userId))).json());
    const body = badgeIssueRequestSchema.parse({ operationId: crypto.randomUUID(), userId, reuseActive: true });
    const response = await call(base, fixture.token, { method: "POST", body: JSON.stringify(body) });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(badgeIssueResponseSchema.parse(await response.json())).toMatchObject({
      result: "existing",
      id: holder.badge.id,
      credential: null,
    });
    expect(await badges(userId)).toHaveLength(1);
    expect(
      badgeIssueRequestSchema.safeParse({ ...body, replaceBadgeId: holder.badge.id }).success,
      "replacement and reuse are exclusive",
    ).toBe(false);
  });
});
