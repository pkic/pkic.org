import type { MailingListDeliveryAddress } from "./delivery-addresses";
import {
  MAX_DELIVERY_INSPECTIONS,
  type MailingListDeliveryChange,
  type MailingListDeliveryMember,
  type MailingListDeliveryProvider,
} from "./delivery-provider";

export interface MailingListDeliveryPlanEntry {
  email: string;
  primaryEmail?: string;
  userId?: string;
  action: MailingListDeliveryChange["action"] | "unchanged" | "protected" | "unsubscribed";
  alias: boolean;
  delivery?: "all" | "none";
}

/** Plan primary and alias delivery separately, preserving protected members and observed departures. */
export function planMailingListDelivery(
  addresses: MailingListDeliveryAddress[],
  members: MailingListDeliveryMember[],
): MailingListDeliveryPlanEntry[] {
  const expected = new Map(addresses.map((address) => [address.email, address]));
  const actual = new Map(members.map((member) => [member.email, member]));
  return [...new Set([...expected.keys(), ...actual.keys()])].sort().map((email) => {
    const target = expected.get(email),
      member = actual.get(email);
    const alias = Boolean(target && target.email !== target.primaryEmail);
    const base = {
      email,
      alias,
      delivery: target?.noDelivery ? ("none" as const) : ("all" as const),
      ...(target ? { userId: target.userId, primaryEmail: target.primaryEmail } : {}),
    };
    if (member?.protected) return { ...base, action: "protected" };
    const left = target?.confirmedSubscribed && !actual.has(target.primaryEmail);
    if (left && !alias) return { ...base, action: "unsubscribed" };
    if (!target || left) return { ...base, action: member ? "unsubscribe" : "unchanged" };
    if (!member) return { ...base, action: "subscribe" };
    if (target.noDelivery && member.delivery === "all") return { ...base, action: "disable_delivery" };
    if (target.restoreDelivery && !target.noDelivery && member.delivery === "none")
      return { ...base, action: "enable_delivery" };
    return { ...base, action: "unchanged" };
  });
}

/** A complete roster establishes absence; only the cursor window receives detailed reads or writes. */
export async function reconcileMailingListDelivery(
  provider: MailingListDeliveryProvider,
  listEmail: string,
  addresses: MailingListDeliveryAddress[],
  options: {
    limit: number;
    dryRun: boolean;
    afterEmail?: string;
    canApply?: () => Promise<boolean>;
    recordUnsubscribe?: (userId: string) => Promise<boolean | void>;
    recordPresence?: (addresses: MailingListDeliveryAddress[]) => Promise<number | void>;
  },
) {
  const limit = Math.max(0, Math.min(MAX_DELIVERY_INSPECTIONS, Math.floor(options.limit)));
  if (!limit) return { entries: [], changed: 0, nextEmail: options.afterEmail ?? "", hasMore: true };
  const listing = await provider.listMembers(listEmail);
  if (!listing.complete) throw new Error("Incomplete mailing-list roster; reconciliation stopped");
  const emails = [...new Set([...addresses.map((row) => row.email), ...listing.members.map((row) => row.email)])]
    .sort()
    .filter((email) => email > (options.afterEmail ?? ""));
  const window = new Set(emails.slice(0, limit));
  const present = new Set(listing.members.map((member) => member.email));
  const details = await provider.readDelivery(
    listEmail,
    addresses
      .filter((row) => window.has(row.email) && present.has(row.email) && (row.noDelivery || row.restoreDelivery))
      .map((row) => row.email),
  );
  const inspected = new Map(details.map((member) => [member.email, member]));
  const entries = planMailingListDelivery(
    addresses,
    listing.members.map((member) => inspected.get(member.email) ?? member),
  ).filter((entry) => window.has(entry.email));
  let changed = 0;
  if (!options.dryRun && options.recordPresence && (!options.canApply || (await options.canApply()))) {
    changed +=
      (await options.recordPresence(
        addresses.filter(
          (address) =>
            window.has(address.email) &&
            address.email === address.primaryEmail &&
            !address.noDelivery &&
            !address.confirmedSubscribed &&
            present.has(address.email),
        ),
      )) ?? 0;
  }
  // Establish primaries before dependent aliases within this window.
  const ordered = [...entries].sort((a, b) => Number(a.alias) - Number(b.alias));
  for (const entry of ordered) {
    if (entry.action === "unchanged" || entry.action === "protected") continue;
    if (changed >= limit) break;
    if (!options.dryRun && options.canApply && !(await options.canApply()))
      return { entries, changed, nextEmail: options.afterEmail ?? "", hasMore: true };
    if (entry.action === "unsubscribed") {
      if (!options.dryRun && entry.userId && (await options.recordUnsubscribe?.(entry.userId))) changed++;
    } else {
      if (entry.alias && entry.action !== "unsubscribe" && !present.has(entry.primaryEmail!)) continue;
      if (!options.dryRun) {
        const applied = await provider.applyChange(listEmail, {
          email: entry.email,
          action: entry.action,
          ...(entry.action === "enable_delivery"
            ? { delivery: "all" as const }
            : entry.action !== "unsubscribe" && entry.delivery === "none"
              ? { delivery: "none" as const }
              : {}),
        });
        if (applied) {
          changed++;
          if (entry.action === "subscribe") present.add(entry.email);
        }
      }
    }
  }
  return { entries, changed, nextEmail: emails.slice(0, limit).at(-1) ?? "", hasMore: emails.length > limit };
}
