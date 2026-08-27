import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { createGroupManagedEvent } from "../functions/_lib/services/events/group-management";
import { createGroup } from "../functions/_lib/services/groups";
import { buildProposalProgramsPageQuery, listProposalPrograms } from "../functions/_lib/services/proposal-programs";
import type { AuthAdmin } from "../functions/_lib/types";
import { proposalProgramsListResponseSchema } from "../assets/shared/schemas/proposal-programs";
import app from "../functions/router";
import { createAdminSession } from "./helpers/auth";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);

async function setupProgram(): Promise<{ actor: AuthAdmin; eventId: string; groupId: string; token: string }> {
  const administratorEmail = `proposal-program-admin-${crypto.randomUUID()}@example.test`;
  const administratorId = await insertUser(env.DB, administratorEmail);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(administratorId).run();
  const administrator: AuthAdmin = {
    identityType: "user",
    id: administratorId,
    email: administratorEmail,
    role: "admin",
  };
  const group = await createGroup(env.DB, administrator, {
    typeKey: "working_group",
    name: `Program group ${crypto.randomUUID()}`,
    visibility: "authenticated",
    eligibilityMode: "open",
  });
  const event = await createGroupManagedEvent(env.DB, administrator, group.id, {
    slug: `program-event-${crypto.randomUUID()}`,
    name: "Program event",
    timezone: "UTC",
    startsAt: "2027-01-01T09:00:00.000Z",
    endsAt: "2027-01-01T17:00:00.000Z",
    profileKey: "workshop",
    registrationPolicy: "no_registration",
    inviteLimitAttendee: 5,
    links: [],
  });
  const userEmail = `program-committee-${crypto.randomUUID()}@example.test`;
  const userId = await insertUser(env.DB, userEmail);
  await env.DB.prepare(
    `INSERT INTO permission_grants (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
       VALUES (?, ?, 'proposals:read', 'event', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(crypto.randomUUID(), userId, event.eventId, administratorId)
    .run();
  return {
    eventId: event.eventId,
    groupId: group.id,
    token: await createAdminSession(env.DB, userId, `proposal-program-${crypto.randomUUID()}`),
    actor: {
      identityType: "user",
      id: userId,
      email: userEmail,
      role: "user",
      grants: [{ permission: "proposals:read", contextType: "event", contextId: event.eventId }],
    },
  };
}

describe("proposal program selector", () => {
  it("exposes the assigned program through the mounted portal catalog", async () => {
    const { eventId, groupId, token } = await setupProgram();
    const response = await app.fetch(
      new Request(
        `https://app.test/api/v1/me/proposal-programs?limit=25&sort=eventName&groupId=${groupId}&eventId=${eventId}`,
        {
          headers: { authorization: `Bearer ${token}` },
        },
      ),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(response.status).toBe(200);
    const body = proposalProgramsListResponseSchema.parse(await response.json());
    expect(body.programs).toHaveLength(1);
    expect(body.programs[0].event.id).toBe(eventId);
    expect(body.programs[0].access).toMatchObject({ canRead: true, canReview: false });
  });

  it("honors OAuth scope restriction rather than exposing underlying event grants", async () => {
    const { actor } = await setupProgram();
    const unrestricted = await listProposalPrograms(env.DB, actor, { limit: 25, offset: 0, sort: "eventName" });
    expect(unrestricted.programs).toHaveLength(1);
    expect(unrestricted.programs[0].access).toMatchObject({ canRead: true, canReview: false });

    const restricted = await listProposalPrograms(
      env.DB,
      { ...actor, scopeRestricted: true, scopes: [] },
      {
        limit: 25,
        offset: 0,
        sort: "eventName",
      },
    );
    expect(restricted).toEqual({ programs: [], total: 0 });

    const allowed = await listProposalPrograms(
      env.DB,
      { ...actor, scopeRestricted: true, scopes: ["proposals:read"] },
      { limit: 25, offset: 0, sort: "eventName" },
    );
    expect(allowed.programs).toHaveLength(1);
    expect(allowed.programs[0].access.canRead).toBe(true);
  });

  it("keeps the proposal-program page and count query explainable", async () => {
    const { actor } = await setupProgram();
    const query = buildProposalProgramsPageQuery(actor, { limit: 25, offset: 0, sort: "eventName" });
    expect(query).not.toBeNull();
    const { pageSql, countSql, bindings, countBindings } = buildOffsetPageSql(query!);
    const pagePlan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${pageSql}`)
      .bind(...bindings, 25, 0)
      .all();
    const countPlan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${countSql}`)
      .bind(...countBindings)
      .all();
    const queryPlanDetails = (plan: { results?: unknown[] }) =>
      (plan.results ?? []).map((row) => String((row as { detail?: unknown }).detail ?? "")).join("\n");
    const pageDetails = queryPlanDetails(pagePlan);
    const countDetails = queryPlanDetails(countPlan);
    expect(countSql).not.toContain("event_permissions_json");
    expect(countSql).not.toContain("can_edit_accepted_abstract");
    expect(countDetails).not.toMatch(/USE TEMP B-TREE/);
    expect(countDetails).toMatch(/(?:idx_events_owner_group|events)/i);
    expect(pageDetails).toMatch(/(?:idx_events_owner_group|events)/i);
  });
});
