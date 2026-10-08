import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { publicationRepairAliasFixture } from "./helpers/site-publication-repair-alias-fixture";
import { resolveAuthoredAgendaRouteOwners } from "../functions/_lib/services/site-publication-agenda-routes";
import { publicationAuthoredAgendaRoutes } from "../assets/shared/publication-agenda-routes";

import {
  agendaOccurrencePatchSchema,
  agendaPublicationSchema,
  agendaSnapshotSchema,
} from "../assets/shared/schemas/event-agenda";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { approvedEventAgendaForRoute } from "../functions/_lib/services/site-published-event-agendas";
import { createSiteConferencePrograms } from "../functions/_lib/services/site-conference-program-catalog";
import { renderContentAgenda } from "../functions/_lib/services/site-agenda";
import { parseFrontMatter, contentPathToRoute } from "../functions/_lib/services/site-markdown";
import { nodePathForSource, type ContentDocument } from "../functions/_lib/services/site-documents";

async function fixture(mode?: "archive" | "copy_as_new") {
  const value = await publicationRepairAliasFixture(mode);
  const agenda = value.snapshot.eventAgendas!["pqc-2026"];
  const authored = [
    { sourcePath: value.alias.sourcePath, sourceDigest: value.alias.sourceDigest, route: "/events/2023/historical/" },
  ];
  return { ...value, agenda, authored };
}

describe("trusted original event-root agenda ownership", () => {
  beforeEach(resetDb);
  it("owns the exact authored root despite a different current event slug without changing DB paths", async () => {
    const value = await fixture();
    const before = await env.DB.prepare("SELECT source_path,base_path FROM events WHERE id=?")
      .bind(value.eventId)
      .first();
    const routes = await resolveAuthoredAgendaRouteOwners(env.DB, value.eventId, value.agenda, value.authored);
    expect(routes).toEqual([{ ...value.authored[0], eventSlug: "pqc-2026" }]);
    expect(
      publicationAuthoredAgendaRoutes({ eventAgendas: value.snapshot.eventAgendas, authoredAgendaRoutes: routes }),
    ).toEqual(routes);
    expect(
      await env.DB.prepare("SELECT source_path,base_path FROM events WHERE id=?").bind(value.eventId).first(),
    ).toEqual(before);
  });
  it("does not give a future copy ownership of the original source-page namespace", async () => {
    const value = await fixture("copy_as_new");
    expect(await resolveAuthoredAgendaRouteOwners(env.DB, value.eventId, value.agenda, value.authored)).toEqual([]);
  });
  it.each(["digest", "ambiguous source", "untrusted mode"])("refuses %s ownership evidence", async (change) => {
    const value = await fixture();
    const authored = change === "digest" ? [{ ...value.authored[0]!, sourceDigest: "0".repeat(64) }] : value.authored;
    if (change === "ambiguous source") authored.push({ ...authored[0]!, route: "/events/other/" });
    if (change === "untrusted mode")
      await env.DB.prepare("UPDATE event_agenda_import_provenance SET import_mode='unreviewed' WHERE occurrence_id=?")
        .bind(value.occurrenceId)
        .run();
    await expect(resolveAuthoredAgendaRouteOwners(env.DB, value.eventId, value.agenda, authored)).rejects.toThrow();
  });
  it("excludes foreign-event occurrences and unapproved occurrence IDs", async () => {
    const value = await fixture();
    expect(await resolveAuthoredAgendaRouteOwners(env.DB, crypto.randomUUID(), value.agenda, value.authored)).toEqual(
      [],
    );
    expect(
      await resolveAuthoredAgendaRouteOwners(
        env.DB,
        value.eventId,
        { ...value.agenda, occurrences: [] },
        value.authored,
      ),
    ).toEqual([]);
  });
  it("keeps the original authored root empty when all approved historical sessions become private", async () => {
    const value = await fixture();
    await env.DB.prepare("UPDATE events SET visibility='public' WHERE id=?").bind(value.eventId).run();
    const token = await createAdminSession(env.DB, value.admin.id, "authored-root-lifecycle");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const path = "/api/v1/events/pqc-2026/agenda";
    async function approve(expectedRevision: number) {
      const response = await callApi(env, `${path}/publications`, {
        method: "POST",
        headers,
        body: JSON.stringify(
          agendaPublicationSchema.parse({ expectedRevision, acknowledgeArchiveRepresentation: true }),
        ),
      });
      expect(response.status, await response.clone().text()).toBe(200);
      return agendaSnapshotSchema.parse(await response.json());
    }
    const first = await approve(value.agenda.revision);
    const initiallyPublished = await readSitePublicationSnapshot(env.DB, [], [], value.authored);
    expect(initiallyPublished.authoredAgendaRoutes).toEqual([{ ...value.authored[0], eventSlug: first.eventSlug }]);
    expect(initiallyPublished.eventAgendas![first.eventSlug]!.occurrences.map((item) => item.id)).toEqual([
      value.occurrenceId,
    ]);
    const changed = await callApi(env, `${path}/occurrences/${value.occurrenceId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(
        agendaOccurrencePatchSchema.parse({ expectedRevision: first.revision, visibility: "private" }),
      ),
    });
    expect(changed.status, await changed.clone().text()).toBe(200);
    const privateDraft = agendaSnapshotSchema.parse(await changed.json());
    const approved = await approve(privateDraft.revision);
    expect(approved.occurrences).toHaveLength(1);
    expect(approved.occurrences[0]!.visibility).toBe("private");
    const publication = await readSitePublicationSnapshot(env.DB, [], [], value.authored);
    const publicAgenda = publication.eventAgendas![approved.eventSlug]!;
    expect(publicAgenda.occurrences).toEqual([]);
    expect(publication.authoredAgendaRoutes).toEqual(initiallyPublished.authoredAgendaRoutes);
    const originalRoot = value.authored[0]!.route;
    expect(publicAgenda.publicAgendaPath).not.toBe(`${originalRoot}agenda/`);
    expect(approvedEventAgendaForRoute(publication, originalRoot)).toEqual(publicAgenda);

    const retiredTitle = "Authored raw session must stay retired";
    const retiredRecording = "https://example.test/legacy-recording";
    const raw = {
      timezone: "UTC",
      agenda: {
        "2023-04-01": [{ time: "10:00", sessions: [{ title: retiredTitle, recordingUrl: retiredRecording }] }],
      },
    };
    const parsed = parseFrontMatter(
      `---\ntitle: Historical event\noutputs: [event-data]\ndata: ${JSON.stringify(raw)}\n---\n{{< agenda >}}\n`,
    );
    const sourcePath = `../../${value.authored[0]!.sourcePath}`;
    const document: ContentDocument = {
      ...parsed,
      sourcePath,
      route: contentPathToRoute(sourcePath, parsed.data),
      nodePath: nodePathForSource(sourcePath),
      language: "en",
      isSection: false,
    };
    expect(document.route).toBe(originalRoot);
    const program = createSiteConferencePrograms([document], () => [])(publication)[0]!.program;
    expect(program.agenda).toEqual({});
    expect(JSON.stringify(program)).not.toContain(retiredTitle);
    expect(JSON.stringify(program)).not.toContain(retiredRecording);
    const html = await renderContentAgenda(
      {
        publication,
        route: originalRoot,
        eventRoute: originalRoot,
        eventData: raw,
        data: {},
        assetUrl: () => undefined,
        assetUrls: () => [],
        listing: () => ({ heading: "", kind: "events", items: [], page: 1, pageCount: 1 }),
        sourcePath: value.authored[0]!.sourcePath,
      },
      async () => {
        throw new Error("Empty approved agenda must not render authored Markdown");
      },
    );
    expect(html).not.toContain(retiredTitle);
    expect(html).not.toContain(retiredRecording);
    expect(html).not.toContain(approved.occurrences[0]!.title);
  });
});
