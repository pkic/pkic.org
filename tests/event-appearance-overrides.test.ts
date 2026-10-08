import { buildCreateIndividualMemberStatements } from "../functions/_lib/services/membership/memberships";
import { grantAdministrator } from "./helpers/administrator";
import { beforeEach, describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import {
  requestAppearanceOverride,
  reviewAppearanceOverride,
} from "../functions/_lib/services/event-agenda/appearance-overrides";
import { appearanceOverrideRequestSchema } from "../assets/shared/schemas/event-appearance-overrides";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
const eventId = crypto.randomUUID(),
  occurrenceId = crypto.randomUUID(),
  requester = crypto.randomUUID(),
  reviewer = crypto.randomUUID();
function input() {
  return appearanceOverrideRequestSchema.parse({
    expectedRevision: 0,
    reason: "Historical employer changed after the event",
    evidence: "Archived conference program confirms this organization",
    appearance: {
      userId: requester,
      actingIdentityId: null,
      displayName: "Synthetic historical speaker",
      organizationName: "Organization at the event",
      jobTitle: "Engineer at the event",
      biography: "The approved historical representation",
      photoUrl: null,
      approvedAt: "2026-01-01T00:00:00.000Z",
    },
  });
}
beforeEach(async () => {
  await resetDb();
  const now = new Date().toISOString();
  for (const id of [requester, reviewer]) {
    await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
      .bind(id, `${id}@example.test`, `${id}@example.test`)
      .run();
    await grantAdministrator(env.DB, id);
  }
  await env.DB.prepare(
    "INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at) VALUES(?,'override-test','Override','UTC','{}',?,?)",
  )
    .bind(eventId, now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,0,NULL,?)",
  )
    .bind(eventId, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at) VALUES(?,?,'Historical talk','2026-01-01T10:00:00.000Z','2026-01-01T11:00:00.000Z')",
  )
    .bind(occurrenceId, eventId)
    .run();
  await env.DB.prepare("INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id,role) VALUES(?,?,'speaker')")
    .bind(occurrenceId, requester)
    .run();
});
describe("independently approved historical representation", () => {
  it("records requester and distinct reviewer then changes only the draft", async () => {
    const requested = await requestAppearanceOverride(env.DB, eventId, occurrenceId, input(), requester);
    await expect(
      reviewAppearanceOverride(
        env.DB,
        eventId,
        "override-test",
        occurrenceId,
        requested.id,
        { expectedRevision: 0, decision: "approved", reason: "Reviewed against the archived conference program" },
        requester,
      ),
    ).rejects.toMatchObject({ code: "APPEARANCE_OVERRIDE_SELF_REVIEW" });
    const result = await reviewAppearanceOverride(
      env.DB,
      eventId,
      "override-test",
      occurrenceId,
      requested.id,
      { expectedRevision: 0, decision: "approved", reason: "Reviewed against the archived conference program" },
      reviewer,
    );
    expect(result.override).toMatchObject({ requestedBy: requester, reviewedBy: reviewer, decision: "approved" });
    expect(result.agenda.publishedRevision).toBeNull();
    expect(result.agenda.occurrences[0]!.history!.appearances[0]).toMatchObject({
      userId: requester,
      organizationName: "Organization at the event",
    });
    await expect(
      env.DB.prepare("UPDATE event_agenda_appearance_override_decisions SET reason='changed'").run(),
    ).rejects.toThrow("immutable");
  });
  it("rejects foreign and out-of-date identities without weakening the original identity rule", async () => {
    const value = input();
    const valid = crypto.randomUUID(),
      foreign = crypto.randomUUID(),
      ended = crypto.randomUUID();
    for (const owner of [requester, reviewer]) {
      const aggregate = buildCreateIndividualMemberStatements(env.DB, owner, "H6", "2025-01-01T00:00:00.000Z");
      await env.DB.batch(aggregate.statements);
    }
    for (const [id, owner, end] of [
      [valid, requester, null],
      [foreign, reviewer, null],
      [ended, requester, "2025-12-31T00:00:00.000Z"],
    ] as const)
      await env.DB.prepare(
        "INSERT INTO identities(id,user_id,source,show_on_organization_profile,invited_at,started_at,ended_at,created_at,updated_at) VALUES(?,?,'staff',0,'2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z',?,'2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z')",
      )
        .bind(id, owner, end)
        .run();
    for (const invalid of [foreign, ended]) {
      value.appearance.actingIdentityId = invalid;
      await expect(requestAppearanceOverride(env.DB, eventId, occurrenceId, value, requester)).rejects.toMatchObject({
        code: "APPEARANCE_OVERRIDE_IDENTITY_INVALID",
      });
    }
    value.appearance.actingIdentityId = crypto.randomUUID();
    await expect(requestAppearanceOverride(env.DB, eventId, occurrenceId, value, requester)).rejects.toMatchObject({
      code: "APPEARANCE_OVERRIDE_IDENTITY_INVALID",
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_appearance_override_requests").first(),
    ).toMatchObject({ count: 0 });
    value.appearance.actingIdentityId = valid;
    expect(await requestAppearanceOverride(env.DB, eventId, occurrenceId, value, requester)).toMatchObject({
      appearance: { actingIdentityId: valid, userId: requester },
    });
  });
  it("records rejection without altering history and refuses stale representation approval", async () => {
    const requested = await requestAppearanceOverride(env.DB, eventId, occurrenceId, input(), requester);
    const result = await reviewAppearanceOverride(
      env.DB,
      eventId,
      "override-test",
      occurrenceId,
      requested.id,
      {
        expectedRevision: 0,
        decision: "rejected",
        reason: "Historical evidence does not establish the proposed representation",
      },
      reviewer,
    );
    expect(result.agenda.occurrences[0]!.history).toBeUndefined();
    expect(result.override.decision).toBe("rejected");
    const value = input();
    value.expectedRevision = 1;
    const pending = await requestAppearanceOverride(env.DB, eventId, occurrenceId, value, requester);
    await env.DB.prepare(
      "INSERT INTO event_agenda_session_history(occurrence_id,metadata_json,updated_by,updated_at) VALUES(?,?,?,?)",
    )
      .bind(
        occurrenceId,
        JSON.stringify({ appearances: [{ ...value.appearance, organizationName: "A later correction" }] }),
        requester,
        new Date().toISOString(),
      )
      .run();
    await expect(
      reviewAppearanceOverride(
        env.DB,
        eventId,
        "override-test",
        occurrenceId,
        pending.id,
        { expectedRevision: 1, decision: "approved", reason: "Reviewed against the archived conference program" },
        reviewer,
      ),
    ).rejects.toMatchObject({ code: "APPEARANCE_OVERRIDE_STALE" });
  });
  it("requires scoped approval authority on the mounted route", async () => {
    const token = await createAdminSession(env.DB, requester, "override-route"),
      headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const base = `/api/v1/events/override-test/agenda/occurrences/${occurrenceId}/appearance-overrides`;
    const request = await callApi(env, base, { method: "POST", headers, body: JSON.stringify(input()) });
    expect(request.status).toBe(200);
    const requested = (await request.json()) as { id: string };
    const approval = await callApi(env, `${base}/${requested.id}/decisions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        expectedRevision: 0,
        decision: "approved",
        reason: "Reviewed against the archived conference program",
      }),
    });
    expect(approval.status).toBe(403);
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=? AND role_id='role-admin'")
      .bind(new Date().toISOString(), reviewer)
      .run();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:read','event',?,?)",
    )
      .bind(crypto.randomUUID(), reviewer, eventId, new Date().toISOString())
      .run();
    const unscopedToken = await createAdminSession(env.DB, reviewer, "override-no-scope");
    const unscoped = await callApi(env, `${base}/${requested.id}/decisions`, {
      method: "POST",
      headers: { authorization: `Bearer ${unscopedToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 0,
        decision: "approved",
        reason: "Reviewed against the archived conference program",
      }),
    });
    expect(unscoped.status).toBe(403);
    const list = await callApi(env, base, { headers });
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ canReview: true });
  });
});
