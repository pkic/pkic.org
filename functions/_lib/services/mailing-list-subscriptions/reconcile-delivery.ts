import type { MailingListDeliveryAddress } from "./delivery-addresses";
import type {
  MailingListDeliveryChange,
  MailingListDeliveryMember,
  MailingListDeliveryProvider,
} from "./delivery-provider";

export interface MailingListDeliveryPlanEntry {
  email: string;
  primaryEmail?: string;
  userId?: string;
  action: MailingListDeliveryChange["action"] | "unchanged" | "protected" | "unsubscribed";
  alias: boolean;
  delivery?: "none";
}

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
      ...(target?.noDelivery ? { delivery: "none" as const } : {}),
      ...(target ? { userId: target.userId, primaryEmail: target.primaryEmail } : {}),
    };
    if (member?.protected) return { ...base, action: "protected" };
    const left = target?.confirmedSubscribed && !actual.has(target.primaryEmail);
    if (left && !alias) return { ...base, action: "unsubscribed" };
    if (!target || left) return { ...base, action: member ? "unsubscribe" : "unchanged" };
    // Primary additions belong to the durable queue, which also owns their notification.
    if (!member) return { ...base, action: alias ? "subscribe" : "unchanged" };
    return { ...base, action: "unchanged" };
  });
}

/** Durable desired subscriptions and the existing scheduled job own convergence/retries. */
export async function reconcileMailingListDelivery(
  provider: MailingListDeliveryProvider,
  listEmail: string,
  addresses: MailingListDeliveryAddress[],
  options: {
    limit: number;
    dryRun: boolean;
    canApply?: () => Promise<boolean>;
    recordUnsubscribe?: (userId: string) => Promise<boolean | void>;
    recordPresence?: (addresses: MailingListDeliveryAddress[]) => Promise<number | void>;
  },
) {
  const listing = await provider.listMembers(listEmail);
  if (!listing.complete) throw new Error("Incomplete mailing-list roster; reconciliation stopped");
  const entries = planMailingListDelivery(addresses, listing.members);
  const present = new Set(listing.members.map((member) => member.email));
  let changed = 0;
  const baselines = addresses
    .filter(
      (address) => address.email === address.primaryEmail && !address.confirmedSubscribed && present.has(address.email),
    )
    .slice(0, options.limit);
  if (!options.dryRun && options.recordPresence) changed += (await options.recordPresence(baselines)) ?? 0;
  let used = changed;
  const ordered = [...entries].sort((a, b) => Number(a.alias) - Number(b.alias));
  for (const entry of ordered) {
    if (entry.action === "unchanged" || entry.action === "protected") continue;
    if (used >= options.limit) break;
    if (!options.dryRun && options.canApply && !(await options.canApply())) break;
    if (entry.action === "unsubscribed") {
      used++;
      if (!options.dryRun && entry.userId && (await options.recordUnsubscribe?.(entry.userId))) changed++;
    } else if (entry.action === "subscribe" || entry.action === "unsubscribe") {
      if (entry.alias && entry.action !== "unsubscribe" && !present.has(entry.primaryEmail!)) continue;
      used++;
      if (!options.dryRun) {
        const applied = await provider.applyChange(listEmail, {
          email: entry.email,
          action: entry.action as MailingListDeliveryChange["action"],
          ...(entry.delivery ? { delivery: entry.delivery } : {}),
        });
        if (applied) changed++;
      }
      if (entry.action === "subscribe") present.add(entry.email);
    }
  }
  return { entries, changed, used };
}
