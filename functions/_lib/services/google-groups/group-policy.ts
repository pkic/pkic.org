import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";

/** Keep desired subscriptions while pausing all external changes for an owning group. */
export function googleGroupsSyncEnabledSql(
  emailExpression: "current_row.google_group_email" | "queue.google_group_email" | "?",
) {
  return `NOT EXISTS (SELECT 1 FROM mailing_lists sync_list
    JOIN group_mailing_sync_settings sync_settings ON sync_settings.group_id = sync_list.group_id
    WHERE sync_list.email = ${emailExpression} AND sync_settings.enabled = 0)`;
}
export async function isGroupMailingSyncEnabled(db: DatabaseLike, email: string) {
  return Boolean(await first(db, `SELECT 1 WHERE ${googleGroupsSyncEnabledSql("?")}`, [email]));
}
