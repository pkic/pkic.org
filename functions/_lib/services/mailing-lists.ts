/** Compatibility facade for the separated managed-list service boundary. */
import {
  MAILING_LIST_PURPOSES,
  type MailingListCreateInput,
  type MailingListsListQuery,
  type MailingListUpdateInput,
} from "../../../assets/shared/schemas/mailing-lists";
import type { DatabaseLike } from "../types";
import {
  createMailingList as createMailingListCommand,
  deleteMailingList as deleteMailingListCommand,
  updateMailingList as updateMailingListCommand,
} from "./mailing-list-management/commands";
import {
  listMailingLists as listMailingListsQuery,
  resolveAutoSyncListEmails as resolveAutoSyncListEmailsQuery,
} from "./mailing-list-management/read-model";

export { MAILING_LIST_PURPOSES };

export async function listMailingLists(db: DatabaseLike, query: MailingListsListQuery) {
  return listMailingListsQuery(db, query);
}

export async function createMailingList(db: DatabaseLike, input: MailingListCreateInput, actorUserId: string) {
  return createMailingListCommand(db, input, actorUserId);
}

export async function updateMailingList(
  db: DatabaseLike,
  id: string,
  input: MailingListUpdateInput,
  actorUserId: string,
) {
  return updateMailingListCommand(db, id, input, actorUserId);
}

export async function deleteMailingList(db: DatabaseLike, id: string, actorUserId: string): Promise<void> {
  return deleteMailingListCommand(db, id, actorUserId);
}

/**
 * The Google Groups sync engine's runtime read of `mailing_lists` —
 * every active all_members/consultation list whose auto_sync_categories
 * either includes `membershipCategory` or is unset (meaning "every
 * category"). Called from membership/applications/approve.ts's approveApplication in
 * place of the PKIC_ALL_MEMBERS_LIST/CONSULTATION_LIST constants it used to
 * hardcode.
 */
export async function resolveAutoSyncListEmails(db: DatabaseLike, membershipCategory: string): Promise<string[]> {
  return resolveAutoSyncListEmailsQuery(db, membershipCategory);
}
