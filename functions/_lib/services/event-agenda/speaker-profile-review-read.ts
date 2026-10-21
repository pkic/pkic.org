import type { z } from "zod";
import {
  speakerProfileReviewSchema,
  speakerProfileReviewQuerySchema,
} from "../../../../assets/shared/schemas/event-speaker-profile-reviews";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { sha256Hex } from "../../utils/crypto";
import { publicUserHeadshotPath } from "../user-headshot";
import { creditedIdentityIdSql } from "./credited-identity";
import { agendaSpeakerDisplayNameSql } from "./speaker-name";
import { identityJobTitleSql } from "../identities/affiliation-projection";

/** Only ordinary/current sessions use live profile reviews; archive appearances retain their own evidence. */
export const speakerProfilesSql = `WITH credits AS (
 SELECT speaker.user_id,occurrence.id AS occurrence_id,selected.value AS identity_id,
 json_type(credit_event.settings_json,'$.agenda.sessionSpeakerIdentities.'||json_quote(occurrence.id)||'.'||json_quote(speaker.user_id))='array' AS explicit_identity
 FROM event_agenda_occurrences occurrence
 JOIN event_agenda_occurrence_speakers speaker ON speaker.occurrence_id=occurrence.id
 JOIN events credit_event ON credit_event.id=occurrence.event_id
 JOIN json_each(COALESCE(json_extract(credit_event.settings_json,
   '$.agenda.sessionSpeakerIdentities.'||json_quote(occurrence.id)||'.'||json_quote(speaker.user_id)),
   json_array(${creditedIdentityIdSql("occurrence.id", "speaker.user_id")}))) selected
 LEFT JOIN event_agenda_import_provenance provenance ON provenance.occurrence_id=occurrence.id
 WHERE occurrence.event_id=? AND occurrence.start_at IS NOT NULL AND occurrence.end_at IS NOT NULL
 AND COALESCE(provenance.import_mode,'current')<>'archive'
), canonical AS (
 SELECT credits.user_id,credits.identity_id,${agendaSpeakerDisplayNameSql} AS display_name,
 MAX(COALESCE(credits.explicit_identity,0)) AS explicit_identity,COUNT(DISTINCT credits.occurrence_id) AS session_count,json_group_array(DISTINCT credits.occurrence_id) AS occurrence_ids,
 (user.active=1 AND user.pii_redacted_at IS NULL AND user.merged_into_user_id IS NULL AND identity.id IS NOT NULL) AS available,
 json_object('userId',user.id,'displayName',${agendaSpeakerDisplayNameSql},'identityId',identity.id,
 'organizationId',organization.id,'organizationName',organization.name,'jobTitle',${identityJobTitleSql("identity.id")},
 'biography',COALESCE(identity.biography,''),'links',json(COALESCE(identity.links_json,'[]')),'headshotKey',user.headshot_r2_key) AS profile_json,
 json_array(user.updated_at,identity.updated_at,organization.updated_at,user.headshot_r2_key,user.active,user.pii_redacted_at,user.merged_into_user_id) AS canonical_version,
 MIN(COALESCE((SELECT MAX(json_extract(appearance.value,'$.approvedAt'))
 FROM json_each(history.metadata_json,'$.appearances') appearance
 WHERE json_extract(appearance.value,'$.userId')=user.id
 AND json_extract(appearance.value,'$.displayName')=${agendaSpeakerDisplayNameSql}
 AND json_extract(appearance.value,'$.biography')=COALESCE(identity.biography,'')
 AND json_array_length(appearance.value,'$.affiliations')=1
 AND json_extract(appearance.value,'$.affiliations[0].identityId')=identity.id
 AND json_extract(appearance.value,'$.affiliations[0].title') IS ${identityJobTitleSql("identity.id")}
 AND json_extract(appearance.value,'$.affiliations[0].organizationId') IS organization.id
 AND json_extract(appearance.value,'$.affiliations[0].organizationName') IS organization.name
 AND json_extract(appearance.value,'$.approvedAt')>=user.updated_at
 AND json_extract(appearance.value,'$.approvedAt')>=identity.updated_at
 AND (organization.updated_at IS NULL OR json_extract(appearance.value,'$.approvedAt')>=organization.updated_at)),'')) AS legacy_reviewed_at
 FROM credits JOIN users user ON user.id=credits.user_id
 LEFT JOIN event_agenda_session_history history ON history.occurrence_id=credits.occurrence_id
 LEFT JOIN identities identity ON identity.id=credits.identity_id AND identity.user_id=user.id
 LEFT JOIN organizations organization ON organization.id=identity.organization_id
 GROUP BY credits.user_id,credits.identity_id
), profiles AS (
 SELECT canonical.explicit_identity,canonical.user_id,canonical.identity_id,canonical.display_name,canonical.session_count,canonical.occurrence_ids,canonical.available,canonical.profile_json,canonical.canonical_version,canonical.legacy_reviewed_at,json_extract(event.settings_json,'$.agenda.speakerProfileReviews.'||json_quote(canonical.identity_id)) AS receipt
 FROM canonical JOIN events event ON event.id=?
), reviewed_profiles AS (
 SELECT profiles.explicit_identity,profiles.user_id,profiles.identity_id,profiles.display_name,profiles.session_count,profiles.occurrence_ids,profiles.available,profiles.profile_json,profiles.canonical_version,profiles.legacy_reviewed_at,profiles.receipt,CASE WHEN available=1 AND explicit_identity=0 AND receipt IS NULL AND legacy_reviewed_at<>'' THEN legacy_reviewed_at
 WHEN available=1 AND json_extract(receipt,'$.userId')=user_id
 AND json_extract(receipt,'$.canonicalVersion')=canonical_version THEN json_extract(receipt,'$.reviewedAt') END AS reviewed_at
 FROM profiles
)`;

export type SpeakerProfileRow = {
  explicit_identity: number;
  user_id: string;
  identity_id: string | null;
  display_name: string;
  session_count: number;
  occurrence_ids: string;
  available: number;
  profile_json: string;
  canonical_version: string;
  receipt: string | null;
  reviewed_at: string | null;
};
export const speakerProfileColumns =
  "explicit_identity,user_id,identity_id,display_name,session_count,occurrence_ids,available,profile_json,canonical_version,receipt,reviewed_at";

export async function decodeSpeakerProfile(row: SpeakerProfileRow) {
  const { headshotKey, ...profile } = JSON.parse(row.profile_json);
  return speakerProfileReviewSchema.parse({
    ...profile,
    links: parseLinksJson(JSON.stringify(profile.links)),
    photoUrl: publicUserHeadshotPath(row.user_id, headshotKey),
    profileDigest: await sha256Hex(JSON.stringify([row.canonical_version, row.profile_json])),
    sessionCount: row.session_count,
    available: Boolean(row.available),
    reviewedAt: row.reviewed_at,
  });
}

export async function listSpeakerProfileReviews(
  db: DatabaseLike,
  eventId: string,
  query: z.infer<typeof speakerProfileReviewQuerySchema>,
) {
  const where =
    "WHERE INSTR(LOWER(display_name),LOWER(?))>0 AND (?='all' OR (?='approved' AND reviewed_at IS NOT NULL) OR (?='pending' AND reviewed_at IS NULL))";
  const bindings = [eventId, eventId, query.q ?? "", query.status, query.status, query.status];
  const count = await first<{ total: number }>(
    db,
    `${speakerProfilesSql} SELECT COUNT(*) AS total FROM reviewed_profiles ${where}`,
    bindings,
  );
  const rows = await all<SpeakerProfileRow>(
    db,
    `${speakerProfilesSql} SELECT ${speakerProfileColumns} FROM reviewed_profiles ${where} ORDER BY display_name ${query.sort === "-displayName" ? "DESC" : "ASC"},user_id,identity_id LIMIT ? OFFSET ?`,
    [...bindings, query.limit, query.offset],
  );
  return {
    profiles: await Promise.all(rows.map(decodeSpeakerProfile)),
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, rows.length),
  };
}
