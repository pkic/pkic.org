/**
 * organization_representatives (consolidated migration 0035) — the N people who
 * represent an org-tied membership aggregate. Temporal: active/inactive is
 * exactly what `left_at IS NULL`/`IS NOT NULL` means, so join, leave,
 * transfer, and rejoin all fall out of ordinary inserts/updates rather than
 * needing separate history bookkeeping.
 */
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import type { DatabaseLike, StatementLike } from "../../types";
import type { z } from "zod";
import { organizationRepresentationSourceSchema } from "../../../../assets/shared/schemas/organization-representation";

export type OrganizationRepresentationSource = z.infer<typeof organizationRepresentationSourceSchema>;

export interface OrganizationRepresentative {
  id: string;
  memberId: string;
  userId: string;
  source: OrganizationRepresentationSource;
  showOnOrgProfile: boolean;
  joinedAt: string;
  leftAt: string | null;
  blockedAt: string | null;
  blockedByUserId: string | null;
}

interface RepresentativeRow {
  id: string;
  member_id: string;
  user_id: string;
  source: OrganizationRepresentationSource;
  show_on_org_profile: number;
  joined_at: string;
  left_at: string | null;
  blocked_at: string | null;
  blocked_by_user_id: string | null;
}

const REPRESENTATIVE_COLUMNS =
  "id, member_id, user_id, source, show_on_org_profile, joined_at, left_at, blocked_at, blocked_by_user_id";

function toRepresentative(row: RepresentativeRow): OrganizationRepresentative {
  return {
    id: row.id,
    memberId: row.member_id,
    userId: row.user_id,
    source: row.source,
    showOnOrgProfile: row.show_on_org_profile === 1,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
    blockedAt: row.blocked_at,
    blockedByUserId: row.blocked_by_user_id,
  };
}

/**
 * Builds one association mutation without committing it. A new pair is
 * inserted, an inactive unblocked pair is restored in place, and active or
 * blocked pairs fail before callers construct their atomic command batch.
 * One person may still represent multiple different organizations.
 */
export async function buildAddRepresentativeStatement(
  db: DatabaseLike,
  input: {
    memberId: string;
    userId: string;
    source: OrganizationRepresentationSource;
    showOnOrgProfile?: boolean;
    now?: string;
  },
): Promise<{ representativeId: string; statement: StatementLike }> {
  const now = input.now ?? nowIso();
  const existing = await first<{ id: string; left_at: string | null; blocked_at: string | null }>(
    db,
    `SELECT id, left_at, blocked_at
       FROM organization_representatives
      WHERE member_id = ? AND user_id = ?`,
    [input.memberId, input.userId],
  );
  if (existing?.blocked_at) {
    throw new AppError(
      409,
      "ORGANIZATION_REPRESENTATION_BLOCKED",
      "This organization representation is blocked and must be explicitly restored",
    );
  }
  if (existing?.left_at === null) {
    throw new AppError(409, "ALREADY_MEMBER", "This user already represents the organization");
  }
  if (existing) {
    return {
      representativeId: existing.id,
      statement: db
        .prepare(
          `UPDATE organization_representatives
              SET source = ?, show_on_org_profile = ?, joined_at = ?, left_at = NULL,
                  blocked_at = NULL, blocked_by_user_id = NULL, updated_at = ?
            WHERE id = ? AND left_at IS NOT NULL AND blocked_at IS NULL`,
        )
        .bind(input.source, input.showOnOrgProfile === false ? 0 : 1, now, now, existing.id),
    };
  }
  const representativeId = uuid();
  const statement = db
    .prepare(
      `INSERT INTO organization_representatives
         (id, member_id, user_id, source, show_on_org_profile, joined_at, left_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .bind(
      representativeId,
      input.memberId,
      input.userId,
      input.source,
      input.showOnOrgProfile === false ? 0 : 1,
      now,
      now,
      now,
    );
  return { representativeId, statement };
}

/** Closes the active representative row for (memberId, userId), if any — the "leave" half of transfer/leave. */
export function buildCloseRepresentativeStatement(
  db: DatabaseLike,
  input: { memberId: string; userId: string; now?: string },
): StatementLike {
  const now = input.now ?? nowIso();
  return db
    .prepare(
      `UPDATE organization_representatives SET left_at = ?, updated_at = ?
       WHERE member_id = ? AND user_id = ? AND left_at IS NULL`,
    )
    .bind(now, now, input.memberId, input.userId);
}

/** Transfer: close the active row on the old organization, open a new one on the new organization. */
export async function buildTransferRepresentativeStatements(
  db: DatabaseLike,
  input: {
    fromMemberId: string;
    toMemberId: string;
    userId: string;
    source: OrganizationRepresentationSource;
    showOnOrgProfile?: boolean;
    now?: string;
  },
): Promise<{ representativeId: string; statements: StatementLike[] }> {
  const now = input.now ?? nowIso();
  const close = buildCloseRepresentativeStatement(db, { memberId: input.fromMemberId, userId: input.userId, now });
  const { representativeId, statement: open } = await buildAddRepresentativeStatement(db, {
    memberId: input.toMemberId,
    userId: input.userId,
    source: input.source,
    showOnOrgProfile: input.showOnOrgProfile,
    now,
  });
  return { representativeId, statements: [close, open] };
}

export async function isActiveRepresentative(db: DatabaseLike, memberId: string, userId: string): Promise<boolean> {
  const row = await first<{ id: string }>(
    db,
    "SELECT id FROM organization_representatives WHERE member_id = ? AND user_id = ? AND left_at IS NULL",
    [memberId, userId],
  );
  return row !== null;
}

export async function listActiveRepresentatives(
  db: DatabaseLike,
  memberId: string,
): Promise<OrganizationRepresentative[]> {
  const rows = await all<RepresentativeRow>(
    db,
    `SELECT ${REPRESENTATIVE_COLUMNS}
     FROM organization_representatives
     WHERE member_id = ? AND left_at IS NULL
     ORDER BY joined_at ASC`,
    [memberId],
  );
  return rows.map(toRepresentative);
}

export async function listActiveRepresentativeMemberships(
  db: DatabaseLike,
  userId: string,
): Promise<OrganizationRepresentative[]> {
  const rows = await all<RepresentativeRow>(
    db,
    `SELECT ${REPRESENTATIVE_COLUMNS}
     FROM organization_representatives
     WHERE user_id = ? AND left_at IS NULL
     ORDER BY joined_at ASC`,
    [userId],
  );
  return rows.map(toRepresentative);
}
