import { requirePresentationBucket } from "../../functions/_lib/services/presentation-upload";
import { env } from "cloudflare:workers";
import { expect } from "vitest";
import type { z } from "zod";
import { agendaOccurrencePatchSchema, agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { historicalAgendaReviewInput } from "./historical-agenda-review";
import { callApi } from "./app";
import { createAdminSession } from "./auth";
import { config, buildId, queue } from "./site-publication-coordinator";
import {
  transferPrepareSchema,
  transferReviewSchema,
  transferApplySchema,
  transferApplyResponseSchema,
} from "../../assets/shared/schemas/event-agenda-transfer";
import { sessionHistoryMetadataSchema, sessionMaterialSchema } from "../../assets/shared/schemas/event-session-history";
import { publicationRepairAliasesSchema } from "../../assets/shared/schemas/site-publication-repair-aliases";
import { sitePublicationSnapshotSchema } from "../../assets/shared/schemas/site-publication";
import { sessionPresentationPublicUrl } from "../../assets/shared/session-presentation-public-url";
import { sha256Hex } from "../../functions/_lib/utils/crypto";
import { getAgenda } from "../../functions/_lib/services/event-agenda/read";
import {
  claimPublicationDispatch,
  dispatchPublicationAttempt,
  attestPublicationMachineBuild,
} from "../../functions/_lib/services/site-publication-coordinator";

/** Actual mounted source import and private owned PDF, using the existing coordinator fixture. */
export async function publicationRepairAliasFixture(mode: z.infer<typeof transferPrepareSchema>["mode"] = "archive") {
  const eventId = await queue();
  const admin = await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{ id: string }>();
  if (!admin) throw new Error("Fixture administrator is missing");
  const sourcePath = "content/events/2023/historical/index.md",
    sourceDigest = "a".repeat(64);
  await env.DB.prepare("UPDATE events SET starts_at=?,ends_at=?,source_path=? WHERE id=?")
    .bind(
      mode === "archive" ? "2023-04-01T00:00:00.000Z" : "2099-04-01T00:00:00.000Z",
      mode === "archive" ? "2023-04-02T00:00:00.000Z" : "2099-04-02T00:00:00.000Z",
      sourcePath,
      eventId,
    )
    .run();
  const token = await createAdminSession(env.DB, admin.id, "repair-alias-import");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const value = historicalAgendaReviewInput({
    actor: admin.id,
    sourcePath,
    sourceDigest,
    sourceLocator: "talk",
    approvedAt: "2023-04-02T00:00:00.000Z",
  });
  value.document.people = value.document.people.filter((person) => person.canonicalUserId === null);
  value.document.occurrences[0]!.personRefs = ["Authored speaker"];
  value.document.occurrences[0]!.archive!.appearances = [];
  value.document.occurrences[0]!.archive!.materials = [];
  value.mode = mode;
  if (mode === "copy_as_new") {
    value.document.people = [];
    value.document.occurrences[0]!.personRefs = [];
    value.document.occurrences[0]!.archive!.archivalCredits = [];
  }
  const reviewed = await callApi(env, "/api/v1/events/pqc-2026/agenda/transfers/reviews", {
    method: "POST",
    headers,
    body: JSON.stringify(transferPrepareSchema.parse(value)),
  });
  expect(reviewed.status, await reviewed.clone().text()).toBe(200);
  const review = transferReviewSchema.parse(await reviewed.json());
  expect(review.ready, JSON.stringify(review.findings)).toBe(true);
  const imported = await callApi(env, "/api/v1/events/pqc-2026/agenda/transfers", {
    method: "POST",
    headers,
    body: JSON.stringify(
      transferApplySchema.parse({
        ...value,
        reviewDigest: review.digest,
        acknowledgeInferredTiming: true,
        acknowledgeArchiveRepresentation: true,
      }),
    ),
  });
  expect(imported.status, await imported.clone().text()).toBe(200);
  let agenda = transferApplyResponseSchema.parse(await imported.json()).agenda;
  if (mode === "copy_as_new") {
    const scheduled = await callApi(env, `/api/v1/events/pqc-2026/agenda/occurrences/${agenda.occurrences[0]!.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(
        agendaOccurrencePatchSchema.parse({
          expectedRevision: agenda.revision,
          startAt: "2099-04-01T10:00:00.000Z",
          endAt: "2099-04-01T11:00:00.000Z",
          visibility: "public",
        }),
      ),
    });
    expect(scheduled.status, await scheduled.clone().text()).toBe(200);
    agenda = agendaSnapshotSchema.parse(await scheduled.json());
  }
  const occurrence = agenda.occurrences[0]!;
  const ownedSource = await env.DB.prepare("SELECT source_key FROM event_agenda_occurrences WHERE id=? AND event_id=?")
    .bind(occurrence.id, eventId)
    .first<{ source_key: string | null }>();
  if (!ownedSource?.source_key) throw new Error("Fixture occurrence source key is missing");
  const versionId = crypto.randomUUID(),
    now = new Date().toISOString();
  const bytes = new TextEncoder().encode("%PDF-1.7\nExact reviewed repair PDF\n%%EOF");
  const digest = await sha256Hex(bytes);
  const r2Key = `private/repair-fixture/${versionId}.pdf`;
  await requirePresentationBucket(env).put(r2Key, bytes, { httpMetadata: { contentType: "application/pdf" } });
  const material = sessionMaterialSchema.parse({
    id: "slides",
    kind: "presentation",
    title: "Slides",
    version: 1,
    presentationSource: "session",
    presentationVersionId: versionId,
    url: sessionPresentationPublicUrl({ eventSlug: "pqc-2026", occurrenceId: occurrence.id, versionId, digest }),
    status: "approved",
    rightsConfirmed: true,
    consentConfirmed: true,
    validated: true,
    approvedAt: now,
  });
  const history = sessionHistoryMetadataSchema.parse({ ...occurrence.history, materials: [material] });
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO session_presentation_versions(id,event_id,occurrence_id,version_number,r2_key,file_name,file_size,mime_type,source_digest,uploaded_by_user_id,uploaded_at) VALUES(?,?,?,1,?,'Secure authentication.pdf',?,'application/pdf',?,?,?)",
    ).bind(versionId, eventId, occurrence.id, r2Key, bytes.length, digest, admin.id, now),
    env.DB.prepare(
      "INSERT INTO session_presentation_reviews(id,version_id,reviewed_by_user_id,reviewed_at,status) VALUES(?,?,?,?,'approved')",
    ).bind(crypto.randomUUID(), versionId, admin.id, now),
    env.DB.prepare("UPDATE event_agenda_session_history SET metadata_json=? WHERE occurrence_id=?").bind(
      JSON.stringify(history),
      occurrence.id,
    ),
  ]);
  const attempt = await claimPublicationDispatch(env.DB, config);
  if (!attempt) throw new Error("Fixture publication was not claimed");
  await dispatchPublicationAttempt(env.DB, attempt, "token", async () =>
    Response.json({ success: true, result: { build_uuid: buildId } }),
  );
  const identity = {
    WORKERS_CI_BUILD_UUID: buildId,
    WORKERS_CI_BRANCH: config.provider.branch,
    WORKERS_CI_COMMIT_SHA: config.provider.commitHash,
  };
  await attestPublicationMachineBuild(env.DB, attempt.id, identity, "token", async () =>
    Response.json({
      success: true,
      result: {
        build_uuid: buildId,
        status: "running",
        build_outcome: null,
        build_trigger_metadata: { branch: config.provider.branch, commit_hash: config.provider.commitHash },
        trigger: {
          trigger_uuid: config.provider.triggerId,
          external_script_id: config.provider.workerTag,
          repo_connection: {
            repo_connection_uuid: config.provider.repoConnectionId,
            repo_id: config.provider.repositoryId,
            provider_account_id: config.provider.providerAccountId,
          },
        },
      },
    }),
  );
  const snapshot = sitePublicationSnapshotSchema.parse({
    version: 1,
    snapshotId: "e".repeat(64),
    sourceSequence: attempt.sourceSequence,
    eventAgendas: { "pqc-2026": await getAgenda(env.DB, eventId, "pqc-2026") },
    votes: [],
    publicResources: {},
    members: [],
    groups: {},
    groupMembers: {},
    sponsors: {},
    memberWall: [],
    news: [],
    sponsorNews: [],
  });
  const alias = publicationRepairAliasesSchema.parse([
    {
      eventId,
      eventSlug: "pqc-2026",
      occurrenceId: occurrence.id,
      materialId: material.id,
      versionId,
      digest,
      bytes: bytes.length,
      sourcePath,
      sourceDigest,
      sourceKey: ownedSource.source_key,
      sourceRef: value.document.occurrences[0]!.ref,
      reviewedAt: now,
      urls: [
        "/events/2023/historical/Secure%20authentication.pdf",
        "/events/2023/historical/Secure%C2%A0authentication.pdf",
      ],
    },
  ])[0]!;
  const machineEnv = {
    ...identity,
    CLOUDFLARE_ENV: "production",
    PKIC_PUBLICATION_ATTEMPT_ID: attempt.id,
    SITE_PUBLICATION_COORDINATOR_CONFIG: JSON.stringify(config),
  };
  return {
    eventId,
    occurrenceId: occurrence.id,
    admin,
    versionId,
    bytes,
    digest,
    r2Key,
    material,
    history,
    snapshot,
    alias,
    machineEnv,
    attempt,
  };
}

export async function activateRepairAliasFixture(
  fixture: Awaited<ReturnType<typeof publicationRepairAliasFixture>>,
  selectedBuild = buildId,
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO site_publication_activation_receipts(id,request_id,source_sequence,snapshot_id,build_id,release_id,activated_at,recorded_at) VALUES(?,?,?,?,?,'release',?,?)",
  )
    .bind(
      crypto.randomUUID(),
      fixture.attempt.requestId,
      fixture.attempt.sourceSequence,
      fixture.snapshot.snapshotId,
      selectedBuild,
      now,
      now,
    )
    .run();
}
