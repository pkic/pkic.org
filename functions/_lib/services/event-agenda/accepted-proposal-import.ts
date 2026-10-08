import type { DatabaseLike } from "../../types";
import { all } from "../../db/queries";
import { AppError } from "../../errors";
import { agendaCreditRoleSchema, agendaImportSchema } from "../../../../assets/shared/schemas/event-agenda";
import { sessionProposalRepresentationSchema } from "../../../../assets/shared/schemas/event-session-history";

/** Batch only explicitly selected sources; all previously imported decisions remain eligible for withdrawal review. */
export async function loadAcceptedProposalAgendaImport(db: DatabaseLike, eventId: string, proposalIds?: string[]) {
  const selected = JSON.stringify(proposalIds ?? []);
  const proposals = await all<{ id: string; title: string; abstract: string }>(
    db,
    `SELECT id,title,abstract FROM session_proposals WHERE event_id=? AND status='accepted'${proposalIds ? " AND id IN(SELECT value FROM json_each(?))" : ""} ORDER BY id LIMIT 101`,
    proposalIds ? [eventId, selected] : [eventId],
  );
  if (proposalIds && proposals.length !== proposalIds.length)
    throw new AppError(
      422,
      "AGENDA_IMPORT_PROPOSAL_INELIGIBLE",
      "Every selected proposal must be accepted and belong to this event.",
    );
  if (proposals.length > 100)
    throw new AppError(422, "AGENDA_IMPORT_LIMIT", "Select a batch of at most 100 accepted proposals to import.");
  const batch = JSON.stringify(proposals.map((row) => row.id));
  const statuses = await all<{ id: string; status: string }>(
    db,
    "SELECT id,status FROM session_proposals WHERE event_id=? AND (id IN(SELECT value FROM json_each(?)) OR id IN(SELECT SUBSTR(source_key,10) FROM event_agenda_contents WHERE event_id=? AND source_key LIKE 'proposal:%')) ORDER BY id LIMIT 2001",
    [eventId, batch, eventId],
  );
  if (statuses.length > 2000)
    throw new AppError(
      422,
      "AGENDA_IMPORT_STATUS_LIMIT",
      "Review imported proposal decisions in events with at most 2,000 imported sources.",
    );
  const speakers = await all<{
    proposal_id: string;
    user_id: string | null;
    role: string;
    acting_identity_id: string | null;
    acting_identity_selected_at: string | null;
    acting_identity_snapshot_json: string | null;
  }>(
    db,
    "SELECT proposal_id,user_id,role,acting_identity_id,acting_identity_selected_at,acting_identity_snapshot_json FROM proposal_speakers WHERE proposal_id IN(SELECT value FROM json_each(?)) AND status='confirmed' ORDER BY proposal_id,id LIMIT 3001",
    [batch],
  );
  if (speakers.length > 3000)
    throw new AppError(422, "AGENDA_IMPORT_SPEAKER_LIMIT", "Import at most 30 credited people per proposal.");
  const candidates = proposals.map((proposal) => {
    const roster = speakers.filter((speaker) => speaker.proposal_id === proposal.id);
    if (
      roster.length > 30 ||
      roster.some((speaker) => !speaker.user_id) ||
      new Set(roster.map((speaker) => speaker.user_id)).size !== roster.length
    )
      throw new AppError(
        422,
        "AGENDA_IMPORT_SPEAKER_REVIEW_REQUIRED",
        "Resolve each selected proposal's confirmed roster to at most 30 distinct canonical people before importing.",
      );
    return {
      sourceKey: `proposal:${proposal.id}`,
      title: proposal.title,
      description: proposal.abstract,
      startAt: null,
      endAt: null,
      roomId: null,
      admissionPolicy: "preference" as const,
      capacity: null,
      remoteCapacity: null,
      visibility: "public" as const,
      kind: "session" as const,
      speakerUserIds: roster.map((speaker) => speaker.user_id!),
      speakerRoles: Object.fromEntries(
        roster.map((speaker) => [speaker.user_id!, agendaCreditRoleSchema.parse(speaker.role)]),
      ),
    };
  });
  return {
    candidates: agendaImportSchema.shape.occurrences.parse(candidates),
    representations: new Map(
      proposals.map((proposal) => [
        `proposal:${proposal.id}`,
        speakers
          .filter((speaker) => speaker.proposal_id === proposal.id)
          .map((speaker) =>
            sessionProposalRepresentationSchema.parse({
              userId: speaker.user_id!,
              actingIdentityId: speaker.acting_identity_id,
              selectedAt: speaker.acting_identity_selected_at,
              snapshot: speaker.acting_identity_snapshot_json
                ? JSON.parse(speaker.acting_identity_snapshot_json)
                : null,
            }),
          ),
      ]),
    ),
    statuses: new Map(statuses.map((row) => [row.id, row.status])),
  };
}
