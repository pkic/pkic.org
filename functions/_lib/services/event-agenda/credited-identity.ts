/**
 * The one rule for the identity a person credited on an agenda session speaks
 * as: the identity explicitly selected for that session, else the identity chosen on the
 * accepted proposal the session came from (chosen, else individual — see
 * `proposalSpeakerIdentityIdSql`), else their primary identity. The agenda's
 * draft credits, the studio's lower thirds and every other reader of a
 * credited person's title, organization, biography and links resolve it here.
 */
import { primaryIdentityIdSql } from "../identities/affiliation-projection";
import { proposalSpeakerIdentityIdSql } from "../proposal-speaker-profile-projection";

/** Trusted SQL expressions only (aliases or `?`), never caller text. */
export function creditedIdentityIdSql(occurrenceIdSql: string, userIdSql: string): string {
  return `(SELECT COALESCE((SELECT selected_identity.id
      FROM identities selected_identity
      WHERE selected_identity.id=json_extract(credited_event.settings_json,
        '$.agenda.sessionSpeakerIdentities.'||json_quote(credited_occurrence.id)||'.'||json_quote(${userIdSql})||'[0]')
        AND selected_identity.user_id=${userIdSql}),
      (SELECT ${proposalSpeakerIdentityIdSql("credited_speaker")}
      FROM session_proposals credited_proposal
      JOIN proposal_speakers credited_speaker ON credited_speaker.proposal_id=credited_proposal.id
      WHERE credited_proposal.id=substr(credited_occurrence.source_key,10)
        AND credited_proposal.event_id=credited_occurrence.event_id
        AND credited_occurrence.source_key='proposal:'||credited_proposal.id
        AND credited_proposal.deleted_at IS NULL AND credited_proposal.status='accepted'
        AND credited_speaker.user_id=${userIdSql} AND credited_speaker.status<>'declined' LIMIT 1),
      ${primaryIdentityIdSql(userIdSql)})
      FROM event_agenda_occurrences credited_occurrence
      JOIN events credited_event ON credited_event.id=credited_occurrence.event_id
      WHERE credited_occurrence.id=${occurrenceIdSql})`;
}
