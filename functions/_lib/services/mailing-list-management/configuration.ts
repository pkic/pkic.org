import type { MailingList } from "../../../../assets/shared/schemas/mailing-lists";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";

export interface MailingListConfiguration {
  purpose: MailingList["purpose"];
  groupId: string;
  primaryDiscussion: boolean;
  subscriptionDefault: MailingList["subscriptionDefault"];
}

export async function validateMailingListConfiguration(
  db: DatabaseLike,
  configuration: MailingListConfiguration,
): Promise<void> {
  if (!(await first(db, "SELECT id FROM groups WHERE id = ?", [configuration.groupId]))) {
    throw new AppError(422, "MAILING_LIST_GROUP_INVALID", "The selected group does not exist");
  }
}

export function translateMailingListWriteError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("uq_mailing_lists_primary_discussion") ||
    message.includes("UNIQUE constraint failed: mailing_lists.group_id")
  ) {
    throw new AppError(409, "MAILING_LIST_PRIMARY_EXISTS", "This group already has a primary discussion list");
  }
  if (message.includes("UNIQUE constraint failed: mailing_lists.email")) {
    throw new AppError(409, "DUPLICATE_EMAIL", "A mailing list with that email already exists");
  }
  throw error;
}
