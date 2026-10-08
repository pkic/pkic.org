import { resolveAgendaDurationRules } from "../../../../../../../shared/event-agenda-duration";
import type { z } from "zod";
import { eventProposalDetailResponseSchema } from "../../../../../../../shared/schemas/event-proposals";
import {
  agendaImportSchema,
  agendaImportResponseSchema,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import { getJson, postJson } from "../../../../../../shared/api-client";

export async function acceptedProposalPlacementSource(snapshot: AgendaSnapshot, id: string) {
  const detail = await getJson(`/api/v1/proposals/${encodeURIComponent(id)}`, eventProposalDetailResponseSchema);
  const type = detail.sessionTypes.find(
    (value) => value.label.toLocaleLowerCase("en-US") === detail.proposal.proposal_type.toLocaleLowerCase("en-US"),
  );
  return {
    detail,
    durationMinutes: type?.durationMinutes ?? resolveAgendaDurationRules(snapshot.durationRules).defaultMinutes,
  };
}
export function acceptedProposalPlacementBody(
  snapshot: AgendaSnapshot,
  id: string,
  position: { startAt: string; endAt: string; roomId: string },
) {
  return agendaImportSchema.parse({
    expectedRevision: snapshot.revision,
    source: "accepted_proposals",
    proposalIds: [id],
    dryRun: true,
    proposalPlacement: { proposalId: id, ...position, additionalRoomIds: [] },
  });
}
export async function previewAcceptedProposalPlacement(
  snapshot: AgendaSnapshot,
  body: z.infer<typeof agendaImportSchema>,
) {
  const reviewed = await postJson(
    `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/imports`,
    body,
    agendaImportResponseSchema,
  );
  if (!reviewed.placementFingerprint)
    throw new Error("The placement did not return its source verification. Try again.");
  return reviewed.placementFingerprint;
}
export function applyAcceptedProposalPlacement(
  snapshot: AgendaSnapshot,
  body: z.infer<typeof agendaImportSchema>,
  fingerprint: string,
) {
  return postJson(
    `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/imports`,
    agendaImportSchema.parse({ ...body, dryRun: false, expectedPlacementFingerprint: fingerprint }),
    agendaImportResponseSchema,
  );
}
export async function saveAcceptedProposalAt(snapshot: AgendaSnapshot, id: string, startAt: string, roomId: string) {
  const source = await acceptedProposalPlacementSource(snapshot, id);
  const endAt = new Date(Date.parse(startAt) + source.durationMinutes * 60000).toISOString();
  const body = acceptedProposalPlacementBody(snapshot, id, { startAt, endAt, roomId });
  const fingerprint = await previewAcceptedProposalPlacement(snapshot, body);
  return applyAcceptedProposalPlacement(snapshot, body, fingerprint);
}
