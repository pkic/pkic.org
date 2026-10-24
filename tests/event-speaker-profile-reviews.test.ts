import {
  approveSpeakerProfile,
  prepareReviewedSpeakerProfilesRead,
} from "../functions/_lib/services/event-agenda/speaker-profile-reviews";
import type { DatabaseLike } from "../functions/_lib/types";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { addRepresentative, insertOrganization, seedOrganizationAggregate } from "./helpers/membership";
import { callApi } from "./helpers/app";
import { profileD1Flow } from "./helpers/d1-flow-profile";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { agendaAuthoringEffects } from "./helpers/agenda-authoring";
import { createAgendaOccurrence, patchAgendaOccurrence } from "../functions/_lib/services/event-agenda/mutations";
import { sessionHistoryMetadataSchema } from "../assets/shared/schemas/event-session-history";
import {
  agendaOccurrenceCreateSchema,
  agendaSnapshotSchema,
  type AgendaSnapshot,
} from "../assets/shared/schemas/event-agenda";
import {
  speakerProfileApprovalResponseSchema,
  speakerProfileReviewsResponseSchema,
} from "../assets/shared/schemas/event-speaker-profile-reviews";

beforeEach(resetDb);
async function fixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const userId = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<string>("id"))!;
  const organizationId = await insertOrganization(env.DB, "Speaker organization");
  const memberId = await seedOrganizationAggregate(env.DB, organizationId);
  const identityId = await addRepresentative(env.DB, memberId, userId, { jobTitle: "Researcher" });
  await env.DB.prepare(
    "UPDATE identities SET biography='Reviewed biography',updated_at='2026-10-01T10:00:00.000Z' WHERE id=?",
  )
    .bind(identityId)
    .run();
  await env.DB.prepare("UPDATE identities SET links_json=? WHERE id=?")
    .bind(JSON.stringify([{ label: "Profile", url: "https://example.org/speaker" }]), identityId)
    .run();
  let agenda: AgendaSnapshot = await createAgendaOccurrence(
    env.DB,
    eventId,
    "pqc-2026",
    agendaOccurrenceCreateSchema.parse({
      expectedRevision: 0,
      title: "First session",
      roomId: null,
      startAt: "2026-12-01T10:00:00.000Z",
      endAt: "2026-12-01T10:30:00.000Z",
      speakerUserIds: [userId],
      visibility: "public",
    }),
  );
  agenda = await createAgendaOccurrence(
    env.DB,
    eventId,
    "pqc-2026",
    agendaOccurrenceCreateSchema.parse({
      expectedRevision: agenda.revision,
      title: "Second session",
      roomId: null,
      startAt: "2026-12-01T11:00:00.000Z",
      endAt: "2026-12-01T11:30:00.000Z",
      speakerUserIds: [userId],
      visibility: "public",
    }),
  );
  const token = await createAdminSession(env.DB, userId, "speaker-review");
  const request = (path: string, body?: unknown, db: DatabaseLike = env.DB) =>
    callApi({ ...env, DB: db }, `/api/v1/events/pqc-2026${path}`, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  async function queue(status = "pending") {
    const response = await request(`/speakers/profiles?status=${status}&limit=10&offset=0`);
    expect(response.status, await response.clone().text()).toBe(200);
    return speakerProfileReviewsResponseSchema.parse(await response.json());
  }
  return { eventId, userId, identityId, agenda, request, queue };
}

describe("event speaker profile reviews", () => {
  it("loads more than one review page in a single prepared snapshot", async () => {
    const f = await fixture();
    const people = JSON.stringify(
      Array.from({ length: 101 }, () => ({ id: crypto.randomUUID(), identityId: crypto.randomUUID() })),
    );
    const at = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO users(id,email,normalized_email,first_name,last_name,active,created_at,updated_at)
        SELECT json_extract(value,'$.id'),json_extract(value,'$.id')||'@example.test',json_extract(value,'$.id')||'@example.test','Fixture','Speaker',1,?,? FROM json_each(?)`).bind(
        at,
        at,
        people,
      ),
      env.DB.prepare(`INSERT INTO identities(id,user_id,source,show_on_organization_profile,is_default,invited_at,started_at,created_at,updated_at)
        SELECT json_extract(value,'$.identityId'),json_extract(value,'$.id'),'staff',0,1,?,?,?,? FROM json_each(?)`).bind(
        at,
        at,
        at,
        at,
        people,
      ),
      env.DB.prepare(`INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id)
        SELECT ?,json_extract(value,'$.id') FROM json_each(?)`).bind(f.agenda.occurrences[0].id, people),
    ]);
    const profile = profileD1Flow(env.DB);
    const read = prepareReviewedSpeakerProfilesRead(profile.db, f.eventId);
    const loaded = await profile.db.batch(read.statements);
    expect(loaded[0].results).toHaveLength(102);
    await read.decode(loaded, f.eventId, f.agenda, false);
    expect((await profile.report()).roundTrips).toBe(1);
  });
  it("reviews one canonical profile for every session and publishes without presentation files", async () => {
    const f = await fixture();
    const pending = await f.queue();
    expect(pending.canReview).toBe(true);
    expect(pending.profiles).toHaveLength(1);
    expect(pending.profiles[0].sessionCount).toBe(2);
    expect(pending.profiles[0].links).toEqual(["https://example.org/speaker"]);
    const blockedProfile = profileD1Flow(env.DB);
    const blocked = await f.request("/agenda/publications", { expectedRevision: f.agenda.revision }, blockedProfile.db);
    expect(blocked.status).toBe(422);
    expect((await blockedProfile.report()).roundTrips).toBe(1);
    const profile = pending.profiles[0];
    const approved = await f.request("/speakers/profiles/reviews", {
      expectedRevision: f.agenda.revision,
      userId: profile.userId,
      identityId: profile.identityId,
      profileDigest: profile.profileDigest,
    });
    expect(approved.status, await approved.clone().text()).toBe(200);
    const result = speakerProfileApprovalResponseSchema.parse(await approved.json());
    expect((await f.queue()).page.total).toBe(0);
    const settings = await env.DB.prepare("SELECT settings_json FROM events WHERE id=?")
      .bind(f.eventId)
      .first<string>("settings_json");
    expect(settings).not.toContain("Reviewed biography");
    expect(result.agenda.occurrences.every((o) => !o.history?.appearances.length)).toBe(true);
    const publicationProfile = profileD1Flow(env.DB);
    const published = await f.request(
      "/agenda/publications",
      { expectedRevision: result.agenda.revision },
      publicationProfile.db,
    );
    expect(published.status, await published.clone().text()).toBe(200);
    // The reviewed projection feeds a second evidence snapshot before the atomic command; one-call work remains.
    expect((await publicationProfile.report()).roundTrips).toBe(3);
    const draft = agendaSnapshotSchema.parse(await published.json());
    const frozen = await env.DB.prepare(
      "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=? AND revision=?",
    )
      .bind(f.eventId, draft.publishedRevision)
      .first<string>("snapshot_json");
    const snapshot = agendaSnapshotSchema.parse(JSON.parse(frozen!));
    expect(snapshot.occurrences).toHaveLength(2);
    for (const occurrence of snapshot.occurrences) {
      expect(occurrence.history?.appearances[0].biography).toBe("Reviewed biography");
      expect(occurrence.history?.materials).toEqual([]);
      expect(occurrence.presentationUrl).toBeNull();
    }
  });
  it.each(["profile", "identity", "permission", "session", "revision", "visibility"] as const)(
    "rolls back publication when %s changes at its atomic write",
    async (change) => {
      const f = await fixture();
      const profile = (await f.queue()).profiles[0];
      const reviewed = await approveSpeakerProfile(
        env.DB,
        f.eventId,
        "pqc-2026",
        {
          expectedRevision: f.agenda.revision,
          userId: profile.userId,
          identityId: profile.identityId!,
          profileDigest: profile.profileDigest,
        },
        f.userId,
      );
      const effects = async () => ({
        ...(await agendaAuthoringEffects()),
        profileSlugs: (
          await env.DB.prepare(
            "SELECT slug,user_id,created_at,retired_at FROM person_profile_slugs ORDER BY slug",
          ).all()
        ).results,
        sessionSlugs: (
          await env.DB.prepare(
            "SELECT event_id,slug,occurrence_id,created_at,retired_at FROM session_page_slugs ORDER BY event_id,slug",
          ).all()
        ).results,
      });
      let raced = false;
      let concurrent: Awaited<ReturnType<typeof effects>> | undefined;
      const db = mutateBeforeMatchingQuery(
        env.DB,
        (sql) => sql.startsWith("INSERT INTO event_agenda_publications("),
        async () => {
          raced = true;
          const at = new Date().toISOString();
          if (change === "profile")
            await env.DB.prepare("UPDATE identities SET biography='Changed after review',updated_at=? WHERE id=?")
              .bind(at, f.identityId)
              .run();
          else if (change === "identity")
            await env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?").bind(at, f.identityId).run();
          else if (change === "permission")
            await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(at, f.userId).run();
          else if (change === "session")
            await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").bind(at, f.userId).run();
          else if (change === "revision")
            await env.DB.prepare("UPDATE event_agenda_state SET revision=revision+1 WHERE event_id=?")
              .bind(f.eventId)
              .run();
          else
            await env.DB.prepare(
              "UPDATE events SET visibility=CASE WHEN visibility='public' THEN 'invitation_only' ELSE 'public' END WHERE id=?",
            )
              .bind(f.eventId)
              .run();
          concurrent = await effects();
        },
      );
      const response = await f.request("/agenda/publications", { expectedRevision: reviewed.agenda.revision }, db);
      expect(raced).toBe(true);
      expect(response.ok).toBe(false);
      expect(concurrent).toBeDefined();
      expect(await effects()).toEqual(concurrent);
    },
  );
  it("recognizes existing approvals when legacy stored links use object encoding", async () => {
    const f = await fixture();
    const profile = (await f.queue()).profiles[0];
    const at = new Date().toISOString();
    const metadata = sessionHistoryMetadataSchema.parse({
      appearances: [
        {
          userId: profile.userId,
          displayName: profile.displayName,
          affiliations: [
            {
              identityId: profile.identityId,
              title: profile.jobTitle,
              organizationId: profile.organizationId,
              organizationName: profile.organizationName,
            },
          ],
          biography: profile.biography,
          links: profile.links,
          photoUrl: profile.photoUrl,
          approvedAt: at,
        },
      ],
    });
    for (const occurrence of f.agenda.occurrences)
      await env.DB.prepare(
        "INSERT INTO event_agenda_session_history (occurrence_id,metadata_json,updated_at,updated_by) VALUES (?,?,?,?)",
      )
        .bind(occurrence.id, JSON.stringify(metadata), at, f.userId)
        .run();
    expect((await f.queue()).page.total).toBe(0);
    expect((await f.queue("approved")).page.total).toBe(1);
  });
  it("returns changed biographies to review and preserves the prior published revision", async () => {
    const f = await fixture();
    const old = (await f.queue()).profiles[0];
    let response = await f.request("/speakers/profiles/reviews", {
      expectedRevision: f.agenda.revision,
      userId: f.userId,
      identityId: f.identityId,
      profileDigest: old.profileDigest,
    });
    let current = speakerProfileApprovalResponseSchema.parse(await response.json()).agenda;
    response = await f.request("/agenda/publications", { expectedRevision: current.revision });
    expect(response.status, await response.clone().text()).toBe(200);
    current = agendaSnapshotSchema.parse(await response.json());
    const frozen = await env.DB.prepare(
      "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=? AND revision=?",
    )
      .bind(f.eventId, current.revision)
      .first<string>("snapshot_json");
    await env.DB.prepare(
      "UPDATE identities SET biography='Changed biography',updated_at='2026-10-20T10:00:00.000Z' WHERE id=?",
    )
      .bind(f.identityId)
      .run();
    const changed = (await f.queue()).profiles[0];
    expect(changed.profileDigest).not.toBe(old.profileDigest);
    expect(changed.biography).toBe("Changed biography");
    response = await f.request("/speakers/profiles/reviews", {
      expectedRevision: current.revision,
      userId: f.userId,
      identityId: f.identityId,
      profileDigest: old.profileDigest,
    });
    expect(response.status).toBe(409);
    response = await f.request("/speakers/profiles/reviews", {
      expectedRevision: current.revision,
      userId: f.userId,
      identityId: f.identityId,
      profileDigest: changed.profileDigest,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const after = await env.DB.prepare(
      "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=? AND revision=?",
    )
      .bind(f.eventId, current.revision)
      .first<string>("snapshot_json");
    expect(after).toBe(frozen);
  });
  it.each(["null", '{"agenda":null}', '{"agenda":{"speakerProfileReviews":null}}'])(
    "initializes legacy null settings when approving a profile (%s)",
    async (settings) => {
      const f = await fixture();
      await env.DB.prepare("UPDATE events SET settings_json=? WHERE id=?").bind(settings, f.eventId).run();
      const profile = (await f.queue()).profiles[0];
      const response = await f.request("/speakers/profiles/reviews", {
        expectedRevision: f.agenda.revision,
        userId: f.userId,
        identityId: f.identityId,
        profileDigest: profile.profileDigest,
      });
      expect(response.status, await response.clone().text()).toBe(200);
      expect((await f.queue("approved")).page.total).toBe(1);
    },
  );
  it("rolls back a review if the canonical biography changes before the command commits", async () => {
    const f = await fixture();
    const profile = (await f.queue()).profiles[0];
    const db: DatabaseLike = {
      prepare: env.DB.prepare.bind(env.DB),
      async batch(statements) {
        await env.DB.prepare("UPDATE identities SET biography='Concurrent change' WHERE id=?").bind(f.identityId).run();
        return env.DB.batch(statements);
      },
    };
    await expect(
      approveSpeakerProfile(
        db,
        f.eventId,
        "pqc-2026",
        {
          expectedRevision: f.agenda.revision,
          userId: f.userId,
          identityId: f.identityId,
          profileDigest: profile.profileDigest,
        },
        f.userId,
      ),
    ).rejects.toThrow();
    expect((await f.queue("approved")).page.total).toBe(0);
    expect(
      await env.DB.prepare("SELECT revision FROM event_agenda_state WHERE event_id=?")
        .bind(f.eventId)
        .first("revision"),
    ).toBe(f.agenda.revision);
  });
  it("refuses approval after the staff review permission is revoked", async () => {
    const f = await fixture();
    const profile = (await f.queue()).profiles[0];
    const permission = await env.DB.prepare(
      "SELECT id, created_at FROM role_permissions WHERE role_id='role-admin' AND permission='agenda:appearance_approve'",
    ).first<{ id: string; created_at: string }>();
    expect(permission).not.toBeNull();
    try {
      await env.DB.prepare(
        "DELETE FROM role_permissions WHERE role_id='role-admin' AND permission='agenda:appearance_approve'",
      ).run();
      expect((await f.queue()).canReview).toBe(false);
      const response = await f.request("/speakers/profiles/reviews", {
        expectedRevision: f.agenda.revision,
        userId: f.userId,
        identityId: f.identityId,
        profileDigest: profile.profileDigest,
      });
      expect(response.status).toBe(403);
      expect((await f.queue("approved")).page.total).toBe(0);
    } finally {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO role_permissions (id,role_id,permission,created_at) VALUES (?,'role-admin','agenda:appearance_approve',?)",
      )
        .bind(permission!.id, permission!.created_at)
        .run();
    }
  });
  it("refuses stale revisions, unassigned identities, invalid input, and unauthenticated approval", async () => {
    const f = await fixture();
    const profile = (await f.queue()).profiles[0];
    const body = {
      expectedRevision: 0,
      userId: f.userId,
      identityId: f.identityId,
      profileDigest: profile.profileDigest,
    };
    let response = await f.request("/speakers/profiles/reviews", body);
    expect(response.status).toBe(409);
    expect((await f.queue("approved")).page.total).toBe(0);
    response = await f.request("/speakers/profiles/reviews", {
      ...body,
      expectedRevision: f.agenda.revision,
      identityId: crypto.randomUUID(),
    });
    expect(response.status).toBe(409);
    response = await f.request("/speakers/profiles/reviews", { ...body, profileDigest: "invalid" });
    expect(response.status).toBe(400);
    response = await callApi(env, "/api/v1/events/pqc-2026/speakers/profiles/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(401);
  });
});

it("reviews both selected identities and publishes one speaker with both affiliations in authored order", async () => {
  const f = await fixture();
  const organization = await insertOrganization(env.DB, "Second organization");
  const member = await seedOrganizationAggregate(env.DB, organization);
  const identity = await addRepresentative(env.DB, member, f.userId, { jobTitle: "Chair" });
  for (const occurrence of f.agenda.occurrences) {
    f.agenda = await patchAgendaOccurrence(
      env.DB,
      f.eventId,
      "pqc-2026",
      occurrence.id,
      { expectedRevision: f.agenda.revision, speakerIdentityIds: { [f.userId]: [f.identityId, identity] } },
      f.userId,
    );
  }
  const profiles = (await f.queue()).profiles;
  expect(profiles).toHaveLength(2);
  for (const profile of profiles) {
    const response = await f.request("/speakers/profiles/reviews", {
      expectedRevision: f.agenda.revision,
      userId: profile.userId,
      identityId: profile.identityId,
      profileDigest: profile.profileDigest,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    f.agenda = speakerProfileApprovalResponseSchema.parse(await response.json()).agenda;
  }
  const published = await f.request("/agenda/publications", { expectedRevision: f.agenda.revision });
  expect(published.status, await published.clone().text()).toBe(200);
  const frozen = await env.DB.prepare(
    "SELECT snapshot_json FROM event_agenda_publications WHERE event_id=? ORDER BY revision DESC LIMIT 1",
  )
    .bind(f.eventId)
    .first<string>("snapshot_json");
  const snapshot = agendaSnapshotSchema.parse(JSON.parse(frozen!));
  for (const occurrence of snapshot.occurrences) {
    expect(occurrence.speakers).toHaveLength(1);
    expect(occurrence.speakers[0]!.profileCandidate).toBeUndefined();
    expect(occurrence.speakers[0]!.profileCandidates).toBeUndefined();
    expect(occurrence.history?.appearances).toHaveLength(1);
    expect(occurrence.history?.appearances[0]!.affiliations.map((affiliation) => affiliation.identityId)).toEqual([
      f.identityId,
      identity,
    ]);
    expect(occurrence.history?.appearances[0]!.biography).toBe("Reviewed biography");
  }
});

it("requires canonical review receipts for selected identities instead of borrowing session-history approvals", async () => {
  const f = await fixture();
  const profile = (await f.queue()).profiles[0]!;
  for (const occurrence of f.agenda.occurrences) {
    const metadata = sessionHistoryMetadataSchema.parse({
      appearances: [
        {
          userId: f.userId,
          displayName: profile.displayName,
          affiliations: [
            {
              identityId: f.identityId,
              title: profile.jobTitle,
              organizationId: profile.organizationId,
              organizationName: profile.organizationName,
            },
          ],
          biography: profile.biography,
          links: profile.links,
          photoUrl: profile.photoUrl,
          approvedAt: new Date().toISOString(),
        },
      ],
    });
    await env.DB.prepare(
      "INSERT INTO event_agenda_session_history(occurrence_id,metadata_json,updated_at,updated_by) VALUES(?,?,?,?)",
    )
      .bind(occurrence.id, JSON.stringify(metadata), new Date().toISOString(), f.userId)
      .run();
    f.agenda = await patchAgendaOccurrence(
      env.DB,
      f.eventId,
      "pqc-2026",
      occurrence.id,
      { expectedRevision: f.agenda.revision, speakerIdentityIds: { [f.userId]: [f.identityId] } },
      f.userId,
    );
  }
  expect((await f.queue()).profiles.map((profile) => profile.identityId)).toEqual([f.identityId]);
  const published = await f.request("/agenda/publications", { expectedRevision: f.agenda.revision });
  expect(published.status).toBe(422);
});
