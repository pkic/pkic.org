/**
 * Managed mailing list configuration (PRD §4.14). Staff manage the full
 * list of Google Groups here instead of them being hardcoded — see
 * resolveAutoSyncListEmails, which membership-onboarding.ts now calls
 * instead of the PKIC_ALL_MEMBERS_LIST/CONSULTATION_LIST constants it used
 * to hardcode.
 *
 * Working-group lists keep `working_groups.mailing_list_email` as their
 * operational sync target (working-groups.ts's add/removeWorkingGroupMember,
 * unchanged) — already staff-editable via the Working Groups admin screen,
 * so not the "hardcoded" gap this migration closes. The working_group-type
 * rows seeded here exist for inventory/visibility in the unified Admin ->
 * Mailing Lists screen only; editing one's `email` field does not change the
 * WG's actual sync target. See prd.md Phase 4C status for this decision.
 */
import { all, first, run } from "../db/queries";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { parseJsonSafe } from "../utils/json";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";

export const MAILING_LIST_TYPES = ["all_members", "consultation", "ec", "working_group", "custom"] as const;
export type MailingListType = (typeof MAILING_LIST_TYPES)[number];

interface MailingListRow {
  id: string;
  email: string;
  label: string;
  list_type: string;
  working_group_id: string | null;
  auto_sync_categories_json: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

function toMailingList(row: MailingListRow) {
  return {
    id: row.id,
    email: row.email,
    label: row.label,
    listType: row.list_type,
    workingGroupId: row.working_group_id,
    autoSyncCategories: parseJsonSafe<string[] | null>(row.auto_sync_categories_json, null),
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listMailingLists(db: DatabaseLike) {
  const rows = await all<MailingListRow>(db, "SELECT * FROM mailing_lists ORDER BY list_type ASC, email ASC");
  return rows.map(toMailingList);
}

export interface MailingListInput {
  email: string;
  label: string;
  listType: MailingListType;
  workingGroupId?: string | null;
  autoSyncCategories?: string[] | null;
  active?: boolean;
}

export async function createMailingList(db: DatabaseLike, input: MailingListInput) {
  const existing = await first<{ id: string }>(db, "SELECT id FROM mailing_lists WHERE email = ?", [input.email]);
  if (existing) throw new AppError(409, "DUPLICATE_EMAIL", "A mailing list with that email already exists");

  const now = nowIso();
  const id = uuid();
  await run(
    db,
    `INSERT INTO mailing_lists (id, email, label, list_type, working_group_id, auto_sync_categories_json, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.email,
      input.label,
      input.listType,
      input.workingGroupId ?? null,
      input.autoSyncCategories ? JSON.stringify(input.autoSyncCategories) : null,
      input.active === false ? 0 : 1,
      now,
      now,
    ],
  );

  const row = await first<MailingListRow>(db, "SELECT * FROM mailing_lists WHERE id = ?", [id]);
  return toMailingList(row as MailingListRow);
}

export interface MailingListUpdateInput {
  email?: string;
  label?: string;
  listType?: MailingListType;
  workingGroupId?: string | null;
  autoSyncCategories?: string[] | null;
  active?: boolean;
}

export async function updateMailingList(db: DatabaseLike, id: string, input: MailingListUpdateInput) {
  const existing = await first<MailingListRow>(db, "SELECT * FROM mailing_lists WHERE id = ?", [id]);
  if (!existing) throw new AppError(404, "NOT_FOUND", "Mailing list not found");

  if (input.email !== undefined && input.email !== existing.email) {
    const conflict = await first<{ id: string }>(db, "SELECT id FROM mailing_lists WHERE email = ? AND id != ?", [
      input.email,
      id,
    ]);
    if (conflict) throw new AppError(409, "DUPLICATE_EMAIL", "A mailing list with that email already exists");
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];
  if (input.email !== undefined) {
    setClauses.push("email = ?");
    values.push(input.email);
  }
  if (input.label !== undefined) {
    setClauses.push("label = ?");
    values.push(input.label);
  }
  if (input.listType !== undefined) {
    setClauses.push("list_type = ?");
    values.push(input.listType);
  }
  if (input.workingGroupId !== undefined) {
    setClauses.push("working_group_id = ?");
    values.push(input.workingGroupId);
  }
  if (input.autoSyncCategories !== undefined) {
    setClauses.push("auto_sync_categories_json = ?");
    values.push(input.autoSyncCategories ? JSON.stringify(input.autoSyncCategories) : null);
  }
  if (input.active !== undefined) {
    setClauses.push("active = ?");
    values.push(input.active ? 1 : 0);
  }

  if (setClauses.length > 0) {
    setClauses.push("updated_at = ?");
    values.push(nowIso(), id);
    await run(db, `UPDATE mailing_lists SET ${setClauses.join(", ")} WHERE id = ?`, values);
  }

  const row = await first<MailingListRow>(db, "SELECT * FROM mailing_lists WHERE id = ?", [id]);
  return toMailingList(row as MailingListRow);
}

export async function deleteMailingList(db: DatabaseLike, id: string): Promise<void> {
  const existing = await first<{ id: string }>(db, "SELECT id FROM mailing_lists WHERE id = ?", [id]);
  if (!existing) throw new AppError(404, "NOT_FOUND", "Mailing list not found");
  // §4.14: "the portal stops managing it; the Google Group itself is not
  // deleted" — a plain row delete, no Google-side call.
  await run(db, "DELETE FROM mailing_lists WHERE id = ?", [id]);
}

/**
 * The Google Groups sync engine's runtime read of `mailing_lists` (§4.14) —
 * every active all_members/consultation list whose auto_sync_categories
 * either includes `membershipCategory` or is unset (meaning "every
 * category"). Called from membership-onboarding.ts's approveApplication in
 * place of the PKIC_ALL_MEMBERS_LIST/CONSULTATION_LIST constants it used to
 * hardcode.
 */
export async function resolveAutoSyncListEmails(db: DatabaseLike, membershipCategory: string): Promise<string[]> {
  const rows = await all<MailingListRow>(
    db,
    `SELECT * FROM mailing_lists WHERE active = 1 AND list_type IN ('all_members', 'consultation')`,
  );
  return rows
    .filter((row) => {
      const categories = parseJsonSafe<string[] | null>(row.auto_sync_categories_json, null);
      return categories === null || categories.includes(membershipCategory);
    })
    .map((row) => row.email);
}
