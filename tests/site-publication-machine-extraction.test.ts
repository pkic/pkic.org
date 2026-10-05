import { mutateBeforeNextBatch } from "./helpers/database-races";
import { collectDocumentRedirects } from "../scripts/publication/collect-document-redirects.mjs";
import {
  recordPublishedDocuments,
  resolveRetainedPublishedDocuments,
} from "../functions/_lib/services/site-publication-documents";
import { sitePublicationSnapshotSchema } from "../assets/shared/schemas/site-publication";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import { sessionPresentationPublicUrl } from "../assets/shared/session-presentation-public-url";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import { assertPublicationMachineExtraction } from "../functions/_lib/services/site-publication-machine-extraction";
import { prepareSitePublicationRequest } from "../functions/_lib/services/site-publication-requests";
import {
  attestPublicationMachineBuild,
  claimPublicationDispatch,
  dispatchPublicationAttempt,
} from "../functions/_lib/services/site-publication-coordinator";

const config = {
  environment: "production" as const,
  publicOrigin: "https://pkic.org",
  enabled: true,
  exclusiveActivationOwner: true,
  debounceSeconds: 0,
  provider: {
    accountId: "a".repeat(32),
    triggerId: "11111111-1111-4111-8111-111111111111",
    scriptName: "pkic-site",
    branch: "main",
    commitHash: "b".repeat(40),
    workerTag: "c".repeat(32),
    repoConnectionId: "22222222-2222-4222-8222-222222222222",
    repositoryId: "123",
    providerAccountId: "456",
  },
};
const buildId = "33333333-3333-4333-8333-333333333333";
const identity = {
  WORKERS_CI_BUILD_UUID: buildId,
  WORKERS_CI_BRANCH: "main",
  WORKERS_CI_COMMIT_SHA: config.provider.commitHash,
};

async function ownedBuild(attest = true) {
  const { eventId } = await seedEventAndAdmin(env.DB);
  await env.DB.batch([
    prepareSitePublicationRequest(env.DB, {
      resourceType: "event_agenda",
      resourceId: eventId,
      revision: 1,
      reasonCode: "agenda_approved",
      deduplicationKey: `agenda:${eventId}:1`,
    }),
  ]);
  const attempt = await claimPublicationDispatch(env.DB, config);
  if (!attempt) throw new Error("Expected the queued publication to acquire its fence");
  await dispatchPublicationAttempt(env.DB, attempt, "token", async () =>
    Response.json({ success: true, result: { build_uuid: buildId } }),
  );
  if (attest)
    await attestPublicationMachineBuild(env.DB, attempt.id, identity, "token", async () =>
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
  return {
    eventId,
    attempt,
    machineEnv: {
      ...identity,
      CLOUDFLARE_ENV: "production",
      PKIC_PUBLICATION_ATTEMPT_ID: attempt.id,
      SITE_PUBLICATION_COORDINATOR_CONFIG: JSON.stringify(config),
    },
  };
}

beforeEach(resetDb);

describe("native publication extraction authority", () => {
  it("does not query D1 when ownership is absent, disabled, or not exclusive", async () => {
    const prepare = vi.spyOn(env.DB, "prepare");
    try {
      expect(await assertPublicationMachineExtraction(env.DB, {})).toBeNull();
      for (const overrides of [{ enabled: false }, { exclusiveActivationOwner: false }])
        expect(
          await assertPublicationMachineExtraction(env.DB, {
            SITE_PUBLICATION_COORDINATOR_CONFIG: JSON.stringify({ ...config, ...overrides }),
          }),
        ).toBeNull();
      expect(prepare).not.toHaveBeenCalled();
    } finally {
      prepare.mockRestore();
    }
  });

  it("returns the exact source highwater only for the independently attested owner", async () => {
    const { attempt, machineEnv } = await ownedBuild();
    expect(await assertPublicationMachineExtraction(env.DB, machineEnv)).toEqual({
      identityType: "native_build_machine",
      attemptId: attempt.id,
      buildId,
      sourceSequence: attempt.sourceSequence,
    });
  });

  it("refuses a dispatched build that has not completed provider attestation", async () => {
    const { machineEnv } = await ownedBuild(false);
    await expect(assertPublicationMachineExtraction(env.DB, machineEnv)).rejects.toThrow(
      "PUBLICATION_EXTRACTION_AUTHORITY_CHANGED",
    );
  });

  it("refuses changed CI identity, deployment environment, origin, and provider target", async () => {
    const { machineEnv } = await ownedBuild();
    const mismatches = [
      { WORKERS_CI_BUILD_UUID: "44444444-4444-4444-8444-444444444444" },
      { WORKERS_CI_BRANCH: "other-branch" },
      { WORKERS_CI_COMMIT_SHA: "d".repeat(40) },
      { CLOUDFLARE_ENV: "preview" },
      {
        SITE_PUBLICATION_COORDINATOR_CONFIG: JSON.stringify({
          ...config,
          publicOrigin: "https://preview.pkic.org",
        }),
      },
      {
        SITE_PUBLICATION_COORDINATOR_CONFIG: JSON.stringify({
          ...config,
          provider: { ...config.provider, scriptName: "other-site" },
        }),
      },
    ];
    for (const mismatch of mismatches)
      await expect(assertPublicationMachineExtraction(env.DB, { ...machineEnv, ...mismatch })).rejects.toThrow(
        "PUBLICATION_EXTRACTION_AUTHORITY_CHANGED",
      );
  });

  it("refuses extraction after a rights withdrawal advances the desired source", async () => {
    const { eventId, machineEnv } = await ownedBuild();
    await env.DB.batch([
      prepareSitePublicationRequest(env.DB, {
        resourceType: "event_agenda",
        resourceId: eventId,
        revision: 2,
        reasonCode: "rights_withdrawn",
        deduplicationKey: `agenda:${eventId}:2`,
      }),
    ]);
    await expect(assertPublicationMachineExtraction(env.DB, machineEnv)).rejects.toThrow(
      "PUBLICATION_EXTRACTION_AUTHORITY_CHANGED",
    );
  });

  it("refuses a stale machine after its global lease token changes", async () => {
    const { machineEnv } = await ownedBuild();
    await env.DB.prepare("UPDATE site_publication_pipeline_fence SET lease_token=? WHERE id=1")
      .bind("another-owner")
      .run();
    await expect(assertPublicationMachineExtraction(env.DB, machineEnv)).rejects.toThrow(
      "PUBLICATION_EXTRACTION_AUTHORITY_CHANGED",
    );
  });
});

describe("native publication document manifest", () => {
  async function documentBuild() {
    const { eventId, attempt, machineEnv } = await ownedBuild();
    const occurrenceId = crypto.randomUUID(),
      versionId = crypto.randomUUID(),
      digest = "d".repeat(64),
      now = new Date().toISOString();
    const userId = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{ id: string }>())!
      .id;
    const receipt = {
      url: "/events/authored-old-folder/slides.pdf",
      targetUrl: "/content-media/events/authored-old-folder/slides.pdf",
      sourcePath: "content/events/authored-old-folder/index.md",
      sourceDigest: "f".repeat(64),
      sourceLocator: "agenda.day[0].sessions[0]",
      pdfDigest: digest,
      pdfBytes: 20,
    };
    const material = {
      legacyDownloadUrl: receipt.url,
      id: "slides",
      kind: "presentation",
      title: "Slides",
      url: sessionPresentationPublicUrl({ eventSlug: "pqc-2026", occurrenceId, versionId, digest }),
      presentationSource: "session",
      presentationVersionId: versionId,
      version: 1,
      rightsConfirmed: true,
      consentConfirmed: true,
      validated: true,
      status: "approved",
      approvedAt: now,
    };
    await env.DB.prepare("INSERT INTO event_agenda_occurrences(id,event_id,title,description) VALUES(?,?,'Session','')")
      .bind(occurrenceId, eventId)
      .run();
    await env.DB.prepare(
      "INSERT INTO session_presentation_versions(id,event_id,occurrence_id,version_number,r2_key,file_name,file_size,mime_type,source_digest,uploaded_by_user_id,uploaded_at) VALUES(?,?,?,1,'verified-pdf','slides.pdf',20,'application/pdf',?,?,?)",
    )
      .bind(versionId, eventId, occurrenceId, digest, userId, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO session_presentation_reviews(id,version_id,reviewed_by_user_id,reviewed_at,status) VALUES(?,?,?,?,'approved')",
    )
      .bind(crypto.randomUUID(), versionId, userId, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO event_agenda_session_history(occurrence_id,metadata_json,updated_by,updated_at) VALUES(?,?,?,?)",
    )
      .bind(occurrenceId, JSON.stringify({ materials: [material], legacyDownloads: [receipt] }), userId, now)
      .run();
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
    const documents = [
      {
        eventId,
        occurrenceId,
        materialId: "slides",
        versionId,
        digest,
        r2Key: "verified-pdf",
        fileSize: 20,
        legacyDownload: receipt,
        objectEtag: "verified-object",
      },
    ];
    return {
      eventId,
      occurrenceId,
      versionId,
      userId,
      snapshot,
      documents,
      machineEnv,
      material,
      receipt,
      requestId: attempt.requestId,
    };
  }
  it("binds an attested build's exact document selection atomically and refuses conflicting replay", async () => {
    const { snapshot, documents, machineEnv, receipt } = await documentBuild();
    await recordPublishedDocuments(env.DB, snapshot, documents, machineEnv);
    await recordPublishedDocuments(env.DB, snapshot, documents, machineEnv);
    expect(
      await env.DB.prepare("SELECT build_id,snapshot_id,object_etag FROM site_publication_document_manifests").all(),
    ).toMatchObject({
      results: [{ build_id: buildId, snapshot_id: snapshot.snapshotId, object_etag: "verified-object" }],
    });
    await expect(
      recordPublishedDocuments(env.DB, snapshot, [{ ...documents[0], objectEtag: "changed-object" }], machineEnv),
    ).rejects.toThrow("PUBLICATION_DOCUMENT_MANIFEST_CONFLICT");
    await expect(
      env.DB.prepare(
        `INSERT INTO site_publication_document_manifests(build_id,snapshot_id,event_id,occurrence_id,material_id,version_id,digest,object_etag,legacy_download_json,grant_id)
      SELECT build_id,snapshot_id,event_id,occurrence_id,material_id,version_id,digest,object_etag,legacy_download_json,? FROM site_publication_document_manifests WHERE build_id=?`,
      )
        .bind("0".repeat(64), buildId)
        .run(),
    ).rejects.toThrow("PUBLICATION_DOCUMENT_MANIFEST_CONFLICT");
    await expect(
      env.DB.prepare(
        `INSERT INTO site_publication_document_manifests(build_id,snapshot_id,event_id,occurrence_id,material_id,version_id,digest,object_etag,legacy_download_json)
      SELECT build_id,snapshot_id,event_id,occurrence_id,material_id,version_id,digest,object_etag,? FROM site_publication_document_manifests WHERE build_id=?`,
      )
        .bind(JSON.stringify({ ...receipt, sourceLocator: "another-source" }), buildId)
        .run(),
    ).rejects.toThrow("PUBLICATION_DOCUMENT_MANIFEST_CONFLICT");
    await env.DB.prepare("UPDATE site_publication_pipeline_fence SET lease_token='lost-owner' WHERE id=1").run();
    await expect(recordPublishedDocuments(env.DB, snapshot, documents, machineEnv)).rejects.toThrow(
      "PUBLICATION_EXTRACTION_AUTHORITY_CHANGED",
    );
  });
  it.each(["receipt", "selection", "review", "version"])(
    "rolls back the manifest when its exact %s changes after preflight",
    async (change) => {
      const { snapshot, documents, machineEnv, occurrenceId, versionId, userId, material, receipt } =
        await documentBuild();
      const raced = mutateBeforeNextBatch(env.DB, async () => {
        if (change === "version") {
          await env.DB.prepare("UPDATE session_presentation_versions SET version_number=2 WHERE id=?")
            .bind(versionId)
            .run();
        } else if (change === "review") {
          await env.DB.prepare(
            "INSERT INTO session_presentation_reviews(id,version_id,reviewed_by_user_id,reviewed_at,status) VALUES(?,?,?,?,'approved')",
          )
            .bind(crypto.randomUUID(), versionId, userId, "2099-01-01T00:00:00.000Z")
            .run();
        } else {
          await env.DB.prepare("UPDATE event_agenda_session_history SET metadata_json=? WHERE occurrence_id=?")
            .bind(
              JSON.stringify({
                materials: [
                  {
                    ...material,
                    approvedAt: change === "selection" ? "2099-01-01T00:00:00.000Z" : material.approvedAt,
                  },
                ],
                legacyDownloads: [
                  { ...receipt, pdfBytes: change === "receipt" ? receipt.pdfBytes + 1 : receipt.pdfBytes },
                ],
              }),
              occurrenceId,
            )
            .run();
        }
      });
      await expect(recordPublishedDocuments(raced, snapshot, documents, machineEnv)).rejects.toThrow();
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS total FROM site_publication_document_manifests").first<{
          total: number;
        }>(),
      ).toEqual({ total: 0 });
    },
  );
  async function activateDocumentBuild(fixture: Awaited<ReturnType<typeof documentBuild>>, selectedBuild = buildId) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO site_publication_activation_receipts(id,request_id,source_sequence,snapshot_id,build_id,release_id,activated_at,recorded_at) VALUES(?,?,?,?,?,'release',?,?)",
    )
      .bind(
        crypto.randomUUID(),
        fixture.requestId,
        fixture.snapshot.sourceSequence,
        fixture.snapshot.snapshotId,
        selectedBuild,
        now,
        now,
      )
      .run();
  }

  it("retains only activated provenance for a fresh withdrawn or deleted material snapshot and deduplicates repeated builds", async () => {
    const fixture = await documentBuild();
    await recordPublishedDocuments(env.DB, fixture.snapshot, fixture.documents, fixture.machineEnv);
    expect(await resolveRetainedPublishedDocuments(env.DB)).toEqual([]);
    await activateDocumentBuild(fixture);
    const repeats = Array.from({ length: 1002 }, (_, index) => `historical-build-${index}`);
    await env.DB.prepare(
      `INSERT INTO site_publication_document_manifests(build_id,snapshot_id,event_id,occurrence_id,material_id,version_id,digest,object_etag,legacy_download_json)
      SELECT repeated.value,manifest.snapshot_id,manifest.event_id,manifest.occurrence_id,manifest.material_id,manifest.version_id,manifest.digest,manifest.object_etag,manifest.legacy_download_json
      FROM json_each(?) repeated JOIN site_publication_document_manifests manifest ON manifest.build_id=?`,
    )
      .bind(JSON.stringify(repeats), buildId)
      .run();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO site_publication_activation_receipts(id,request_id,source_sequence,snapshot_id,build_id,release_id,activated_at,recorded_at)
      SELECT value,?,?,?,value,'release',?,? FROM json_each(?)`,
    )
      .bind(
        fixture.requestId,
        fixture.snapshot.sourceSequence,
        fixture.snapshot.snapshotId,
        now,
        now,
        JSON.stringify(repeats),
      )
      .run();
    for (const status of ["withdrawn", "deleted"]) {
      const history = {
        legacyDownloads: [fixture.receipt],
        materials: status === "deleted" ? [] : [{ ...fixture.material, status: "withdrawn" }],
      };
      await env.DB.prepare("UPDATE event_agenda_session_history SET metadata_json=? WHERE occurrence_id=?")
        .bind(JSON.stringify(history), fixture.occurrenceId)
        .run();
      const fresh = sitePublicationSnapshotSchema.parse({
        ...fixture.snapshot,
        snapshotId: "a".repeat(64),
        eventAgendas: { "pqc-2026": await getAgenda(env.DB, fixture.eventId, "pqc-2026") },
      });
      const retained = await resolveRetainedPublishedDocuments(env.DB);
      expect(retained).toHaveLength(1);
      expect(retained[0].legacyDownload).toEqual(fixture.receipt);
      const routes = collectDocumentRedirects(fresh, [], retained);
      expect(routes.redirects.map(({ from }: { from: string }) => from)).toEqual([
        fixture.receipt.targetUrl,
        fixture.receipt.url,
      ]);
      expect(routes.redirects.every(({ to }: { to: string }) => to === fixture.material.url)).toBe(true);
      expect(routes.retiredPaths).toHaveLength(2);
    }
  });

  it.each(["malformed", "digest", "bytes", "foreign owner"])(
    "rejects activated %s receipt provenance",
    async (change) => {
      const fixture = await documentBuild();
      await recordPublishedDocuments(env.DB, fixture.snapshot, fixture.documents, fixture.machineEnv);
      if (change === "foreign owner") await activateDocumentBuild(fixture);
      const badBuild = "bad-receipt-build";
      const receipt =
        change === "malformed"
          ? "{}"
          : JSON.stringify({
              ...fixture.receipt,
              pdfDigest: change === "digest" ? "0".repeat(64) : fixture.receipt.pdfDigest,
              pdfBytes: change === "bytes" ? fixture.receipt.pdfBytes + 1 : fixture.receipt.pdfBytes,
            });
      await env.DB.prepare(
        `INSERT INTO site_publication_document_manifests(build_id,snapshot_id,event_id,occurrence_id,material_id,version_id,digest,object_etag,legacy_download_json)
      SELECT ?,snapshot_id,event_id,occurrence_id,?,version_id,digest,object_etag,? FROM site_publication_document_manifests WHERE build_id=?`,
      )
        .bind(badBuild, change === "foreign owner" ? "another-material" : fixture.material.id, receipt, buildId)
        .run();
      await activateDocumentBuild(fixture, badBuild);
      await expect(resolveRetainedPublishedDocuments(env.DB)).rejects.toThrow();
    },
  );
});
