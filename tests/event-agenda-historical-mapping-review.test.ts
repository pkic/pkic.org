import { grantAdministrator } from "./helpers/administrator";
import { historicalAgendaReviewInput, mapHistoricalAgendaSpeaker } from "./helpers/historical-agenda-review";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { resetDb } from "./helpers/reset-db";
import { individualAppearanceFixture } from "./helpers/agenda-appearances";
import { addRepresentative, insertOrganization, seedOrganizationAggregate } from "./helpers/membership";
import type { DatabaseLike, StatementLike } from "../functions/_lib/types";
import { agendaSnapshotSchema, agendaImportResponseSchema } from "../assets/shared/schemas/event-agenda";
import { agendaContentsResponseSchema, agendaContentSchema } from "../assets/shared/schemas/event-agenda-content";
import { transferReviewSchema, transferApplyResponseSchema } from "../assets/shared/schemas/event-agenda-transfer";
import { sessionHistoryMetadataSchema } from "../assets/shared/schemas/event-session-history";

const eventId = crypto.randomUUID(),
  actor = crypto.randomUUID(),
  speaker = crypto.randomUUID();
const sourceDigest = "a".repeat(64),
  sourcePath = "/events/historical/",
  sourceLocator = "2023-04-01:0:0";
const approvedAt = "2023-04-02T00:00:00.000Z";
const frozenAppearance = individualAppearanceFixture({ userId: actor, displayName: "Original moderator", approvedAt });
let token = "";
function request(path: string, body: unknown, method = "POST") {
  return callApi(env, `/api/v1/events/historical/agenda${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function input(placeholder = false) {
  return historicalAgendaReviewInput({ actor, sourcePath, sourceDigest, sourceLocator, approvedAt }, placeholder);
}
async function apply(value: ReturnType<typeof input>) {
  const checked = await request("/transfers/reviews", value);
  expect(checked.status, await checked.clone().text()).toBe(200);
  const review = transferReviewSchema.parse(await checked.json());
  expect(review.ready, JSON.stringify(review.findings)).toBe(true);
  if (review.skipped)
    expect(
      review.findings.filter((finding) => finding.code === "local_edits").every((finding) => finding.rowRef === "talk"),
    ).toBe(true);
  const result = await request("/transfers", {
    ...value,
    reviewDigest: review.digest,
    acknowledgeInferredTiming: true,
    acknowledgeArchiveRepresentation: true,
  });
  expect(result.status, await result.clone().text()).toBe(200);
  return transferApplyResponseSchema.parse(await result.json());
}
async function content() {
  const response = await callApi(env, "/api/v1/events/historical/agenda/contents?limit=25&offset=0", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  return agendaContentsResponseSchema.parse(await response.json()).contents[0];
}
function mapSpeaker(value: ReturnType<typeof input>, placeholder = false) {
  mapHistoricalAgendaSpeaker(value, speaker, approvedAt, placeholder);
}
async function speakerIdentity(startedAt: string) {
  const organizationId = await insertOrganization(env.DB, "Verified historical organization");
  const memberId = await seedOrganizationAggregate(env.DB, organizationId);
  const id = await addRepresentative(env.DB, memberId, speaker, { jobTitle: "Verified role" });
  await env.DB.prepare("UPDATE identities SET invited_at=?,started_at=? WHERE id=?")
    .bind(startedAt, startedAt, id)
    .run();
  return id;
}
function beforeCommand(change: () => Promise<unknown>): DatabaseLike {
  return {
    prepare: env.DB.prepare.bind(env.DB),
    batch: async (statements) => {
      await change();
      return env.DB.batch(statements);
    },
  };
}
async function durableState() {
  const state = await env.DB.prepare("SELECT revision FROM event_agenda_state WHERE event_id=?")
    .bind(eventId)
    .first("revision");
  const history = await env.DB.prepare(
    "SELECT metadata_json FROM event_agenda_session_history WHERE occurrence_id IN(SELECT id FROM event_agenda_occurrences WHERE event_id=?)",
  )
    .bind(eventId)
    .first("metadata_json");
  const review = await env.DB.prepare("SELECT source_review_json FROM event_agenda_contents WHERE event_id=?")
    .bind(eventId)
    .first("source_review_json");
  const audit = await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_log").first("count");
  return { state, history, review, audit };
}
beforeEach(async () => {
  await resetDb();
  for (const id of [actor, speaker])
    await env.DB.prepare("INSERT INTO users(id,email,normalized_email,active) VALUES(?,?,?,1)")
      .bind(id, `${id}@example.test`, `${id}@example.test`)
      .run();
  await grantAdministrator(env.DB, actor);
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at) VALUES(?,'historical','Historical','UTC','{}',?,?)",
  )
    .bind(eventId, now, now)
    .run();
  token = await createAdminSession(env.DB, actor, crypto.randomUUID());
});
describe("verified historical source mapping review", () => {
  it("transports the complete supported proposal withdrawal review population", async () => {
    const response = await callApi(env, "/api/v1/events/historical/agenda", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const agenda = agendaSnapshotSchema.parse(await response.json());
    const body = {
      agenda,
      imported: 0,
      skipped: 0,
      dryRun: true,
      reviewRequired: 2000,
      reviewSourceKeys: Array.from({ length: 2000 }, (_, index) => `proposal:withdrawn-${index}`),
    };
    expect(agendaImportResponseSchema.parse(body).reviewSourceKeys).toHaveLength(2000);
    expect(
      agendaImportResponseSchema.safeParse({
        ...body,
        reviewSourceKeys: [...body.reviewSourceKeys, "proposal:outside-supported-population"],
      }).success,
    ).toBe(false);
  });
  it("stages and atomically accepts attribution with the full canonical roster while retaining prior approvals and source evidence", async () => {
    const value = input(),
      initial = await apply(value),
      occurrence = initial.agenda.occurrences[0];
    const approvedMaterial = {
      ...occurrence.history!.materials[0],
      rightsConfirmed: true,
      consentConfirmed: true,
      validated: true,
      status: "approved" as const,
      approvedAt,
    };
    const saved = await request(`/occurrences/${occurrence.id}/history`, {
      expectedRevision: initial.agenda.revision,
      history: { ...occurrence.history, materials: [approvedMaterial] },
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const before = agendaSnapshotSchema.parse(await saved.json());
    const priorMaterials = structuredClone(before.occurrences[0].history!.materials);
    expect(priorMaterials).toHaveLength(1);
    expect(priorMaterials[0].approvedAt).toEqual(expect.any(String));
    expect(priorMaterials[0].approvedAt).not.toBe(approvedAt);
    expect(priorMaterials[0].approvalNonce).toEqual(expect.any(String));
    expect(priorMaterials[0]).toEqual({
      ...approvedMaterial,
      approvedAt: priorMaterials[0].approvedAt,
      approvalNonce: priorMaterials[0].approvalNonce,
    });
    const provenance = await env.DB.prepare(
      "SELECT source_digest FROM event_agenda_import_provenance WHERE occurrence_id=?",
    )
      .bind(occurrence.id)
      .first("source_digest");
    mapSpeaker(value);
    value.expectedRevision = before.revision;
    const staged = await apply(value),
      pending = await content();
    expect(staged.imported).toBe(0);
    expect(staged.agenda.occurrences[0].history!.archivalCredits).toHaveLength(1);
    expect(pending.review!.incomingHistoricalMetadata![0].reviewIssues).toEqual([]);
    const accepted = await request(
      `/contents/${pending.id}`,
      { expectedRevision: staged.agenda.revision, content: pending.review!.incoming, resolveSourceReview: true },
      "PATCH",
    );
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    expect(agendaContentSchema.parse(await accepted.json()).review).toBeNull();
    const stored = sessionHistoryMetadataSchema.parse(JSON.parse(String((await durableState()).history)));
    expect(stored.archivalCredits).toEqual([]);
    expect(stored.appearances).toContainEqual(frozenAppearance);
    expect(stored.appearances).toContainEqual(value.document.occurrences[0].archive!.appearances[1]);
    expect(stored.materials).toEqual(priorMaterials);
    expect(stored.legacyPaths).toEqual(["/events/historical/old-talk/"]);
    expect(
      await env.DB.prepare("SELECT source_digest FROM event_agenda_import_provenance WHERE occurrence_id=?")
        .bind(occurrence.id)
        .first("source_digest"),
    ).toBe(provenance);
    const baseline = JSON.parse(
      String(
        await env.DB.prepare("SELECT source_snapshot_json FROM event_agenda_contents WHERE id=?")
          .bind(pending.id)
          .first("source_snapshot_json"),
      ),
    );
    expect(baseline.originalHistoricalMetadataEvidence[0].originalMetadata.archivalCredits[0].displayName).toBe(
      "Authored speaker",
    );
    const published = await request("/publications", { expectedRevision: staged.agenda.revision + 1 });
    expect(published.status, await published.clone().text()).toBe(200);
  });
  it("resolves explicit missing title and credit decisions through exact verified source refs, not display names", async () => {
    const value = input(true),
      initial = await apply(value);
    mapSpeaker(value, true);
    value.expectedRevision = initial.agenda.revision;
    const staged = await apply(value),
      pending = await content();
    expect(pending.review!.incomingHistoricalMetadata![0].reviewIssues).toEqual([]);
    const accepted = await request(
      `/contents/${pending.id}`,
      { expectedRevision: staged.agenda.revision, content: pending.review!.incoming, resolveSourceReview: true },
      "PATCH",
    );
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const stored = sessionHistoryMetadataSchema.parse(JSON.parse(String((await durableState()).history)));
    expect(stored.sourceDecisions[1]).toMatchObject({
      authoredValue: "TBC",
      decision: "reviewed_credit",
      resolvedValue: "Verified speaker ref",
      sourceDigest,
      sourcePath,
      sourceLocator,
    });
    expect(stored.appearances[1].displayName).toBe("Verified speaker");
  });
  it("refuses partial roster acceptance without changing history, review, revision or audit", async () => {
    const value = input(),
      initial = await apply(value);
    mapSpeaker(value);
    value.expectedRevision = initial.agenda.revision;
    const staged = await apply(value),
      pending = await content(),
      before = await durableState();
    const refused = await request(
      `/contents/${pending.id}`,
      {
        expectedRevision: staged.agenda.revision,
        content: { ...pending.review!.incoming, speakerUserIds: [actor], speakerRoles: { [actor]: "moderator" } },
        resolveSourceReview: true,
      },
      "PATCH",
    );
    expect(refused.status).toBe(422);
    expect(await durableState()).toEqual(before);
  });
  it("refuses accepting verified title metadata while retaining the unresolved displayed title", async () => {
    const value = input(true),
      initial = await apply(value);
    mapSpeaker(value, true);
    value.expectedRevision = initial.agenda.revision;
    const staged = await apply(value),
      pending = await content(),
      before = await durableState();
    const refused = await request(
      `/contents/${pending.id}`,
      {
        expectedRevision: staged.agenda.revision,
        content: { ...pending.review!.incoming, title: "Title not recorded" },
        resolveSourceReview: true,
      },
      "PATCH",
    );
    expect(refused.status).toBe(422);
    expect(await durableState()).toEqual(before);
  });
  it("rejects stale stored history after review and leaves the complete command unchanged", async () => {
    const value = input(),
      initial = await apply(value);
    mapSpeaker(value);
    value.expectedRevision = initial.agenda.revision;
    const staged = await apply(value),
      pending = await content();
    await env.DB.prepare(
      "UPDATE event_agenda_session_history SET metadata_json=json_set(metadata_json,'$.prerequisites','New reviewed context') WHERE occurrence_id=?",
    )
      .bind(staged.agenda.occurrences[0].id)
      .run();
    const before = await durableState();
    const refused = await request(
      `/contents/${pending.id}`,
      { expectedRevision: staged.agenda.revision, content: pending.review!.incoming, resolveSourceReview: true },
      "PATCH",
    );
    expect(refused.status).toBe(409);
    expect(await durableState()).toEqual(before);
  });
  it("refuses a reviewed credit that is not bound to the exact canonical approved person", async () => {
    const value = input(true);
    mapSpeaker(value, true);
    value.document.occurrences[0].archive!.sourceDecisions[1].resolvedValue = "Unmapped exact ref";
    const checked = await request("/transfers/reviews", value);
    expect(checked.status).toBe(200);
    const review = transferReviewSchema.parse(await checked.json());
    expect(review.ready).toBe(false);
    expect(review.findings).toContainEqual(
      expect.objectContaining({ code: "invalid_reference", severity: "blocking" }),
    );
  });
  it("uses the existing occurrence date when accepting a changed source mapping", async () => {
    const value = input(),
      initial = await apply(value);
    const identityId = await speakerIdentity("2024-01-01T00:00:00.000Z");
    mapSpeaker(value);
    value.expectedRevision = initial.agenda.revision;
    value.document.people[1].actingIdentityId = identityId;
    const row = value.document.occurrences[0];
    row.archive!.appearances[1].actingIdentityId = identityId;
    row.timing.startAt = "2025-04-01T10:00:00.000Z";
    row.timing.endAt = "2025-04-01T11:00:00.000Z";
    row.timing.authoredDate = "2025-04-01";
    const staged = await apply(value),
      pending = await content(),
      before = await durableState();
    const refused = await request(
      `/contents/${pending.id}`,
      { expectedRevision: staged.agenda.revision, content: pending.review!.incoming, resolveSourceReview: true },
      "PATCH",
    );
    expect(refused.status).toBe(422);
    expect(await durableState()).toEqual(before);
  });
  it("rechecks immutable provenance inside the real D1 batch and rolls back the entire acceptance", async () => {
    const value = input(),
      initial = await apply(value);
    mapSpeaker(value);
    value.expectedRevision = initial.agenda.revision;
    const staged = await apply(value),
      pending = await content(),
      before = await durableState();
    const db = beforeCommand(() =>
      env.DB.prepare("UPDATE event_agenda_import_provenance SET source_digest=? WHERE occurrence_id=?")
        .bind("b".repeat(64), staged.agenda.occurrences[0].id)
        .run(),
    );
    const refused = await callApi({ ...env, DB: db }, `/api/v1/events/historical/agenda/contents/${pending.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: staged.agenda.revision,
        content: pending.review!.incoming,
        resolveSourceReview: true,
      }),
    });
    expect(refused.status).toBe(409);
    expect(await durableState()).toEqual(before);
  });
  it("refuses source review replacement between the typed content read and source evidence read", async () => {
    const value = input(),
      initial = await apply(value);
    mapSpeaker(value);
    value.expectedRevision = initial.agenda.revision;
    const staged = await apply(value),
      pending = await content();
    let racedState: Awaited<ReturnType<typeof durableState>> | undefined;
    const nativeStatements = new WeakMap<StatementLike, StatementLike>();
    const sourceReads = new WeakSet<StatementLike>();
    const db: DatabaseLike = {
      prepare(query) {
        let statement = env.DB.prepare(query);
        const wrapper: StatementLike = {
          bind(...values) {
            statement = statement.bind(...values);
            nativeStatements.set(wrapper, statement);
            return wrapper;
          },
          run: () => statement.run(),
          first: (column) => statement.first(column),
          all: () => statement.all(),
        };
        nativeStatements.set(wrapper, statement);
        if (query.includes("source.source_format")) sourceReads.add(wrapper);
        return wrapper;
      },
      async batch(statements) {
        // Mutation reads also run inside live permission batches. Intercept that
        // actual source read, then pass native statements to the real D1 binding.
        if (statements.some((statement) => sourceReads.has(statement)) && !racedState) {
          await env.DB.prepare(
            "UPDATE event_agenda_contents SET source_review_json=json_set(source_review_json,'$.incoming.description','Replacement reviewed description') WHERE id=?",
          )
            .bind(pending.id)
            .run();
          racedState = await durableState();
        }
        return env.DB.batch(statements.map((statement) => nativeStatements.get(statement) ?? statement));
      },
    };
    const refused = await callApi({ ...env, DB: db }, `/api/v1/events/historical/agenda/contents/${pending.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: staged.agenda.revision,
        content: pending.review!.incoming,
        resolveSourceReview: true,
      }),
    });
    expect(refused.status).toBe(409);
    expect(racedState).toBeDefined();
    expect(await durableState()).toEqual(racedState);
  });
  it("guards fresh historical identity ownership inside the original atomic import", async () => {
    const value = input(true);
    mapSpeaker(value, true);
    const identityId = await speakerIdentity("2022-01-01T00:00:00.000Z");
    value.document.people[1].actingIdentityId = identityId;
    value.document.occurrences[0].archive!.appearances[1].actingIdentityId = identityId;
    const checked = await request("/transfers/reviews", value);
    const review = transferReviewSchema.parse(await checked.json());
    expect(review.ready).toBe(true);
    const before = await durableState();
    const db = beforeCommand(() =>
      env.DB.prepare("UPDATE identities SET started_at='2024-01-01T00:00:00.000Z' WHERE id=?").bind(identityId).run(),
    );
    const refused = await callApi({ ...env, DB: db }, "/api/v1/events/historical/agenda/transfers", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        ...value,
        reviewDigest: review.digest,
        acknowledgeInferredTiming: true,
        acknowledgeArchiveRepresentation: true,
      }),
    });
    expect(refused.status).toBe(409);
    expect(await durableState()).toEqual(before);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_occurrences WHERE event_id=?")
        .bind(eventId)
        .first("count"),
    ).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_agenda_import_provenance").first("count")).toBe(0);
  });
});
