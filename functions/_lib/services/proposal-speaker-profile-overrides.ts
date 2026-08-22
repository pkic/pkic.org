import type { DatabaseLike, StatementLike } from "../types";
import { parseJsonSafe } from "../utils/json";
import { linksSchema, parseLinksJson } from "../../../assets/shared/schemas/links";

export const PROPOSAL_PROFILE_FIELDS = {
  firstName: "first_name",
  lastName: "last_name",
  organizationName: "organization_name",
  jobTitle: "job_title",
  biography: "biography",
  links: "links_json",
} as const;

export type ProposalProfileField = keyof typeof PROPOSAL_PROFILE_FIELDS;
export interface ProposalProfileValues {
  firstName: string | null;
  lastName: string | null;
  organizationName: string | null;
  jobTitle: string | null;
  biography: string | null;
  links: string[];
}
export type ProposalProfilePatch = Partial<ProposalProfileValues>;

export interface ProposalProfileOverrideSnapshot {
  proposalSpeakerId: string;
  proposalId: string;
  proposalStatus: string;
  proposalUpdatedAt: string;
  userId: string;
  currentStatus: string;
  expectedProfileOverridesJson: string | null;
}

/**
 * Locks a profile mutation to the speaker and proposal snapshot that
 * authorized it. SQLite reports one changed row for a matched no-op UPDATE,
 * allowing the caller's immediately following one-change guard to abort the
 * batch before any account-wide profile fields are changed.
 */
export function prepareProposalSpeakerProfileAuthorityGuard(
  db: DatabaseLike,
  context: ProposalProfileOverrideSnapshot,
): StatementLike {
  return db
    .prepare(
      `UPDATE proposal_speakers
          SET profile_overrides_json = profile_overrides_json
        WHERE id = ? AND proposal_id = ? AND user_id = ? AND status = ?
          AND profile_overrides_json IS ?
          AND EXISTS (
            SELECT 1 FROM session_proposals
             WHERE id = ? AND status = ? AND updated_at = ? AND deleted_at IS NULL
          )`,
    )
    .bind(
      context.proposalSpeakerId,
      context.proposalId,
      context.userId,
      context.currentStatus,
      context.expectedProfileOverridesJson,
      context.proposalId,
      context.proposalStatus,
      context.proposalUpdatedAt,
    );
}

const PROFILE_TEXT_FIELD_NAMES = ["firstName", "lastName", "organizationName", "jobTitle", "biography"] as const;
const PROFILE_FIELD_NAMES: readonly ProposalProfileField[] = [...PROFILE_TEXT_FIELD_NAMES, "links"];

export function proposalProfileFieldNames(): readonly ProposalProfileField[] {
  return PROFILE_FIELD_NAMES;
}

export function parseProposalProfileOverrides(value: string | null | undefined): ProposalProfilePatch {
  const parsed = parseJsonSafe<unknown>(value, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const overrides: ProposalProfilePatch = {};
  for (const field of PROFILE_TEXT_FIELD_NAMES) {
    const entry = (parsed as Record<string, unknown>)[field];
    if (typeof entry === "string" || entry === null) overrides[field] = entry;
  }
  const links = (parsed as Record<string, unknown>).links;
  const parsedLinks = linksSchema.safeParse(links);
  if (parsedLinks.success) overrides.links = parsedLinks.data;
  else if (typeof links === "string") overrides.links = parseLinksJson(links);
  else if (links === null) overrides.links = [];
  return overrides;
}

/** Applies a validated patch while omitting values equal to the account profile. */
export function updateProposalProfileOverrides(
  currentJson: string | null | undefined,
  baseValues: ProposalProfileValues,
  patch: ProposalProfilePatch,
): string {
  const next = parseProposalProfileOverrides(currentJson);
  for (const field of PROFILE_TEXT_FIELD_NAMES) {
    const value = patch[field];
    if (value === undefined) continue;
    if (value === baseValues[field]) delete next[field];
    else next[field] = value;
  }
  if (patch.links !== undefined) {
    if (JSON.stringify(patch.links) === JSON.stringify(baseValues.links)) delete next.links;
    else next.links = patch.links;
  }
  return JSON.stringify(next);
}

export function prepareClearProposalSpeakerProfileOverridesStatement(
  db: DatabaseLike,
  context: ProposalProfileOverrideSnapshot,
  fields: readonly ProposalProfileField[] = PROFILE_FIELD_NAMES,
): StatementLike {
  const selected = PROFILE_FIELD_NAMES.filter((field) => fields.includes(field));
  if (selected.length === 0) throw new Error("At least one proposal profile override field is required");
  const paths = selected.map((field) => `'$.${field}'`).join(", ");
  return db
    .prepare(
      `UPDATE proposal_speakers
          SET profile_overrides_json = json_remove(profile_overrides_json, ${paths})
        WHERE id = ? AND proposal_id = ? AND user_id = ? AND status = ?
          AND profile_overrides_json IS ?`,
    )
    .bind(
      context.proposalSpeakerId,
      context.proposalId,
      context.userId,
      context.currentStatus,
      context.expectedProfileOverridesJson,
    );
}
