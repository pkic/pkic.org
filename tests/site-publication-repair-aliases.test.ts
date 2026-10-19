import { requirePresentationBucket } from "../functions/_lib/services/presentation-upload";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import {
  publicationRepairAliasFixture,
  activateRepairAliasFixture,
} from "./helpers/site-publication-repair-alias-fixture";
import { buildId } from "./helpers/site-publication-coordinator";
import {
  resolvePublishedDocuments,
  recordPublishedDocuments,
} from "../functions/_lib/services/site-publication-documents";
import { resolveRetainedPublicationRepairAliases } from "../functions/_lib/services/site-publication-repair-aliases";
import { collectDocumentRedirects } from "../scripts/publication/collect-document-redirects.mjs";
import { verifyPublicDocuments } from "../scripts/publication/verify-public-documents.mjs";
import { publicationRepairAliasPaths } from "../assets/shared/schemas/site-publication-repair-aliases";

async function verified(fixture: Awaited<ReturnType<typeof publicationRepairAliasFixture>>) {
  return verifyPublicDocuments(await resolvePublishedDocuments(env.DB, fixture.snapshot, [fixture.alias]), (key) =>
    requirePresentationBucket(env).get(key),
  );
}
async function manifests() {
  return (
    await env.DB.prepare(
      "SELECT build_id,snapshot_id,event_id,occurrence_id,material_id,version_id,digest,object_etag,grant_id,legacy_download_json,repair_aliases_json FROM site_publication_document_manifests ORDER BY build_id,event_id,occurrence_id,material_id",
    ).all()
  ).results;
}

describe("activated explicit repair aliases", () => {
  beforeEach(resetDb);

  it("records verified owned bytes and source evidence once without manufacturing historical receipt evidence", async () => {
    const fixture = await publicationRepairAliasFixture();
    const documents = await verified(fixture);
    expect(documents).toHaveLength(1);
    expect(documents[0]!.fileSize).toBe(fixture.bytes.length);
    expect(documents[0]!.repairAliases).toEqual([fixture.alias]);
    await recordPublishedDocuments(env.DB, fixture.snapshot, documents, fixture.machineEnv);
    const before = await manifests();
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      legacy_download_json: null,
      repair_aliases_json: JSON.stringify([fixture.alias]),
    });
    await recordPublishedDocuments(env.DB, fixture.snapshot, documents, fixture.machineEnv);
    expect(await manifests()).toEqual(before);
    expect(await resolveRetainedPublicationRepairAliases(env.DB)).toEqual([]);
    const stored = await env.DB.prepare("SELECT metadata_json FROM event_agenda_session_history WHERE occurrence_id=?")
      .bind(fixture.occurrenceId)
      .first<{ metadata_json: string }>();
    expect(stored?.metadata_json).toBe(JSON.stringify(fixture.history));
  });

  it.each([
    "event",
    "slug",
    "occurrence",
    "material",
    "version",
    "digest",
    "bytes",
    "sourcePath",
    "sourceDigest",
    "sourceKey",
    "sourceRef",
    "futureReview",
  ])("rejects changed %s evidence before any manifest write", async (field) => {
    const fixture = await publicationRepairAliasFixture();
    const alias = { ...fixture.alias };
    if (field === "event") alias.eventId = crypto.randomUUID();
    if (field === "slug") alias.eventSlug = "other-event";
    if (field === "occurrence") alias.occurrenceId = crypto.randomUUID();
    if (field === "material") alias.materialId = "other";
    if (field === "version") alias.versionId = crypto.randomUUID();
    if (field === "digest") alias.digest = "0".repeat(64);
    if (field === "bytes") alias.bytes++;
    if (field === "sourcePath") alias.sourcePath = "content/events/2023/historical/_index.md";
    if (field === "sourceDigest") alias.sourceDigest = "0".repeat(64);
    if (field === "sourceKey") alias.sourceKey = "legacy:other";
    if (field === "sourceRef") alias.sourceRef = "other-row";
    if (field === "futureReview") alias.reviewedAt = "2099-01-01T00:00:00.000Z";
    await expect(resolvePublishedDocuments(env.DB, fixture.snapshot, [alias])).rejects.toThrow("SOURCE_CHANGED");
    expect(await manifests()).toEqual([]);
  });

  it("refuses an absent foreign event path despite valid owned document and source evidence", async () => {
    const fixture = await publicationRepairAliasFixture();
    const alias = { ...fixture.alias, urls: ["/events/2023/another-event/Absent.pdf"] };
    await expect(resolvePublishedDocuments(env.DB, fixture.snapshot, [alias])).rejects.toThrow("authored event route");
    expect(await manifests()).toEqual([]);
    expect(await resolveRetainedPublicationRepairAliases(env.DB)).toEqual([]);
  });

  it("refuses copied future-event ownership of the original authored repair namespace", async () => {
    const fixture = await publicationRepairAliasFixture("copy_as_new");
    expect(
      await env.DB.prepare("SELECT import_mode,source_path FROM event_agenda_import_provenance WHERE occurrence_id=?")
        .bind(fixture.occurrenceId)
        .first(),
    ).toMatchObject({ import_mode: "copy_as_new", source_path: fixture.alias.sourcePath });
    const withoutRepair = await resolvePublishedDocuments(env.DB, fixture.snapshot);
    expect(withoutRepair).toHaveLength(1);
    expect(withoutRepair[0]).toMatchObject({
      eventId: fixture.alias.eventId,
      occurrenceId: fixture.alias.occurrenceId,
      versionId: fixture.alias.versionId,
      digest: fixture.alias.digest,
      fileSize: fixture.alias.bytes,
    });
    await expect(resolvePublishedDocuments(env.DB, fixture.snapshot, [fixture.alias])).rejects.toThrow(
      "SOURCE_CHANGED",
    );
    expect(await manifests()).toEqual([]);
    expect(await resolveRetainedPublicationRepairAliases(env.DB)).toEqual([]);
  });

  it("rejects wrong private PDF bytes before collection or manifest persistence", async () => {
    const fixture = await publicationRepairAliasFixture();
    await requirePresentationBucket(env).put(fixture.r2Key, new Uint8Array(fixture.bytes.length));
    await expect(verified(fixture)).rejects.toThrow("content digest");
    expect(await manifests()).toEqual([]);
  });

  it.each(["provenance", "event route", "authored route", "import mode"])(
    "atomically refuses changed %s after preflight without partial manifest effects",
    async (change) => {
      const fixture = await publicationRepairAliasFixture();
      const documents = await verified(fixture);
      const raced = mutateBeforeNextBatch(env.DB, async () => {
        if (change === "provenance")
          await env.DB.prepare("UPDATE event_agenda_import_provenance SET source_digest=? WHERE occurrence_id=?")
            .bind("0".repeat(64), fixture.occurrenceId)
            .run();
        else if (change === "import mode")
          await env.DB.prepare(
            "UPDATE event_agenda_import_provenance SET import_mode='copy_as_new' WHERE occurrence_id=?",
          )
            .bind(fixture.occurrenceId)
            .run();
        else if (change === "authored route")
          await env.DB.prepare("UPDATE event_agenda_import_provenance SET source_path=? WHERE occurrence_id=?")
            .bind("content/events/2023/other/index.md", fixture.occurrenceId)
            .run();
        else await env.DB.prepare("UPDATE events SET slug='changed-route' WHERE id=?").bind(fixture.eventId).run();
      });
      await expect(recordPublishedDocuments(raced, fixture.snapshot, documents, fixture.machineEnv)).rejects.toThrow();
      expect(await manifests()).toEqual([]);
    },
  );

  it("retains only successful activation evidence on a fresh withdrawn build and never creates a delivery grant", async () => {
    const fixture = await publicationRepairAliasFixture();
    const documents = await verified(fixture);
    await recordPublishedDocuments(env.DB, fixture.snapshot, documents, fixture.machineEnv);
    expect(await resolveRetainedPublicationRepairAliases(env.DB)).toEqual([]);
    await activateRepairAliasFixture(fixture);
    expect(await resolveRetainedPublicationRepairAliases(env.DB)).toEqual([fixture.alias]);
    await env.DB.prepare(
      `INSERT INTO site_publication_document_manifests(build_id,snapshot_id,event_id,occurrence_id,material_id,version_id,digest,object_etag,repair_aliases_json)
      SELECT 'repeated-repair-build',snapshot_id,event_id,occurrence_id,material_id,version_id,digest,object_etag,repair_aliases_json FROM site_publication_document_manifests WHERE build_id=?`,
    )
      .bind(buildId)
      .run();
    await activateRepairAliasFixture(fixture, "repeated-repair-build");
    expect(await resolveRetainedPublicationRepairAliases(env.DB)).toEqual([fixture.alias]);
    fixture.snapshot.eventAgendas!["pqc-2026"].occurrences[0]!.history!.materials = [];
    expect(await resolvePublishedDocuments(env.DB, fixture.snapshot, [fixture.alias])).toEqual([]);
    const routes = collectDocumentRedirects(
      fixture.snapshot,
      [],
      [],
      [],
      [],
      await resolveRetainedPublicationRepairAliases(env.DB),
    );
    expect(routes.documents).toEqual([]);
    expect(routes.redirects.map(({ from }) => from).sort()).toEqual(publicationRepairAliasPaths(fixture.alias).sort());
    expect(routes.redirects.every(({ to }) => to === fixture.material.url)).toBe(true);
    expect(
      routes.retiredPaths.every(({ sha256, bytes }) => sha256 === fixture.digest && bytes === fixture.bytes.length),
    ).toBe(true);
  });

  it.each(["malformed", "owner", "digest", "route"])(
    "rejects activated %s evidence without trusting private manifest JSON",
    async (change) => {
      const fixture = await publicationRepairAliasFixture();
      await recordPublishedDocuments(env.DB, fixture.snapshot, await verified(fixture), fixture.machineEnv);
      const counterfeit =
        change === "malformed"
          ? "{}"
          : JSON.stringify([
              {
                ...fixture.alias,
                materialId: change === "owner" ? "foreign" : fixture.alias.materialId,
                digest: change === "digest" ? "0".repeat(64) : fixture.alias.digest,
                urls: change === "route" ? ["/events/2023/another-event/Absent.pdf"] : fixture.alias.urls,
              },
            ]);
      const badBuild = "bad-repair-evidence";
      await env.DB.prepare(
        `INSERT INTO site_publication_document_manifests(build_id,snapshot_id,event_id,occurrence_id,material_id,version_id,digest,object_etag,repair_aliases_json)
      SELECT ?,snapshot_id,event_id,occurrence_id,material_id,version_id,digest,object_etag,? FROM site_publication_document_manifests WHERE build_id=?`,
      )
        .bind(badBuild, counterfeit, buildId)
        .run();
      await activateRepairAliasFixture(fixture, badBuild);
      await expect(resolveRetainedPublicationRepairAliases(env.DB)).rejects.toThrow();
    },
  );

  it("refuses conflicting replay and immutable activated owner or byte evidence", async () => {
    const fixture = await publicationRepairAliasFixture();
    const documents = await verified(fixture);
    await recordPublishedDocuments(env.DB, fixture.snapshot, documents, fixture.machineEnv);
    const before = await manifests();
    const changed = { ...fixture.alias, urls: ["/events/2023/historical/Another.pdf"] };
    const replacements = await verifyPublicDocuments(
      await resolvePublishedDocuments(env.DB, fixture.snapshot, [changed]),
      (key) => requirePresentationBucket(env).get(key),
    );
    await expect(recordPublishedDocuments(env.DB, fixture.snapshot, replacements, fixture.machineEnv)).rejects.toThrow(
      "PUBLICATION_DOCUMENT_MANIFEST_CONFLICT",
    );
    expect(await manifests()).toEqual(before);
    await expect(
      env.DB.prepare("UPDATE site_publication_document_manifests SET repair_aliases_json='[]' WHERE build_id=?")
        .bind(buildId)
        .run(),
    ).rejects.toThrow("IMMUTABLE");
    await activateRepairAliasFixture(fixture);
    const badBuild = "conflicting-repair-build";
    await env.DB.prepare(
      `INSERT INTO site_publication_document_manifests(build_id,snapshot_id,event_id,occurrence_id,material_id,version_id,digest,object_etag,repair_aliases_json)
      SELECT ?,snapshot_id,event_id,occurrence_id,material_id,version_id,digest,object_etag,? FROM site_publication_document_manifests WHERE build_id=?`,
    )
      .bind(badBuild, JSON.stringify([{ ...fixture.alias, bytes: fixture.alias.bytes + 1 }]), buildId)
      .run();
    await activateRepairAliasFixture(fixture, badBuild);
    await expect(resolveRetainedPublicationRepairAliases(env.DB)).rejects.toThrow("exact owned bytes");
  });
});
