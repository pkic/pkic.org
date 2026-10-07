import { acceptedProposalFreeSpots } from "./accepted-proposal-free-spots";
import {
  acceptedProposalPlacementSource,
  acceptedProposalPlacementBody,
  previewAcceptedProposalPlacement,
  applyAcceptedProposalPlacement,
} from "./accepted-proposal-placement";
import { ApiClientError, getJson, postJson } from "../../../../../../shared/api-client";
import { MAX_PAGE_LIMIT, MAX_PAGE_OFFSET } from "../../../../../../../shared/schemas/pagination";
import { eventProposalsResponseSchema } from "../../../../../../../shared/schemas/event-proposals";
import {
  agendaImportSchema,
  agendaImportResponseSchema,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";

/** Read every server page before importing; an interrupted catalogue read never becomes a partial Add all. */
export async function acceptedProposalIds(
  eventSlug: string,
  query: Readonly<Record<string, string>> = {},
): Promise<string[]> {
  const ids = new Set<string>();
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      ...query,
      status: "accepted",
      sort: "title",
      agenda: "unimported",
      limit: String(MAX_PAGE_LIMIT),
      offset: String(offset),
    });
    const page = await getJson(
      `/api/v1/events/${encodeURIComponent(eventSlug)}/proposals?${params}`,
      eventProposalsResponseSchema,
    );
    if (!page.access.canRead) throw new Error("You cannot read accepted proposals.");
    for (const proposal of page.proposals) ids.add(proposal.id);
    if (!page.page.hasMore) return [...ids];
    if (!page.proposals.length || offset + page.page.limit > MAX_PAGE_OFFSET)
      throw new Error("The complete proposal catalogue could not be read. Choose proposals explicitly.");
    offset += page.page.limit;
  }
}

/** Each batch uses the existing source-key importer and the revision returned by its predecessor. */
export async function importAcceptedProposalBatches(
  snapshot: AgendaSnapshot,
  ids: string[],
  dryRun: boolean,
  onCommitted?: (agenda: AgendaSnapshot, counts: { imported: number; skipped: number }) => void,
) {
  let agenda = snapshot;
  let imported = 0;
  let skipped = 0;
  for (let offset = 0; offset < ids.length; offset += 100) {
    const body = agendaImportSchema.parse({
      expectedRevision: agenda.revision,
      source: "accepted_proposals",
      proposalIds: ids.slice(offset, offset + 100),
      dryRun,
    });
    const result = await postJson(
      `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/imports`,
      body,
      agendaImportResponseSchema,
    );
    agenda = result.agenda;
    imported += result.imported;
    skipped += result.skipped;
    if (!dryRun) onCommitted?.(agenda, { imported, skipped });
  }
  return { agenda, imported, skipped };
}

/** A preview fingerprint binds each chosen random position to the exact accepted source and agenda revision. */
export async function placeAcceptedProposals(
  snapshot: AgendaSnapshot,
  ids: string[],
  day: string,
  step: number,
  onCommitted: (agenda: AgendaSnapshot, placed: number) => void,
) {
  let agenda = snapshot;
  let placed = 0;
  const noFit: string[] = [];
  for (const id of new Set(ids)) {
    const { detail, durationMinutes } = await acceptedProposalPlacementSource(agenda, id);
    const candidates = acceptedProposalFreeSpots(agenda, day, durationMinutes, step).slice(0, 32);
    let saved = false;
    for (const candidate of candidates) {
      const body = acceptedProposalPlacementBody(agenda, id, candidate);
      let fingerprint: string;
      try {
        fingerprint = await previewAcceptedProposalPlacement(agenda, body);
      } catch (error) {
        if (error instanceof ApiClientError && error.code === "AGENDA_SCHEDULE_CONFLICT" && error.status === 409)
          continue;
        throw error;
      }
      const result = await applyAcceptedProposalPlacement(agenda, body, fingerprint);
      agenda = result.agenda;
      placed += result.imported;
      onCommitted(agenda, placed);
      saved = true;
      break;
    }
    if (!saved)
      noFit.push(
        `${detail.proposal.title}: could not fit the reviewed positions on ${day}; try again, choose another day, or schedule it manually.`,
      );
  }
  return { agenda, placed, noFit };
}
