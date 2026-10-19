/**
 * The accepted proposal a new session content comes from, decided once when the content is written and stored in
 * `event_agenda_contents.proposal_id`; queries read that link and never match titles.
 *
 * An accepted-proposal import names its proposal in its source key. A legacy import does not, so it is linked when
 * exactly one accepted proposal of the same event has the same title, ignoring case and surrounding spaces, the rule
 * migration 0038 applied to the contents that already existed. Any other content, such as a session typed in by
 * hand, stays unlinked.
 *
 * Bind with `agendaContentProposalLinkBindings`.
 */
export const AGENDA_CONTENT_PROPOSAL_LINK_SQL = `CASE
  WHEN ? LIKE 'proposal:%' THEN (SELECT proposal.id FROM session_proposals proposal WHERE proposal.id=SUBSTR(?,10) AND proposal.event_id=?)
  WHEN ? LIKE 'legacy:%' THEN (
    SELECT CASE WHEN COUNT(*)=1 THEN MIN(proposal.id) END FROM session_proposals proposal
    WHERE proposal.event_id=? AND proposal.status='accepted' AND proposal.deleted_at IS NULL
      AND LOWER(TRIM(proposal.title))=LOWER(TRIM(?)))
END`;

export function agendaContentProposalLinkBindings(eventId: string, sourceKey: string | null, title: string) {
  return [sourceKey, sourceKey, eventId, sourceKey, eventId, title];
}
