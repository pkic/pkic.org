import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";

/** Keep desired subscriptions while pausing all external changes for one mailing list. */
export function googleGroupsSyncEnabledSql(
  emailExpression: "current_row.google_group_email" | "queue.google_group_email" | "?",
) {
  return `NOT EXISTS (SELECT 1 FROM mailing_lists sync_list
    JOIN mailing_list_sync_settings sync_settings ON sync_settings.mailing_list_id = sync_list.id
    WHERE sync_list.email = ${emailExpression} AND sync_settings.enabled = 0)`;
}
export async function isMailingListSyncEnabled(db: DatabaseLike, email: string) {
  return Boolean(await first(db, `SELECT 1 WHERE ${googleGroupsSyncEnabledSql("?")}`, [email]));
}
