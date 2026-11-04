import { all, first, run } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import type { MailingListDeliveryProvider } from "./delivery-provider";
import { listMailingListDeliveryAddresses, type MailingListDeliveryAddress } from "./delivery-addresses";
import { reconcileMailingListDelivery } from "./reconcile-delivery";

export const MAX_RECONCILED_MAILING_LISTS = 100;

interface DeliveryCursor {
  list_email: string;
  address_email: string;
  revision: number;
}

/** One bounded list window per pass; the durable cursor advances even when the window needs no writes. */
export async function reconcileMailingListDeliveries(
  db: DatabaseLike,
  provider: MailingListDeliveryProvider,
  options: {
    limit: number;
    dryRun: boolean;
    canApply?: (listEmail: string) => Promise<boolean>;
    recordUnsubscribe?: (userId: string, listEmail: string) => Promise<boolean | void>;
    recordPresence?: (addresses: MailingListDeliveryAddress[], listEmail: string) => Promise<number | void>;
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
  if (!lists.length || options.limit <= 0) return { groups: [], changed: 0 };
  const cursor = await first<DeliveryCursor>(
    db,
    "SELECT list_email, address_email, revision FROM mailing_list_delivery_cursor WHERE id = 1",
  );
  const index = Math.max(
    0,
    lists.findIndex((list) => list.email >= (cursor?.list_email ?? "")),
  );
  const list = lists[index];
  const addresses = await listMailingListDeliveryAddresses(db, list.email);
  const result = await reconcileMailingListDelivery(provider, list.email, addresses, {
    limit: options.limit,
    dryRun: options.dryRun,
    afterEmail: cursor?.list_email === list.email ? cursor.address_email : "",
    canApply: options.canApply ? () => options.canApply!(list.email) : undefined,
    recordPresence: options.recordPresence ? (rows) => options.recordPresence!(rows, list.email) : undefined,
    recordUnsubscribe: options.recordUnsubscribe
      ? (userId) => options.recordUnsubscribe!(userId, list.email)
      : undefined,
  });
  if (!options.dryRun) {
    const nextList = result.hasMore ? list.email : lists[(index + 1) % lists.length].email;
    const nextEmail = result.hasMore ? result.nextEmail : "";
    // Concurrent passes may inspect the same window, but a stale pass cannot rewind progress.
    await run(
      db,
      `INSERT INTO mailing_list_delivery_cursor(id,list_email,address_email,revision,updated_at)
      VALUES (1,?,?,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(id) DO UPDATE SET list_email=excluded.list_email,address_email=excluded.address_email,
        revision=mailing_list_delivery_cursor.revision+1,updated_at=excluded.updated_at
      WHERE mailing_list_delivery_cursor.revision=?`,
      [nextList, nextEmail, cursor?.revision ?? 0],
    );
  }
  return { groups: [{ email: list.email, entries: result.entries }], changed: result.changed };
}
