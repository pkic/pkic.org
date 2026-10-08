import {
  PROPOSAL_PROFILE_FIELDS,
  proposalProfileFieldNames,
  type ProposalProfileField,
} from "./proposal-speaker-profile-overrides";

/** Effective profile projection: proposal overrides are scoped to this roster row. */
export function proposalSpeakerEffectiveProfileExpression(
  userAlias: string,
  speakerAlias: string,
  key: string,
  userColumn: string,
): string {
  const identityOwned = ["organizationName", "jobTitle", "biography", "links"].includes(key);
  const legacyBase = ["organizationName", "jobTitle"].includes(key) ? "NULL" : `${userAlias}.${userColumn}`;
  const base = identityOwned
    ? `CASE WHEN ${speakerAlias}.acting_identity_selected_at IS NOT NULL THEN json_extract(${speakerAlias}.acting_identity_snapshot_json, '$.${key}') ELSE ${legacyBase} END`
    : `${userAlias}.${userColumn}`;
  return `CASE WHEN json_type(COALESCE(${speakerAlias}.profile_overrides_json, '{}'), '$.${key}') IS NULL THEN ${base} ELSE json_extract(${speakerAlias}.profile_overrides_json, '$.${key}') END`;
}

export function proposalSpeakerEffectiveHeadshotExpression(userAlias = "u", speakerAlias = "ps"): string {
  return `CASE WHEN ${speakerAlias}.headshot_override_set = 1 THEN ${speakerAlias}.headshot_r2_key ELSE ${userAlias}.headshot_r2_key END`;
}

export function proposalSpeakerEffectiveProfileColumns(
  userAlias = "u",
  speakerAlias = "ps",
  prefix = "",
  fields: readonly ProposalProfileField[] = proposalProfileFieldNames(),
): string {
  const effective = (key: string, column: string, alias: string) =>
    `${proposalSpeakerEffectiveProfileExpression(userAlias, speakerAlias, key, column)} AS ${prefix}${alias}`;
  return fields.map((key) => effective(key, PROPOSAL_PROFILE_FIELDS[key], PROPOSAL_PROFILE_FIELDS[key])).join(",\n  ");
}

export function proposalSpeakerEffectiveHeadshotColumns(userAlias = "u", speakerAlias = "ps", prefix = ""): string {
  return [
    `${proposalSpeakerEffectiveHeadshotExpression(userAlias, speakerAlias)} AS ${prefix}headshot_r2_key`,
    `CASE WHEN ${speakerAlias}.headshot_override_set = 1 THEN ${speakerAlias}.headshot_updated_at ELSE ${userAlias}.headshot_updated_at END AS ${prefix}headshot_updated_at`,
  ].join(",\n  ");
}
