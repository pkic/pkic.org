import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import type { MailingListDeliveryProvider } from "./delivery-provider";
import { listMailingListDeliveryAddresses, type MailingListDeliveryAddress } from "./delivery-addresses";
import { reconcileMailingListDelivery } from "./reconcile-delivery";

export const MAX_RECONCILED_MAILING_LISTS = 100;

/** Full sync derives work from existing durable subscriptions; no parallel queue. */
export async function reconcileMailingListDeliveries(
  db: DatabaseLike,
  provider: MailingListDeliveryProvider,
  options: {
    limit: number;
    dryRun: boolean;
    canApply?: (listEmail: string) => Promise<boolean>;
    recordUnsubscribe?: (userId: string, listEmail: string) => Promise<unknown>;
    recordPresence?: (addresses: MailingListDeliveryAddress[], listEmail: string) => Promise<unknown>;
  },
) {
  const lists = await all<{ email: string }>(
    db,
    `SELECT list.email FROM mailing_lists list
    LEFT JOIN mailing_list_sync_settings settings ON settings.mailing_list_id = list.id
    WHERE list.active = 1 AND list.archived_at IS NULL AND COALESCE(settings.enabled,1) = 1
    ORDER BY list.email LIMIT ?`,
    [MAX_RECONCILED_MAILING_LISTS + 1],
  );
  if (lists.length > MAX_RECONCILED_MAILING_LISTS)
    throw new Error("Mailing-list reconciliation exceeds its bounded list limit");
  const groups = [];
  let changed = 0;
  for (const list of lists) {
    if (!options.dryRun && changed >= options.limit) break;
    const addresses = await listMailingListDeliveryAddresses(db, list.email);
    const result = await reconcileMailingListDelivery(provider, list.email, addresses, {
      limit: options.limit - changed,
      dryRun: options.dryRun,
      canApply: options.canApply ? () => options.canApply!(list.email) : undefined,
      recordPresence: options.recordPresence
        ? (addresses) => options.recordPresence!(addresses, list.email)
        : undefined,
      recordUnsubscribe: options.recordUnsubscribe
        ? (userId) => options.recordUnsubscribe!(userId, list.email)
        : undefined,
    });
    groups.push({ email: list.email, entries: result.entries });
    changed += result.changed;
  }
  return { groups, changed };
}
