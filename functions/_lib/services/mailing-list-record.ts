import { mailingListSchema, type MailingList } from "../../../assets/shared/schemas/mailing-lists";
import { parseJsonSafe } from "../utils/json";

export interface MailingListRow {
  id: string;
  email: string;
  label: string;
  purpose: MailingList["purpose"];
  group_id: string | null;
  is_primary_discussion: number;
  subscription_default: MailingList["subscriptionDefault"];
  posting_policy: string;
  moderation_policy: string;
  auto_sync_categories_json: string | null;
  active: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export const MAILING_LIST_COLUMNS = `id, email, label, purpose, group_id, is_primary_discussion,
  subscription_default, posting_policy, moderation_policy, auto_sync_categories_json,
  active, archived_at, created_at, updated_at`;

export function toMailingList(row: MailingListRow): MailingList {
  return mailingListSchema.parse({
    id: row.id,
    email: row.email,
    label: row.label,
    purpose: row.purpose,
    groupId: row.group_id,
    primaryDiscussion: row.is_primary_discussion === 1,
    subscriptionDefault: row.subscription_default,
    postingPolicy: row.posting_policy,
    moderationPolicy: row.moderation_policy,
    autoSyncCategories: parseJsonSafe<string[] | null>(row.auto_sync_categories_json, null),
    active: row.active === 1,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
