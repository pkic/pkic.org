import { expect, it, vi } from "vitest";
import { reconcileMailingListDelivery } from "../functions/_lib/services/mailing-list-subscriptions/reconcile-delivery";
import type { MailingListDeliveryProvider } from "../functions/_lib/services/mailing-list-subscriptions/delivery-provider";

it("reaches real additions and removals after a prefix of already-present no-mail members without a cursor", async () => {
  const addresses = Array.from({ length: 30 }, (_, i) => ({
    userId: String(i),
    email: `a${i}@example.test`,
    primaryEmail: `a${i}@example.test`,
    noDelivery: 1,
    confirmedSubscribed: 1,
  }));
  const members = addresses.map(({ email }) => ({ email, protected: false }));
  const provider: MailingListDeliveryProvider = {
    listMembers: vi.fn(async () => ({
      members: [...members, { email: "zz-stale@example.test", protected: false }],
      complete: true,
    })),
    applyChange: vi.fn(async () => true),
  };
  const report = await reconcileMailingListDelivery(
    provider,
    "list@example.test",
    [
      ...addresses,
      {
        userId: "new",
        email: "z-new@example.test",
        primaryEmail: "a0@example.test",
        noDelivery: 1,
        confirmedSubscribed: 0,
      },
    ],
    { limit: 2, dryRun: false },
  );
  expect(report.changed).toBe(2);
  expect(provider.applyChange).toHaveBeenCalledTimes(2);
  expect(provider.applyChange).toHaveBeenCalledWith("list@example.test", {
    email: "z-new@example.test",
    action: "subscribe",
    delivery: "none",
  });
  expect(provider.applyChange).toHaveBeenCalledWith("list@example.test", {
    email: "zz-stale@example.test",
    action: "unsubscribe",
  });
});
it("bounds attempts even when provider races make planned changes idempotent no-ops", async () => {
  const provider: MailingListDeliveryProvider = {
    listMembers: vi.fn(async () => ({
      members: Array.from({ length: 50 }, (_, i) => ({
        email: `stale${i}@example.test`,
        protected: false,
        delivery: "unknown" as const,
      })),
      complete: true,
    })),
    applyChange: vi.fn(async () => false),
  };
  const report = await reconcileMailingListDelivery(provider, "list@example.test", [], { limit: 2, dryRun: false });
  expect(provider.applyChange).toHaveBeenCalledTimes(2);
  expect(report.changed).toBe(0);
});
