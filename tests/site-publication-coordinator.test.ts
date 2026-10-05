import { sha256Hex } from "../functions/_lib/utils/crypto";
import { config, buildId, versionId, queue, uploaded, activationFetcher } from "./helpers/site-publication-coordinator";
import {
  recoverFailedPublicationBuild,
  completePublicationMachineBuild,
  activatePublicationAttempt,
  confirmPublicationActivation,
} from "../functions/_lib/services/site-publication-activation";
import { publicationIntegrityHashInput } from "../assets/shared/schemas/site-publication-release";
import { personalAgendaResponseSchema } from "../assets/shared/schemas/event-personal-agenda";
import { sessionParticipationRequestSchema } from "../assets/shared/schemas/event-participation-scanning";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import {
  prepareSitePublicationRequest,
  getSitePublicationDelivery,
} from "../functions/_lib/services/site-publication-requests";
import {
  claimPublicationDispatch,
  dispatchPublicationAttempt,
  attestPublicationMachineBuild,
  readPublicationAttempt,
} from "../functions/_lib/services/site-publication-coordinator";
import { agendaSnapshotSchema, type AgendaSnapshot } from "../assets/shared/schemas/event-agenda";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { insertIndividualMember, insertUser } from "./helpers/membership";
import { staffingFixture } from "./helpers/agenda-staffing";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { nowIso } from "../functions/_lib/utils/time";
import { processSitePublicationDispatch } from "../functions/_lib/services/site-publication-dispatch";
beforeEach(resetDb);
describe("durable global publication fence", () => {
  it("is disabled by default and serializes concurrent global claims", async () => {
    await queue();
    expect(await processSitePublicationDispatch(env.DB, { ...config, enabled: false }, "token")).toEqual({
      state: "disabled",
    });
    const attempt = await claimPublicationDispatch(env.DB, config);
    expect(attempt).not.toBeNull();
    expect(await claimPublicationDispatch(env.DB, config)).toBeNull();
    await expect(
      env.DB.prepare("UPDATE site_publication_provider_attempts SET source_sequence=99 WHERE id=?")
        .bind(attempt!.id)
        .run(),
    ).rejects.toThrow("PUBLICATION_ATTEMPT_IDENTITY_IMMUTABLE");
  });
  it("persists uncertainty before POST and never retries after timeout or restart", async () => {
    await queue();
    const attempt = (await claimPublicationDispatch(env.DB, config))!;
    const fetcher = vi.fn(async () => {
      expect((await readPublicationAttempt(env.DB, attempt.id))?.phase).toBe("uncertain");
      throw new Error("token secret");
    });
    await expect(dispatchPublicationAttempt(env.DB, attempt, "token", fetcher)).rejects.toMatchObject({
      code: "PROVIDER_WRITE_UNCERTAIN",
    });
    expect(await claimPublicationDispatch(env.DB, config, new Date(Date.now() + 86400000))).toBeNull();
    await dispatchPublicationAttempt(env.DB, attempt, "token", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retains the last good release after a rejected full repair and delays its bounded retry", async () => {
    const { attempt: delivered, release } = await uploaded();
    const provider = activationFetcher(release);
    await activatePublicationAttempt(env.DB, config, delivered.id, "token", provider);
    await confirmPublicationActivation(env.DB, config, delivered.id, "token", provider);
    const before = await getSitePublicationDelivery(env.DB);
    const [owned] = await queryAll<{ resource_id: string; revision: number }>(
      env.DB,
      "SELECT resource_id,revision FROM site_publication_requests WHERE id=?",
      [delivered.requestId],
    );
    await env.DB.batch([
      prepareSitePublicationRequest(env.DB, {
        resourceType: "event_agenda",
        resourceId: owned!.resource_id,
        revision: owned!.revision,
        reasonCode: "repair",
        deduplicationKey: "repair:full:86400:99999",
      }),
    ]);
    const attempt = (await claimPublicationDispatch(env.DB, config))!;
    await expect(
      dispatchPublicationAttempt(env.DB, attempt, "token", async () => new Response("private", { status: 403 })),
    ).rejects.toMatchObject({ code: "PROVIDER_REJECTED" });
    expect((await readPublicationAttempt(env.DB, attempt.id))?.phase).toBe("failed");
    expect(await getSitePublicationDelivery(env.DB)).toEqual({ ...before, desiredSequence: attempt.sourceSequence });
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_activation_receipts")).toHaveLength(1);
    expect(await claimPublicationDispatch(env.DB, config)).toBeNull();
    expect(await claimPublicationDispatch(env.DB, config, new Date(Date.now() + 61000))).not.toBeNull();
  });
  it("rejects a machine handshake after a newer request supersedes its source", async () => {
    const eventId = await queue();
    const attempt = (await claimPublicationDispatch(env.DB, config))!;
    await dispatchPublicationAttempt(env.DB, attempt, "token", async () =>
      Response.json({ success: true, result: { build_uuid: buildId } }),
    );
    await env.DB.batch([
      prepareSitePublicationRequest(env.DB, {
        resourceType: "event_agenda",
        resourceId: eventId,
        revision: 2,
        reasonCode: "rights_withdrawn",
        deduplicationKey: `agenda:${eventId}:2`,
      }),
    ]);
    const identity = {
      WORKERS_CI_BUILD_UUID: buildId,
      WORKERS_CI_BRANCH: "main",
      WORKERS_CI_COMMIT_SHA: config.provider.commitHash,
    };
    const fetcher = async () =>
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
      });
    await expect(attestPublicationMachineBuild(env.DB, attempt.id, identity, "token", fetcher)).rejects.toThrow(
      "AUTHORIZATION_CONTEXT_CHANGED",
    );
    expect((await readPublicationAttempt(env.DB, attempt.id))?.phase).toBe("building");
    expect(await claimPublicationDispatch(env.DB, config)).toBeNull();
  });
  it("binds an independently attested running build to the current source highwater without delivery", async () => {
    await queue();
    const attempt = (await claimPublicationDispatch(env.DB, config))!;
    await dispatchPublicationAttempt(env.DB, attempt, "token", async () =>
      Response.json({ success: true, result: { build_uuid: buildId } }),
    );
    const identity = {
      WORKERS_CI_BUILD_UUID: buildId,
      WORKERS_CI_BRANCH: "main",
      WORKERS_CI_COMMIT_SHA: config.provider.commitHash,
    };
    const fetcher = async () =>
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
      });
    expect(await attestPublicationMachineBuild(env.DB, attempt.id, identity, "token", fetcher)).toEqual({
      attemptId: attempt.id,
      sourceSequence: attempt.sourceSequence,
      buildId,
    });
    const [delivery] = await queryAll<{ delivered_sequence: number }>(
      env.DB,
      "SELECT delivered_sequence FROM site_publication_delivery_state WHERE id=1",
    );
    expect(delivery?.delivered_sequence).toBe(0);
    expect((await readPublicationAttempt(env.DB, attempt.id))?.phase).toBe("build_attested");
  });
});

describe("native complete release activation", () => {
  it("records full Worker evidence and delivers only after independent100percent/live matching receipts", async () => {
    const { attempt, release } = await uploaded();
    const fetcher = activationFetcher(release);
    expect((await activatePublicationAttempt(env.DB, config, attempt.id, "token", fetcher)).state).toBe(
      "awaiting_receipt",
    );
    const [before] = await queryAll<{ delivered_sequence: number }>(
      env.DB,
      "SELECT delivered_sequence FROM site_publication_delivery_state",
    );
    expect(before?.delivered_sequence).toBe(0);
    expect((await confirmPublicationActivation(env.DB, config, attempt.id, "token", fetcher)).state).toBe("delivered");
    expect(fetcher.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
    const [evidence] = await queryAll<{ worker_bundle_sha256: string }>(
      env.DB,
      "SELECT worker_bundle_sha256 FROM site_publication_attempt_releases",
    );
    expect(evidence?.worker_bundle_sha256).toBe("c".repeat(64));
    expect(await claimPublicationDispatch(env.DB, config)).toBeNull();
  });
  it("never retries an uncertain activation and accepts only subsequent independently confirmed receipt", async () => {
    const { attempt, release } = await uploaded();
    const fetcher = activationFetcher(release, true);
    await expect(activatePublicationAttempt(env.DB, config, attempt.id, "token", fetcher)).rejects.toMatchObject({
      code: "PROVIDER_WRITE_UNCERTAIN",
    });
    expect((await activatePublicationAttempt(env.DB, config, attempt.id, "token", fetcher)).state).toBe(
      "authority_changed",
    );
    expect(fetcher.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
    await expect(
      confirmPublicationActivation(env.DB, config, attempt.id, "token", activationFetcher(release, false, true)),
    ).rejects.toThrow("PUBLICATION_ACTIVE_VERSION_UNCONFIRMED");
    expect(await claimPublicationDispatch(env.DB, config, new Date(Date.now() + 86400000))).toBeNull();
    expect(
      (await confirmPublicationActivation(env.DB, config, attempt.id, "token", activationFetcher(release))).state,
    ).toBe("delivered");
  });
  it("refuses stale source activation and live release mismatch without releasing its fence", async () => {
    const { attempt, release } = await uploaded();
    const fetcher = activationFetcher(release);
    await activatePublicationAttempt(env.DB, config, attempt.id, "token", fetcher);
    await expect(
      confirmPublicationActivation(
        env.DB,
        config,
        attempt.id,
        "token",
        activationFetcher({ ...release, sourceSequence: release.sourceSequence! + 1 }),
      ),
    ).rejects.toThrow("PUBLICATION_LIVE_RELEASE_MISMATCH");
    expect((await readPublicationAttempt(env.DB, attempt.id))?.phase).toBe("activating");
  });
});

async function approvedActivationAgenda(standaloneStaff = false) {
  const person = await insertIndividualMember(env.DB);
  const staff = await insertUser(env.DB);
  let eventId = "",
    firstId = "",
    secondId = "",
    token = "";
  let approved!: AgendaSnapshot;
  let revision = 0;
  const command = async (path: string, body: unknown, method = "POST") => {
    const response = await callApi(env, `/api/v1/events/pqc-2026/agenda${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const snapshot = agendaSnapshotSchema.parse(await response.json());
    revision = snapshot.revision;
    return snapshot;
  };
  const uploadedRelease = await uploaded(async (id) => {
    eventId = id;
    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'"))[0]!.id;
    token = await createAdminSession(env.DB, admin, crypto.randomUUID());
    await env.DB.prepare("UPDATE events SET visibility='public',capacity_in_person=10 WHERE id=?").bind(id).run();
    for (const [index, title] of ["Approved session", "Parallel session"].entries()) {
      const snapshot = await command("/occurrences", {
        expectedRevision: revision,
        title,
        description:
          "Approved certificate operations and lifecycle management with a substantive public session abstract.",
        startAt: "2026-12-01T09:00:00.000Z",
        endAt: "2026-12-01T10:00:00.000Z",
        roomId: null,
        capacity: 3,
        remoteCapacity: 3,
        admissionPolicy: "reservation",
        speakerUserIds: index === 0 ? [person.userId] : [],
      });
      const occurrenceId = snapshot.occurrences.find((item) => item.title === title)!.id;
      if (index === 0) firstId = occurrenceId;
      else secondId = occurrenceId;
    }
    await command(`/occurrences/${firstId}/history`, {
      expectedRevision: revision,
      history: {
        appearances: [
          {
            userId: person.userId,
            actingIdentityId: person.identityId,
            displayName: "Approved speaker",
            organizationName: null,
            jobTitle: null,
            biography: "",
            photoUrl: null,
            approvedAt: nowIso(),
          },
        ],
      },
    });
    await command(
      "/staffing",
      staffingFixture({
        expectedRevision: revision,
        blocks: [
          {
            id: "operations",
            name: "Operations duty",
            startAt: standaloneStaff ? "2026-12-01T08:00:00.000Z" : "2026-12-01T09:00:00.000Z",
            endAt: standaloneStaff ? "2026-12-01T09:00:00.000Z" : "2026-12-01T10:00:00.000Z",
            roomId: null,
            roles: ["operator"],
          },
        ],
        roleMembers: [
          {
            userId: staff,
            displayName: "Operations staff",
            roles: ["operator"],
            availableFrom: null,
            availableUntil: null,
            maxMinutes: null,
          },
        ],
        assignments: [{ blockId: "operations", role: "operator", userId: staff, pinned: true }],
      }),
    );
    approved = await command("/publications", { expectedRevision: revision });
  });
  const reservation = async (occurrenceId: string, userId?: string) => {
    const owner = userId ?? (await insertUser(env.DB));
    await env.DB.prepare(
      "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at) VALUES(?,?,?,?,'physical','reserved',?,?)",
    )
      .bind(crypto.randomUUID(), eventId, occurrenceId, owner, nowIso(), nowIso())
      .run();
    return owner;
  };
  return { ...uploadedRelease, ...person, eventId, firstId, secondId, staff, approved, command, reservation };
}
async function activationState() {
  return Promise.all(
    [
      "site_publication_delivery_state",
      "site_publication_requests",
      "site_publication_provider_attempts",
      "site_publication_pipeline_fence",
      "site_publication_attempt_activation",
      "site_publication_activation_receipts",
      "site_publication_machine_evidence",
      "agenda_session_participations",
      "agenda_session_holds",
      "agenda_calendar_entries",
      "event_agenda_state",
      "event_agenda_publications",
      "event_agenda_session_history",
      "event_agenda_operational_people",
      "event_agenda_operational_days",
      "audit_log",
      "email_outbox",
    ].map((table) => queryAll(env.DB, `SELECT * FROM ${table} ORDER BY rowid`)),
  );
}
async function assertActivationRefused(
  fixture: Awaited<ReturnType<typeof approvedActivationAgenda>>,
  mutate?: () => Promise<unknown>,
  preflightIdentity = false,
) {
  let expected = await activationState();
  const db = mutate
    ? mutateBeforeNextBatch(env.DB, async () => {
        await mutate();
        expected = await activationState();
      })
    : env.DB;
  const fetcher = activationFetcher(fixture.release);
  const result = expect(activatePublicationAttempt(db, config, fixture.attempt.id, "token", fetcher)).rejects;
  if (preflightIdentity) await result.toMatchObject({ code: "AGENDA_REPRESENTATION_IDENTITY_UNAVAILABLE" });
  else await result.toThrow("AUTHORIZATION_CONTEXT_CHANGED");
  expect(fetcher.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(0);
  expect(await activationState()).toEqual(expected);
  expect((await readPublicationAttempt(env.DB, fixture.attempt.id))?.phase).toBe("awaiting_activation");
}
describe("approved agenda constraint guards at provider activation", () => {
  it("preserves the approved basis with unapproved draft edits and a later legal booking", async () => {
    const fixture = await approvedActivationAgenda();
    await fixture.command(
      `/occurrences/${fixture.firstId}`,
      { expectedRevision: fixture.approved.revision, title: "Unapproved title", capacity: 4 },
      "PATCH",
    );
    const attendee = await insertIndividualMember(env.DB);
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(crypto.randomUUID(), fixture.eventId, attendee.userId, crypto.randomUUID(), nowIso(), nowIso())
      .run();
    const token = await createAdminSession(env.DB, attendee.userId, crypto.randomUUID());
    const displayed = await callApi(
      env,
      `/api/v1/events/pqc-2026/agenda/participation?occurrenceId=${fixture.firstId}&limit=1`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(displayed.status, await displayed.clone().text()).toBe(200);
    const [shown] = personalAgendaResponseSchema.parse(await displayed.json()).sessions;
    expect(shown?.id).toBe(fixture.firstId);
    expect(shown?.publishedRevision).toBe(fixture.approved.publishedRevision);
    const reserved = await callApi(env, `/api/v1/events/pqc-2026/agenda/${fixture.firstId}/participation`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(
        sessionParticipationRequestSchema.parse({
          action: "reserve",
          attendanceMode: "physical",
          expectedPublishedRevision: shown!.publishedRevision,
        }),
      ),
    });
    expect(reserved.status, await reserved.clone().text()).toBe(200);
    expect(await reserved.json()).toMatchObject({ status: "reserved" });
    const before = await queryAll(env.DB, "SELECT * FROM agenda_session_participations ORDER BY id");
    const fetcher = activationFetcher(fixture.release);
    expect((await activatePublicationAttempt(env.DB, config, fixture.attempt.id, "token", fetcher)).state).toBe(
      "awaiting_receipt",
    );
    expect(fetcher.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
    expect(await queryAll(env.DB, "SELECT * FROM agenda_session_participations ORDER BY id")).toEqual(before);
    const [published] = await queryAll<{ snapshot_json: string }>(
      env.DB,
      "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=? AND revision=?",
      fixture.eventId,
      fixture.approved.publishedRevision,
    );
    expect(agendaSnapshotSchema.parse(JSON.parse(published!.snapshot_json)).occurrences[0]!.title).not.toBe(
      "Unapproved title",
    );
  });
  it.each(["blocked_at", "ended_at"] as const)(
    "refuses a selected identity with changed %s before activation",
    async (column) => {
      const fixture = await approvedActivationAgenda();
      const at = nowIso();
      await env.DB.prepare(
        column === "blocked_at"
          ? "UPDATE identities SET ended_at=?,blocked_at=? WHERE id=?"
          : "UPDATE identities SET ended_at=? WHERE id=?",
      )
        .bind(...(column === "blocked_at" ? [at, at, fixture.identityId] : [at, fixture.identityId]))
        .run();
      await assertActivationRefused(fixture, undefined, true);
    },
  );
  it("rolls back intent and provider effects when identity validity changes in the final batch", async () => {
    const fixture = await approvedActivationAgenda();
    await assertActivationRefused(fixture, () =>
      env.DB.prepare("UPDATE identities SET ended_at=?,blocked_at=? WHERE id=?")
        .bind(nowIso(), nowIso(), fixture.identityId)
        .run(),
    );
  });
  it("refuses an approved snapshot replacement between preparation and intent without using the new draft", async () => {
    const fixture = await approvedActivationAgenda();
    await assertActivationRefused(fixture, () =>
      env.DB.prepare(
        "UPDATE event_agenda_publications SET snapshot_json=json_set(snapshot_json,'$.occurrences[0].title','Concurrent replacement') WHERE event_id=? AND revision=?",
      )
        .bind(fixture.eventId, fixture.approved.publishedRevision)
        .run(),
    );
  });
  it("includes normalized operational staff when concurrent bookings would exceed approved capacity", async () => {
    const fixture = await approvedActivationAgenda();
    expect(
      await queryAll(
        env.DB,
        "SELECT user_id FROM event_agenda_operational_people WHERE event_id=? AND revision=? AND occurrence_id=? AND user_id=?",
        fixture.eventId,
        fixture.approved.publishedRevision,
        fixture.firstId,
        fixture.staff,
      ),
    ).toHaveLength(1);
    await fixture.reservation(fixture.firstId);
    await assertActivationRefused(fixture, () => fixture.reservation(fixture.firstId));
  });
  it("rechecks normalized standalone staff and current live event-day limits inside the intent batch", async () => {
    const fixture = await approvedActivationAgenda(true);
    expect(
      await queryAll(
        env.DB,
        "SELECT user_id FROM event_agenda_operational_people WHERE event_id=? AND revision=? AND user_id=?",
        fixture.eventId,
        fixture.approved.publishedRevision,
        fixture.staff,
      ),
    ).toHaveLength(0);
    expect(
      await queryAll(
        env.DB,
        "SELECT user_id FROM event_agenda_operational_days WHERE event_id=? AND revision=? AND user_id=?",
        fixture.eventId,
        fixture.approved.publishedRevision,
        fixture.staff,
      ),
    ).toHaveLength(1);
    await assertActivationRefused(fixture, () =>
      env.DB.prepare("UPDATE events SET capacity_in_person=1 WHERE id=?").bind(fixture.eventId).run(),
    );
  });
  it("rechecks current overlapping reservations without canceling either reservation", async () => {
    const fixture = await approvedActivationAgenda();
    const attendee = await fixture.reservation(fixture.firstId);
    await assertActivationRefused(fixture, () => fixture.reservation(fixture.secondId, attendee));
  });
});

describe("terminal build recovery", () => {
  it("releases a proven failed build and rejects late machine completion against the next desired release", async () => {
    const eventId = await queue();
    const attempt = (await claimPublicationDispatch(env.DB, config))!;
    await dispatchPublicationAttempt(env.DB, attempt, "token", async () =>
      Response.json({ success: true, result: { build_uuid: buildId } }),
    );
    await env.DB.prepare("UPDATE site_publication_provider_attempts SET phase='build_attested' WHERE id=?")
      .bind(attempt.id)
      .run();
    const fetcher = async () =>
      Response.json({
        success: true,
        result: {
          build_uuid: buildId,
          status: "stopped",
          build_outcome: "fail",
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
      });
    expect((await recoverFailedPublicationBuild(env.DB, config, attempt.id, "token", fetcher)).state).toBe(
      "failed_retry_scheduled",
    );
    await env.DB.batch([
      prepareSitePublicationRequest(env.DB, {
        resourceType: "event_agenda",
        resourceId: eventId,
        revision: 2,
        reasonCode: "rights_withdrawn",
        deduplicationKey: `agenda:${eventId}:2`,
      }),
    ]);
    const newest = (await claimPublicationDispatch(env.DB, config))!;
    expect(newest.sourceSequence).toBeGreaterThan(attempt.sourceSequence);
    const files = { "index.html": { sha256: "a".repeat(64), bytes: 12 } };
    const release = {
      version: 1,
      source: "native",
      environment: "production",
      sourceSequence: attempt.sourceSequence,
      snapshotId: "b".repeat(64),
      integrity: { algorithm: "sha256", digest: await sha256Hex(publicationIntegrityHashInput(files)), files },
      files: ["index.html"],
    };
    await expect(
      completePublicationMachineBuild(
        env.DB,
        { identityType: "native_build_machine", attemptId: attempt.id, buildId },
        { release, versionId, workerBundleSha256: "c".repeat(64) },
      ),
    ).rejects.toThrow("PUBLICATION_BUILD_AUTHORITY_CHANGED");
    expect((await readPublicationAttempt(env.DB, newest.id))?.phase).toBe("dispatching");
    expect(await queryAll(env.DB, "SELECT * FROM site_publication_attempt_releases")).toHaveLength(0);
  });
  it("holds a successful abandoned build and never inspects an unknown POST or activation as a failed build", async () => {
    const { attempt } = await uploaded();
    const fetcher = vi.fn(async () => {
      throw new Error("must not inspect activation");
    });
    expect((await recoverFailedPublicationBuild(env.DB, config, attempt.id, "token", fetcher)).state).toBe("fenced");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
