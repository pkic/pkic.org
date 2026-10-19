/**
 * The one rule for the identity a person credited on an agenda session speaks
 * as when no approved appearance names one: the identity they chose on the
 * accepted proposal the session came from (chosen, else individual — see
 * `proposalSpeakerIdentityIdSql`), else their primary identity. The agenda's
 * draft credits, the studio's lower thirds and every other reader of a
 * credited person's title, organization, biography and links resolve it here.
 */
import { primaryIdentityIdSql } from "../identities/affiliation-projection";
import { proposalSpeakerIdentityIdSql } from "../proposal-speaker-profile-projection";

/** Trusted SQL expressions only (aliases or `?`), never caller text. */
export function creditedIdentityIdSql(occurrenceIdSql: string, userIdSql: string): string {
  return `COALESCE((SELECT ${proposalSpeakerIdentityIdSql("credited_speaker")}
      FROM event_agenda_occurrences credited_occurrence
      JOIN session_proposals credited_proposal ON credited_proposal.event_id = credited_occurrence.event_id
        AND credited_occurrence.source_key = 'proposal:' || credited_proposal.id
        AND credited_proposal.deleted_at IS NULL AND credited_proposal.status = 'accepted'
      JOIN proposal_speakers credited_speaker ON credited_speaker.proposal_id = credited_proposal.id
        AND credited_speaker.user_id = ${userIdSql} AND credited_speaker.status <> 'declined'
     WHERE credited_occurrence.id = ${occurrenceIdSql}
     LIMIT 1), ${primaryIdentityIdSql(userIdSql)})`;
}
