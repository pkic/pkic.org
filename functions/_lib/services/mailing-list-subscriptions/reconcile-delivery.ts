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
    const alias = Boolean(target?.noDelivery);
    const base = { email, alias, ...(target ? { userId: target.userId, primaryEmail: target.primaryEmail } : {}) };
    if (member?.protected) return { ...base, action: "protected" };
    const left = target?.confirmedSubscribed && !actual.has(target.primaryEmail);
    if (left && !alias) return { ...base, action: "unsubscribed" };
    if (!target || left) return { ...base, action: member ? "unsubscribe" : "unchanged" };
    if (!member) return { ...base, action: "subscribe" };
    if (alias && member.delivery !== "none") return { ...base, action: "disable_delivery" };
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
    recordUnsubscribe?: (userId: string) => Promise<unknown>;
    recordPresence?: (addresses: MailingListDeliveryAddress[]) => Promise<unknown>;
  },
) {
  const listing = await provider.listMembers(listEmail);
  if (!listing.complete) throw new Error("Incomplete mailing-list roster; reconciliation stopped");
  const entries = planMailingListDelivery(addresses, listing.members);
  const present = new Set(listing.members.map((member) => member.email));
  if (!options.dryRun && options.recordPresence) {
    await options.recordPresence(
      addresses.filter((address) => !address.noDelivery && !address.confirmedSubscribed && present.has(address.email)),
    );
  }
  let changed = 0;
  const ordered = [...entries].sort((a, b) => Number(a.alias) - Number(b.alias));
  for (const entry of ordered) {
    if (entry.action === "unchanged" || entry.action === "protected") continue;
    if (changed >= options.limit) break;
    if (!options.dryRun && options.canApply && !(await options.canApply())) break;
    if (entry.action === "unsubscribed") {
      if (!options.dryRun && entry.userId) await options.recordUnsubscribe?.(entry.userId);
      changed++;
    } else if (["subscribe", "unsubscribe", "disable_delivery"].includes(entry.action)) {
      if (entry.alias && entry.action !== "unsubscribe" && !present.has(entry.primaryEmail!)) continue;
      if (!options.dryRun) {
        await provider.applyChange(listEmail, {
          email: entry.email,
          action: entry.action as MailingListDeliveryChange["action"],
          ...(entry.alias ? { delivery: "none" as const } : {}),
        });
      }
      if (entry.action === "subscribe") present.add(entry.email);
      changed++;
    }
  }
  return { entries, changed };
}
