import { administratorGrants } from "./helpers/administrator";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  agendaOccurrenceCreateSchema,
  agendaSnapshotSchema,
  type AgendaSnapshot,
} from "../assets/shared/schemas/event-agenda";
import { SITE_PUBLICATION_FULL_REPAIR_PREFIX } from "../assets/shared/schemas/site-publication-coordinator";
import { PUBLIC_AGENDA_CANCELLATION_DAYS } from "../assets/shared/schemas/site-agenda-calendar";
import type { AuthAdmin } from "../functions/_lib/types";
import { nowIso } from "../functions/_lib/utils/time";
import { createAgendaOccurrence } from "../functions/_lib/services/event-agenda/mutations";
import { readPublicAgendaCalendars } from "../functions/_lib/services/site-publication-agenda-calendars";
import {
  publicAgendaCalendarPages,
  publicSessionCalendarPages,
} from "../functions/_lib/services/site-agenda-calendar-pages";
import { sitePublicationSnapshotSchema } from "../assets/shared/schemas/site-publication";
import { runSitePublicationPipeline } from "../functions/_lib/services/site-publication-runtime";
import {
  reconcileSitePublication,
  readOwnedPublicationRepairMode,
} from "../functions/_lib/services/site-publication-reconciliation";
import {
  prepareSitePublicationRequest,
  recordSitePublicationBuild,
  recordSitePublicationActivation,
  getSitePublicationDelivery,
} from "../functions/_lib/services/site-publication-requests";
import {
  claimPublicationDispatch,
  dispatchPublicationAttempt,
  attestPublicationMachineBuild,
} from "../functions/_lib/services/site-publication-coordinator";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { config, buildId } from "./helpers/site-publication-coordinator";
import { seedPersona } from "./personas/seed";

const at = "2026-10-05T12:00:00.000Z";
async function storeApproval(eventId: string, actor: AuthAdmin, source: AgendaSnapshot) {
  const approval = agendaSnapshotSchema.parse(source);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,?,?,?,?)",
    ).bind(crypto.randomUUID(), eventId, approval.revision, JSON.stringify(approval), actor.id, approval.approvedAt),
    env.DB.prepare(
      "INSERT INTO event_agenda_state(event_id,revision,published_revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET revision=excluded.revision,published_revision=excluded.published_revision",
    ).bind(eventId, approval.revision, approval.revision, nowIso()),
  ]);
  return approval;
}
/** Explicitly seed the missed-intent condition; no HTTP approval or provider delivery is claimed by this builder. */
async function fixture(count = 1) {
  const { eventId } = await seedEventAndAdmin(env.DB);
  await env.DB.prepare("UPDATE events SET visibility='public' WHERE id=?").bind(eventId).run();
  const [user] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
  const actor: AuthAdmin = {
    identityType: "user",
    id: user!.id,
    email: "admin@pkic.org",
    grants: administratorGrants,
  };
  const draft = await createAgendaOccurrence(
    env.DB,
    eventId,
    "pqc-2026",
    agendaOccurrenceCreateSchema.parse({
      expectedRevision: 0,
      title: "Repair calendar session",
      startAt: "2026-12-01T09:00:00.000Z",
      endAt: "2026-12-01T10:00:00.000Z",
      roomId: null,
    }),
  );
  const approval = await storeApproval(eventId, actor, {
    ...draft,
    revision: 2,
    publishedRevision: 2,
    approvedAt: "2026-10-01T00:00:00.000Z",
    calendarPublic: true,
  });
  const eventIds = [eventId];
  for (let index = 1; index < count; index++) {
    const id = crypto.randomUUID(),
      slug = `repair-${index}`;
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at) VALUES(?,?,?,'Europe/Amsterdam','{}',?,?)",
    )
      .bind(id, slug, `Synthetic repair event ${index}`, nowIso(), nowIso())
      .run();
    await storeApproval(id, actor, { ...approval, eventSlug: slug, occurrences: [] });
    eventIds.push(id);
  }
  return { eventId, eventIds, actor, approval };
}
async function requests() {
  return queryAll<{ id: string; sequence: number; resource_id: string; revision: number; deduplication_key: string }>(
    env.DB,
    "SELECT id,sequence,resource_id,revision,deduplication_key FROM site_publication_requests ORDER BY sequence",
  );
}
async function untouchedEffects() {
  return Promise.all([
    queryAll(env.DB, "SELECT id,action,details_json FROM audit_log ORDER BY id"),
    queryAll(env.DB, "SELECT id,payload_json,status FROM email_outbox ORDER BY id"),
    queryAll(env.DB, "SELECT id,status FROM agenda_session_participations ORDER BY id"),
  ]);
}
/** Use the existing trusted activation adapter to finish fixture requests; never silently advance its highwater. */
async function acknowledge(actor: AuthAdmin) {
  const row = (await requests()).at(-1)!;
  const before = await getSitePublicationDelivery(env.DB);
  const leaseToken = crypto.randomUUID(),
    build = crypto.randomUUID(),
    snapshotId = "a".repeat(64);
  await env.DB.prepare(
    "UPDATE site_publication_requests SET status='rendering',lease_token=?,lease_expires_at=? WHERE id=?",
  )
    .bind(leaseToken, new Date(Date.now() + 60000).toISOString(), row.id)
    .run();
  const input = { requestId: row.id, sourceSequence: row.sequence, snapshotId, buildId: build, releaseId: build };
  await recordSitePublicationBuild(env.DB, actor, { ...input, leaseToken });
  await recordSitePublicationActivation(env.DB, actor, {
    ...input,
    expectedDeliveredSequence: before.deliveredSequence,
    activationReceiptId: crypto.randomUUID(),
    activatedAt: nowIso(),
  });
}
async function attested() {
  const attempt = (await claimPublicationDispatch(env.DB, config))!;
  expect(attempt).not.toBeNull();
  await dispatchPublicationAttempt(env.DB, attempt, "token", async () =>
    Response.json({ success: true, result: { build_uuid: buildId } }),
  );
  await attestPublicationMachineBuild(
    env.DB,
    attempt.id,
    {
      WORKERS_CI_BUILD_UUID: buildId,
      WORKERS_CI_BRANCH: "main",
      WORKERS_CI_COMMIT_SHA: config.provider.commitHash,
    },
    "token",
    async () =>
      Response.json({
        success: true,
        result: {
          build_uuid: buildId,
          status: "running",
          build_outcome: null,
          build_trigger_metadata: { branch: "main", commit_hash: config.provider.commitHash },
          trigger: {
            trigger_uuid: config.provider.triggerId,
            external_script_id: config.provider.workerTag,
            repo_connection: {
              repo_connection_uuid: config.provider.repoConnectionId,
              repo_id: "123",
              provider_account_id: "456",
            },
          },
        },
      }),
  );
  return attempt;
}
beforeEach(async () => {
  await resetDb();
  const timestamp = nowIso();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO site_publication_delivery_state(id,updated_at) VALUES(1,?)").bind(timestamp),
    env.DB.prepare("INSERT INTO site_publication_pipeline_fence(id,updated_at) VALUES(1,?)").bind(timestamp),
  ]);
});
describe("periodic publication repair", () => {
  it("queues exact missing approved intents once without replaying approval side effects", async () => {
    const value = await fixture();
    const effects = await untouchedEffects();
    expect(await reconcileSitePublication(env.DB, config, at)).toMatchObject({
      state: "approval_repairs_queued",
      candidatesChecked: 1,
      approvalRepairsQueued: 1,
      fullRepairQueued: false,
    });
    const captured = await requests();
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      resource_id: value.eventId,
      revision: value.approval.revision,
      deduplication_key: `repair:approval:${value.eventId}:${value.approval.revision}`,
    });
    expect((await getSitePublicationDelivery(env.DB)).desiredSequence).toBe(captured[0]!.sequence);
    expect((await reconcileSitePublication(env.DB, config, at)).state).toBe("delivery_pending");
    expect(await requests()).toEqual(captured);
    expect(await untouchedEffects()).toEqual(effects);
  });
  it("bounds a pass to25 gaps and progresses after existing delivery without a separate scan cursor", async () => {
    const value = await fixture(31);
    expect((await reconcileSitePublication(env.DB, config, at)).approvalRepairsQueued).toBe(25);
    const first = await requests();
    expect(new Set(first.map((row) => row.resource_id)).size).toBe(25);
    await acknowledge(value.actor);
    expect((await reconcileSitePublication(env.DB, config, at)).approvalRepairsQueued).toBe(6);
    const all = await requests();
    expect(all).toHaveLength(31);
    expect(new Set(all.map((row) => row.resource_id))).toEqual(new Set(value.eventIds));
  });
  it("never infers publication from a historical approval when the current pointer is null", async () => {
    const value = await fixture();
    await env.DB.prepare("UPDATE event_agenda_state SET published_revision=NULL WHERE event_id=?")
      .bind(value.eventId)
      .run();
    expect((await reconcileSitePublication(env.DB, config, at)).state).toBe("no_approved_agenda");
    expect(await requests()).toEqual([]);
  });
  it.each(["queued", "failed", "rendering", "awaiting_activation", "delivered", "obsolete"])(
    "preserves an existing%s intent and its attempt metadata",
    async (status) => {
      const value = await fixture();
      await env.DB.batch([
        prepareSitePublicationRequest(env.DB, {
          resourceType: "event_agenda",
          resourceId: value.eventId,
          revision: value.approval.revision,
          reasonCode: "agenda_approved",
          deduplicationKey: `agenda:${value.eventId}:${value.approval.revision}`,
        }),
      ]);
      await env.DB.prepare(
        "UPDATE site_publication_requests SET status=?,attempts=10,last_error_code='PROVIDER_UNAVAILABLE' WHERE resource_id=?",
      )
        .bind(status, value.eventId)
        .run();
      const before = await queryAll(env.DB, "SELECT id,status,attempts,last_error_code FROM site_publication_requests");
      expect((await reconcileSitePublication(env.DB, config, at)).state).toBe("delivery_pending");
      expect(
        await queryAll(env.DB, "SELECT id,status,attempts,last_error_code FROM site_publication_requests"),
      ).toEqual(before);
    },
  );
  it.each(["pointer", "snapshot"])("refuses an approved%s race atomically", async (change) => {
    const value = await fixture(),
      before = await getSitePublicationDelivery(env.DB),
      effects = await untouchedEffects();
    const raced = mutateBeforeNextBatch(env.DB, () =>
      change === "pointer"
        ? env.DB.prepare("UPDATE event_agenda_state SET published_revision=NULL WHERE event_id=?")
            .bind(value.eventId)
            .run()
        : env.DB.prepare(
            "UPDATE event_agenda_publications SET snapshot_json=json_set(snapshot_json,'$.eventName','Changed basis') WHERE event_id=?",
          )
            .bind(value.eventId)
            .run(),
    );
    expect((await reconcileSitePublication(raced, config, at)).state).toBe("authority_changed");
    expect(await requests()).toEqual([]);
    expect(await getSitePublicationDelivery(env.DB)).toEqual(before);
    expect(await untouchedEffects()).toEqual(effects);
  });
  it("allows unrelated draft edits while keeping the exact approved repair basis", async () => {
    const value = await fixture();
    const raced = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE event_agenda_state SET revision=revision+1 WHERE event_id=?").bind(value.eventId).run(),
    );
    expect((await reconcileSitePublication(raced, config, at)).approvalRepairsQueued).toBe(1);
    expect((await requests())[0]!.revision).toBe(value.approval.revision);
  });
  it("does not supersede a pending fence and rolls back if another request arrives after preflight", async () => {
    const value = await fixture();
    const raced = mutateBeforeNextBatch(env.DB, () =>
      env.DB.batch([
        prepareSitePublicationRequest(env.DB, {
          resourceType: "event_agenda",
          resourceId: value.eventId,
          revision: value.approval.revision,
          reasonCode: "agenda_approved",
          deduplicationKey: `agenda:${value.eventId}:${value.approval.revision}`,
        }),
      ]),
    );
    expect((await reconcileSitePublication(raced, config, at)).state).toBe("authority_changed");
    expect(await requests()).toHaveLength(1);
    const attempt = (await claimPublicationDispatch(env.DB, config))!;
    const before = await getSitePublicationDelivery(env.DB);
    expect((await reconcileSitePublication(env.DB, config, at)).state).toBe("delivery_pending");
    expect(await getSitePublicationDelivery(env.DB)).toEqual(before);
    expect(
      (await queryAll<{ attempt_id: string }>(env.DB, "SELECT attempt_id FROM site_publication_pipeline_fence"))[0]!
        .attempt_id,
    ).toBe(attempt.id);
  });
  it("uses one real former-public aggregate for periodic complete generation and expires minimal cancellations", async () => {
    const value = await fixture();
    const removedAt = "2026-10-02T00:00:00.000Z";
    await storeApproval(value.eventId, value.actor, {
      ...value.approval,
      revision: 3,
      publishedRevision: 3,
      approvedAt: removedAt,
      occurrences: [],
      calendarPublic: false,
    });
    await env.DB.prepare("UPDATE events SET visibility='invitation_only' WHERE id=?").bind(value.eventId).run();
    const expiry = Date.parse(removedAt) + PUBLIC_AGENDA_CANCELLATION_DAYS * 86400000;
    const before = new Date(expiry).toISOString(),
      after = new Date(expiry + 86400000 + 1).toISOString();
    await reconcileSitePublication(env.DB, config, before);
    await acknowledge(value.actor);
    const effects = await untouchedEffects();
    expect((await reconcileSitePublication(env.DB, config, before)).fullRepairQueued).toBe(true);
    const full = (await requests()).at(-1)!;
    expect(full.resource_id).toBe(value.eventId);
    expect(full.deduplication_key.startsWith(SITE_PUBLICATION_FULL_REPAIR_PREFIX)).toBe(true);
    expect((await readPublicAgendaCalendars(env.DB, before))["pqc-2026"]!.entries).toHaveLength(1);
    await acknowledge(value.actor);
    const count = (await requests()).length;
    expect((await reconcileSitePublication(env.DB, config, before)).state).toBe("up_to_date");
    expect(await requests()).toHaveLength(count);
    expect((await reconcileSitePublication(env.DB, config, after)).fullRepairQueued).toBe(true);
    const calendars = await readPublicAgendaCalendars(env.DB, after);
    expect(calendars["pqc-2026"]!.entries).toEqual([]);
    expect(calendars["pqc-2026"]!.agendaPath).toBe(value.approval.publicAgendaPath);
    const publication = sitePublicationSnapshotSchema.parse({
      version: 1,
      sourceSequence: null,
      snapshotId: "a".repeat(64),
      votes: [],
      publicResources: {},
      eventAgendaCalendars: calendars,
      members: [],
      groups: {},
      groupMembers: {},
      sponsors: {},
      memberWall: [],
      news: [],
      sponsorNews: [],
    });
    expect(publicSessionCalendarPages(publication)).toEqual([]);
    const feeds = publicAgendaCalendarPages(publication);
    expect(feeds).toHaveLength(1);
    expect(feeds[0]!.path).toBe(`${value.approval.publicAgendaPath}calendar.ics`);
    expect(feeds[0]!.content).not.toContain("BEGIN:VEVENT");
    expect(feeds[0]!.content).not.toContain("Repair calendar session");
    // The activation fixture adds its own audit, so compare repair-only effects after the most recent acknowledgement.
    expect((await untouchedEffects()).slice(1)).toEqual(effects.slice(1));
  });
  it("requires scheduler and domain grants, and refuses paused/disabled/unconfigured runs without repair", async () => {
    const value = await fixture();
    const runner = await seedPersona(env.DB, ["schedulerOperator"]);
    const endpoint = "/api/v1/scheduler/jobs/site_publication/runs";
    const effects = await untouchedEffects();
    for (const [token, status] of [
      [null, 401],
      [runner.token, 403],
    ] as const) {
      const response = await callApi(env, endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({}),
      });
      expect(response.status, await response.clone().text()).toBe(status);
    }
    const token = await createAdminSession(env.DB, value.actor.id, "repair-scheduler");
    await env.DB.prepare(
      "UPDATE scheduled_jobs SET paused_at=?,paused_reason='Fixture pause' WHERE job_key='site_publication'",
    )
      .bind(nowIso())
      .run();
    expect(
      (
        await callApi(env, endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(409);
    expect(await requests()).toEqual([]);
    expect(await untouchedEffects()).toEqual(effects);
    for (const disabled of [{ enabled: false }, { exclusiveActivationOwner: false }])
      expect(
        await runSitePublicationPipeline({
          ...env,
          SITE_PUBLICATION_COORDINATOR_CONFIG: JSON.stringify({ ...config, ...disabled }),
        }),
      ).toEqual({ state: "disabled" });
    await expect(
      runSitePublicationPipeline({
        ...env,
        SITE_PUBLICATION_COORDINATOR_CONFIG: JSON.stringify(config),
        SITE_PUBLICATION_PROVIDER_TOKEN: undefined,
      }),
    ).rejects.toThrow("PUBLICATION_PROVIDER_CREDENTIAL_UNAVAILABLE");
    expect(await requests()).toEqual([]);
  });
});
describe("owned native repair mode", () => {
  it("forces only covered undelivered full repair under exact independently attested machine ownership", async () => {
    const value = await fixture();
    await reconcileSitePublication(env.DB, config, at);
    await acknowledge(value.actor);
    await reconcileSitePublication(env.DB, config, at);
    const attempt = await attested();
    expect(await readOwnedPublicationRepairMode(env.DB, attempt, buildId)).toBe(true);
    await expect(readOwnedPublicationRepairMode(env.DB, attempt, crypto.randomUUID())).rejects.toThrow(
      "AUTHORIZATION_CONTEXT_CHANGED",
    );
    await expect(
      readOwnedPublicationRepairMode(env.DB, { ...attempt, leaseToken: crypto.randomUUID() }, buildId),
    ).rejects.toThrow("AUTHORIZATION_CONTEXT_CHANGED");
    const raced = mutateBeforeNextBatch(env.DB, () =>
      env.DB.batch([
        prepareSitePublicationRequest(env.DB, {
          resourceType: "event_agenda",
          resourceId: value.eventId,
          revision: value.approval.revision,
          reasonCode: "rights_withdrawn",
          deduplicationKey: `rights:${value.eventId}:later`,
        }),
      ]),
    );
    await expect(readOwnedPublicationRepairMode(raced, attempt, buildId)).rejects.toThrow(
      "AUTHORIZATION_CONTEXT_CHANGED",
    );
  });
  it("does not force missing-approval repair", async () => {
    const value = await fixture();
    await reconcileSitePublication(env.DB, config, at);
    const first = await attested();
    expect(await readOwnedPublicationRepairMode(env.DB, first, buildId)).toBe(false);
    // The existing global fence remains authoritative; this case does not fabricate delivery to escape it.
    expect((await reconcileSitePublication(env.DB, config, at)).state).toBe("delivery_pending");
    expect(await requests()).toHaveLength(1);
    expect((await requests())[0]!.resource_id).toBe(value.eventId);
  });
});

describe("delivered repair intent coverage", () => {
  it("does not reuse a force decision from an already-delivered periodic repair", async () => {
    const value = await fixture();
    await reconcileSitePublication(env.DB, config, at);
    await acknowledge(value.actor);
    expect((await reconcileSitePublication(env.DB, config, at)).fullRepairQueued).toBe(true);
    await acknowledge(value.actor);
    await env.DB.batch([
      prepareSitePublicationRequest(env.DB, {
        resourceType: "event_agenda",
        resourceId: value.eventId,
        revision: value.approval.revision,
        reasonCode: "rights_withdrawn",
        deduplicationKey: `rights:${value.eventId}:ordinary`,
      }),
    ]);
    expect(await readOwnedPublicationRepairMode(env.DB, await attested(), buildId)).toBe(false);
  });
});

describe("periodic repair compare-and-set", () => {
  it("deduplicates concurrent full-repair ticks in one immutable request tuple", async () => {
    const value = await fixture();
    await reconcileSitePublication(env.DB, config, at);
    await acknowledge(value.actor);
    const effects = await untouchedEffects();
    const outcomes = await Promise.all([
      reconcileSitePublication(env.DB, config, at),
      reconcileSitePublication(env.DB, config, at),
    ]);
    expect(outcomes.filter((outcome) => outcome.fullRepairQueued)).toHaveLength(1);
    expect(
      (await requests()).filter((row) => row.deduplication_key.startsWith(SITE_PUBLICATION_FULL_REPAIR_PREFIX)),
    ).toHaveLength(1);
    expect(await untouchedEffects()).toEqual(effects);
  });
  it("rejects changed periodic anchor authority without advancing its delivery highwater", async () => {
    const value = await fixture();
    await reconcileSitePublication(env.DB, config, at);
    await acknowledge(value.actor);
    const before = await getSitePublicationDelivery(env.DB),
      rows = await requests(),
      effects = await untouchedEffects();
    const raced = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE event_agenda_state SET published_revision=NULL WHERE event_id=?")
        .bind(value.eventId)
        .run(),
    );
    expect((await reconcileSitePublication(raced, config, at)).state).toBe("authority_changed");
    expect(await getSitePublicationDelivery(env.DB)).toEqual(before);
    expect(await requests()).toEqual(rows);
    expect(await untouchedEffects()).toEqual(effects);
  });
});
