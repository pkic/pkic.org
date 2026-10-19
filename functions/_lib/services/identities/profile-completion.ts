/**
 * Completes the empty parts of an identity's profile from what its holder
 * submitted elsewhere — a proposal form, say — without ever replacing what the
 * identity already says. The identity stays the one place the biography and
 * links live; a submission only fills a blank, and the audit names what it
 * filled.
 */
import { PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL } from "../people/profile-publication-sql";
import { prepareSitePublicationRequest } from "../site-publication-requests";
import { PUBLIC_MEMBER_USER_SOURCE_SQL } from "../membership/public-profile-sql";
import { serializeLinks } from "../../../../assets/shared/schemas/links";
import type { DatabaseLike, StatementLike } from "../../types";
import { prepareAuditLogWhen, type AuditScope } from "../audit";
import { individualIdentityIdSql } from "./affiliation-projection";

const EMPTY_BIOGRAPHY = "NULLIF(TRIM(COALESCE(identity.biography, '')), '') IS NULL";
const EMPTY_LINKS = "COALESCE(identity.links_json, '[]') IN ('', '[]')";

/**
 * The audit row and the write that fill the empty biography and links of the
 * identity a person speaks as — the named one, else their individual identity
 * (which may be created earlier in the same batch). The audit is conditioned
 * on the blanks it fills and runs first, so it is only written when the update
 * changes something.
 */
export function prepareIdentityProfileCompletion(
  db: DatabaseLike,
  input: {
    userId: string;
    /** The organization identity spoken as; null for the person's individual identity. */
    identityId: string | null;
    biography?: string | null;
    links?: readonly string[];
    at: string;
    actor: { type: string; id: string | null };
    scope?: AuditScope | null;
  },
): StatementLike[] {
  const biography = input.biography?.trim() || null;
  const linksJson = input.links && input.links.length > 0 ? serializeLinks([...input.links]) : null;
  if (!biography && !linksJson) return [];
  const target = `identity.user_id = ? AND identity.id = COALESCE(?, ${individualIdentityIdSql("?")})`;
  const fills = `((? IS NOT NULL AND ${EMPTY_BIOGRAPHY}) OR (? IS NOT NULL AND ${EMPTY_LINKS}))`;
  const bindings = [input.userId, input.identityId, input.userId, biography, linksJson];
  return [
    prepareSitePublicationRequest(
      db,
      {
        resourceType: "user_profile",
        resourceId: input.userId,
        revision: Date.parse(input.at),
        reasonCode: "user_profile_changed",
        deduplicationKey: `user-profile:${input.userId}:${crypto.randomUUID()}`,
      },
      {
        sql: `EXISTS(SELECT 1 ${PUBLIC_MEMBER_USER_SOURCE_SQL} AND ${target} AND ${fills}
        AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL)
        OR EXISTS(SELECT 1 ${PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL} AND person.id=?
          AND EXISTS(SELECT 1 FROM identities identity WHERE identity.user_id=person.id AND ${target} AND ${fills}
            AND identity.started_at IS NOT NULL AND identity.blocked_at IS NULL AND identity.hidden_from_public_profile=0))`,
        bindings: [...bindings, input.userId, ...bindings],
      },
    ),
    prepareAuditLogWhen(db, {
      actorType: input.actor.type,
      actorId: input.actor.id,
      action: "identity_profile_completed",
      entityType: "user",
      entityId: input.userId,
      details: {
        identityId: input.identityId,
        ...(biography ? { biography: { from: null, to: biography } } : {}),
        ...(linksJson ? { links: { from: [], to: input.links } } : {}),
      },
      conditionSql: `SELECT 1 FROM identities identity WHERE ${target} AND ${fills}`,
      conditionBindings: bindings,
      createdAt: input.at,
      scope: input.scope ?? null,
    }),
    db
      .prepare(
        `UPDATE identities AS identity
            SET biography = CASE WHEN ${EMPTY_BIOGRAPHY} THEN COALESCE(?, identity.biography) ELSE identity.biography END,
                links_json = CASE WHEN ${EMPTY_LINKS} THEN COALESCE(?, identity.links_json) ELSE identity.links_json END,
                updated_at = ?
          WHERE ${target} AND ${fills}`,
      )
      .bind(biography, linksJson, input.at, ...bindings),
  ];
}
