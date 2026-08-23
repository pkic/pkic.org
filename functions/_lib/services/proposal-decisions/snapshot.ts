import {
  proposalSpeakerEffectiveHeadshotExpression,
  proposalSpeakerEffectiveProfileExpression,
  type ProposalSpeakerWithUser,
} from "../proposal-speakers";

export interface ProposalDecisionEventSnapshot {
  name: string;
  slug: string;
  basePath: string | null;
  startsAt: string | null;
  settingsJson: string;
}

export interface ProposalDecisionSpeakerSnapshot {
  speakerId: string;
  userId: string;
  status: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  biography: string | null;
  headshotR2Key: string | null;
}

export function snapshotProposalDecisionSpeaker(speaker: ProposalSpeakerWithUser): ProposalDecisionSpeakerSnapshot {
  return {
    speakerId: speaker.speaker_id,
    userId: speaker.user_id,
    status: speaker.status,
    email: speaker.email,
    firstName: speaker.first_name,
    lastName: speaker.last_name,
    biography: speaker.biography,
    headshotR2Key: speaker.headshot_r2_key,
  };
}

export function proposalDecisionSnapshotPredicate(
  event: ProposalDecisionEventSnapshot,
  speakers: ProposalDecisionSpeakerSnapshot[],
): { sql: string; bindings: unknown[] } {
  const speakerPredicates = speakers.map(
    () => `EXISTS (
      SELECT 1 FROM proposal_speakers ps
      JOIN users u ON u.id = ps.user_id
      WHERE ps.proposal_id = sp.id AND ps.id = ? AND ps.user_id = ? AND ps.status = ?
        AND u.email = ?
        AND ${proposalSpeakerEffectiveProfileExpression("u", "ps", "firstName", "first_name")} IS ?
        AND ${proposalSpeakerEffectiveProfileExpression("u", "ps", "lastName", "last_name")} IS ?
        AND ${proposalSpeakerEffectiveProfileExpression("u", "ps", "biography", "biography")} IS ?
        AND ${proposalSpeakerEffectiveHeadshotExpression("u", "ps")} IS ?
    )`,
  );
  return {
    sql: `AND EXISTS (
            SELECT 1 FROM events e
            WHERE e.id = sp.event_id AND e.name = ? AND e.slug = ?
              AND e.base_path IS ? AND e.starts_at IS ? AND e.settings_json = ?
          )
          AND (SELECT COUNT(*) FROM proposal_speakers ps WHERE ps.proposal_id = sp.id) = ?
          ${speakerPredicates.map((predicate) => `AND ${predicate}`).join("\n")}`,
    bindings: [
      event.name,
      event.slug,
      event.basePath,
      event.startsAt,
      event.settingsJson,
      speakers.length,
      ...speakers.flatMap((speaker) => [
        speaker.speakerId,
        speaker.userId,
        speaker.status,
        speaker.email,
        speaker.firstName,
        speaker.lastName,
        speaker.biography,
        speaker.headshotR2Key,
      ]),
    ],
  };
}
