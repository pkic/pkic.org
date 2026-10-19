/**
 * The one read model of how a proposal speaker appears: every value comes from
 * where it is kept, never from a copy on the roster row. The person owns the
 * name and headshot; the identity the speaker speaks as owns the organization,
 * job title, biography and links. An edit of either shows on every proposal,
 * email, badge and agenda that reads through here.
 *
 * The identity is resolved per row: the one the speaker chose, else their
 * individual identity when they chose to take part as an individual, else (no
 * choice recorded yet) their primary identity.
 *
 * Every builder takes trusted SQL aliases, never caller-supplied text.
 */
import {
  identityJobTitleSql,
  identityOrganizationNameSql,
  individualIdentityIdSql,
  primaryIdentityIdSql,
} from "./identities/affiliation-projection";

/** The identity a speaker speaks as on this proposal, as a SQL expression. */
export function proposalSpeakerIdentityIdSql(speakerAlias = "ps"): string {
  return `CASE WHEN ${speakerAlias}.acting_identity_id IS NOT NULL THEN ${speakerAlias}.acting_identity_id
    WHEN ${speakerAlias}.acting_identity_selected_at IS NOT NULL THEN ${individualIdentityIdSql(`${speakerAlias}.user_id`)}
    ELSE ${primaryIdentityIdSql(`${speakerAlias}.user_id`)} END`;
}

/** The organization a speaker appears with: the one the identity they speak as speaks for. */
export function proposalSpeakerOrganizationNameSql(speakerAlias = "ps"): string {
  return identityOrganizationNameSql(proposalSpeakerIdentityIdSql(speakerAlias));
}

/** The job title a speaker appears with: the one the identity they speak as carries. */
export function proposalSpeakerJobTitleSql(speakerAlias = "ps"): string {
  return identityJobTitleSql(proposalSpeakerIdentityIdSql(speakerAlias));
}

function identityColumnSql(speakerAlias: string, column: "biography" | "links_json"): string {
  return `(SELECT spoken_as.${column} FROM identities spoken_as WHERE spoken_as.id = ${proposalSpeakerIdentityIdSql(speakerAlias)})`;
}

const PROFILE_FIELDS = {
  firstName: { column: "first_name", sql: (user: string) => `${user}.first_name` },
  lastName: { column: "last_name", sql: (user: string) => `${user}.last_name` },
  organizationName: {
    column: "organization_name",
    sql: (_user: string, speaker: string) => proposalSpeakerOrganizationNameSql(speaker),
  },
  jobTitle: { column: "job_title", sql: (_user: string, speaker: string) => proposalSpeakerJobTitleSql(speaker) },
  biography: {
    column: "biography",
    sql: (_user: string, speaker: string) => identityColumnSql(speaker, "biography"),
  },
  links: { column: "links_json", sql: (_user: string, speaker: string) => identityColumnSql(speaker, "links_json") },
} as const;

export type ProposalSpeakerProfileField = keyof typeof PROFILE_FIELDS;

const ALL_PROFILE_FIELDS = Object.keys(PROFILE_FIELDS) as ProposalSpeakerProfileField[];

/** One profile value of a speaker as a SQL expression. */
export function proposalSpeakerProfileValueSql(
  userAlias: string,
  speakerAlias: string,
  field: ProposalSpeakerProfileField,
): string {
  return PROFILE_FIELDS[field].sql(userAlias, speakerAlias);
}

/**
 * The speaker's profile as select columns (`first_name`, `last_name`,
 * `organization_name`, `job_title`, `biography`, `links_json`), each with an
 * optional prefix. The caller joins the speaker's `users` row as `userAlias`.
 */
export function proposalSpeakerProfileColumns(
  userAlias = "u",
  speakerAlias = "ps",
  prefix = "",
  fields: readonly ProposalSpeakerProfileField[] = ALL_PROFILE_FIELDS,
): string {
  return fields
    .map(
      (field) =>
        `${proposalSpeakerProfileValueSql(userAlias, speakerAlias, field)} AS ${prefix}${PROFILE_FIELDS[field].column}`,
    )
    .join(",\n  ");
}

/** The person's own headshot: a speaker has no other. */
export function proposalSpeakerHeadshotColumns(userAlias = "u", prefix = ""): string {
  return `${userAlias}.headshot_r2_key AS ${prefix}headshot_r2_key, ${userAlias}.headshot_updated_at AS ${prefix}headshot_updated_at`;
}
