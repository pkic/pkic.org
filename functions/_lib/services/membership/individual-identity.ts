import { first } from "../../db/queries";
import { prepareAuthorizationGuard, type AuthorizationEvidence } from "../../db/authorization-guard";
import type { DatabaseLike } from "../../types";
import { buildCreateIdentityStatement, type IdentitySource } from "./identities";
import { individualMembershipConflictPredicate } from "./capacity-query";
import { AppError } from "../../errors";

/** Membership enriches the person's canonical personal identity rather than replacing it. */
export async function buildIndividualMembershipIdentity(
  db: DatabaseLike,
  input: {
    userId: string;
    source: IdentitySource;
    startImmediately: boolean;
    now: string;
    biography?: string | null;
    linksJson?: string | null;
    condition?: AuthorizationEvidence;
  },
) {
  const observed = await first<{ id: string | null; conflict: number }>(
    db,
    `SELECT personal.id, ${individualMembershipConflictPredicate("target.id")} AS conflict
    FROM users target LEFT JOIN identities personal ON personal.user_id=target.id
      AND personal.organization_id IS NULL AND personal.started_at IS NOT NULL
      AND personal.ended_at IS NULL AND personal.blocked_at IS NULL
    WHERE target.id=?`,
    [input.userId],
  );
  if (observed?.conflict) throw new AppError(409, "IDENTITY_ALREADY_ACTIVE", "This user already holds a membership");
  const existing = observed?.id ? { id: observed.id } : null;
  const eligible = {
    sql: `SELECT 1 FROM users target WHERE target.id=? AND target.active=1
      AND target.pii_redacted_at IS NULL AND target.merged_into_user_id IS NULL
      AND NOT ${individualMembershipConflictPredicate("target.id")}
      ${input.condition ? `AND EXISTS (${input.condition.sql})` : ""}`,
    bindings: [input.userId, ...(input.condition?.bindings ?? [])],
  };
  if (existing)
    return {
      identityId: existing.id,
      statements: [
        prepareAuthorizationGuard(db, eligible),
        prepareAuthorizationGuard(db, {
          sql: `SELECT 1 FROM identities WHERE id=? AND user_id=? AND organization_id IS NULL
          AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL`,
          bindings: [existing.id, input.userId],
        }),
        // Keep this last so the caller's activation audit checks this exact write.
        db.prepare("UPDATE identities SET updated_at=? WHERE id=?").bind(input.now, existing.id),
      ],
    };
  const created = await buildCreateIdentityStatement(db, { ...input, organizationId: null, condition: eligible });
  return { identityId: created.identityId, statements: [created.statement] };
}
