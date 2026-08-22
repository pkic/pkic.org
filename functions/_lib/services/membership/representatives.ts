/**
 * organization_representatives (consolidated migration 0035) — the N people who
 * represent an org-tied membership aggregate. Temporal: active/inactive is
 * exactly what `left_at IS NULL`/`IS NOT NULL` means, so join, leave,
 * transfer, and rejoin all fall out of ordinary inserts/updates rather than
 * needing separate history bookkeeping.
 */
import { all, first } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import type { DatabaseLike, StatementLike } from "../../types";

export interface OrganizationRepresentative {
  id: string;
  memberId: string;
  userId: string;
  showOnOrgProfile: boolean;
  joinedAt: string;
  leftAt: string | null;
}

interface RepresentativeRow {
  id: string;
  member_id: string;
  user_id: string;
  show_on_org_profile: number;
  joined_at: string;
  left_at: string | null;
}

const REPRESENTATIVE_COLUMNS = "id, member_id, user_id, show_on_org_profile, joined_at, left_at";

function toRepresentative(row: RepresentativeRow): OrganizationRepresentative {
  return {
    id: row.id,
    memberId: row.member_id,
    userId: row.user_id,
    showOnOrgProfile: row.show_on_org_profile === 1,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
  };
}

/**
 * Builds the insert for a new active representative row. Relies on
 * `uq_organization_representatives_active_pair` (consolidated migration 0035) to reject
 * a duplicate active (member_id, user_id) pair at the database level — a
 * person may still represent more than one *different* organization
 * concurrently (product decision), so this is not a global per-user
 * uniqueness check.
 */
export function buildAddRepresentativeStatement(
  db: DatabaseLike,
  input: { memberId: string; userId: string; showOnOrgProfile?: boolean; now?: string },
): { representativeId: string; statement: StatementLike } {
  const representativeId = uuid();
  const now = input.now ?? nowIso();
  const statement = db
    .prepare(
      `INSERT INTO organization_representatives
         (id, member_id, user_id, show_on_org_profile, joined_at, left_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .bind(representativeId, input.memberId, input.userId, input.showOnOrgProfile === false ? 0 : 1, now, now, now);
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
export function buildTransferRepresentativeStatements(
  db: DatabaseLike,
  input: { fromMemberId: string; toMemberId: string; userId: string; showOnOrgProfile?: boolean; now?: string },
): { representativeId: string; statements: StatementLike[] } {
  const now = input.now ?? nowIso();
  const close = buildCloseRepresentativeStatement(db, { memberId: input.fromMemberId, userId: input.userId, now });
  const { representativeId, statement: open } = buildAddRepresentativeStatement(db, {
    memberId: input.toMemberId,
    userId: input.userId,
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
