import { beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { insertIndividualMember } from "./helpers/membership";
import { reconcileMailingListDeliveries } from "../functions/_lib/services/mailing-list-subscriptions/reconcile-delivery-lists";
import { planMailingListDelivery } from "../functions/_lib/services/mailing-list-subscriptions/reconcile-delivery";
import type { MailingListDeliveryProvider } from "../functions/_lib/services/mailing-list-subscriptions/delivery-provider";

const listEmail = "pkic@lists.pkic.org";
beforeEach(resetDb);
async function fixture() {
  await env.DB.prepare("UPDATE mailing_lists SET active = CASE WHEN email = ? THEN 1 ELSE 0 END").bind(listEmail).run();
  const { userId } = await insertIndividualMember(env.DB, "H6", "z-primary@example.test");
  await env.DB.prepare(`INSERT INTO mailing_list_subscription_preferences(user_id,mailing_list_id,preference,created_at,updated_at)
    SELECT ?,id,'subscribed','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z' FROM mailing_lists WHERE email=?`)
    .bind(userId, listEmail)
    .run();
  const emails = Array.from({ length: 30 }, (_, index) => `a${String(index).padStart(2, "0")}@example.test`);
  await env.DB.batch(
    emails.map((email) =>
      env.DB.prepare(`INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,created_at)
    VALUES (?,?,?,?, '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`).bind(email, userId, email, email),
    ),
  );
  const members = emails.map((email) => ({ email, protected: false, delivery: "unknown" as const }));
  const provider: MailingListDeliveryProvider = {
    listMembers: vi.fn<MailingListDeliveryProvider["listMembers"]>(async () => ({
      members: [...members, { email: "zz-stale@example.test", protected: false, delivery: "unknown" }],
      complete: true,
    })),
    readDelivery: vi.fn<MailingListDeliveryProvider["readDelivery"]>(async (_list, selected) =>
      selected.map((email) => ({ email, protected: false, delivery: "none" })),
    ),
    applyChange: vi.fn(async () => true),
  };
  return provider;
}
it("advances past a no-op delivery prefix and reaches additions and removals on the next pass", async () => {
  const provider = await fixture();
  const first = await reconcileMailingListDeliveries(env.DB, provider, { limit: 25, dryRun: false });
  expect(first.changed).toBe(0);
  expect(provider.readDelivery).toHaveBeenLastCalledWith(listEmail, expect.arrayContaining(["a24@example.test"]));
  expect(vi.mocked(provider.readDelivery).mock.calls[0][1]).toHaveLength(25);
  expect(provider.applyChange).not.toHaveBeenCalled();
  const next = await reconcileMailingListDeliveries(env.DB, provider, { limit: 25, dryRun: false });
  expect(next.changed).toBe(2);
  expect(provider.applyChange).toHaveBeenCalledWith(listEmail, {
    email: "z-primary@example.test",
    action: "subscribe",
  });
  expect(provider.applyChange).toHaveBeenCalledWith(listEmail, {
    email: "zz-stale@example.test",
    action: "unsubscribe",
  });
  expect(vi.mocked(provider.readDelivery).mock.calls[1][1]).toHaveLength(5);
});
it("uses the persisted window for dry runs without moving it or writing provider state", async () => {
  const provider = await fixture();
  await reconcileMailingListDeliveries(env.DB, provider, { limit: 25, dryRun: false });
  const before = await env.DB.prepare(
    "SELECT list_email,address_email,revision,updated_at FROM mailing_list_delivery_cursor",
  ).all();
  const report = await reconcileMailingListDeliveries(env.DB, provider, { limit: 25, dryRun: true });
  expect(report.groups[0].entries.some((entry) => entry.action === "subscribe")).toBe(true);
  expect(report.changed).toBe(0);
  expect(provider.applyChange).not.toHaveBeenCalled();
  expect(
    await env.DB.prepare("SELECT list_email,address_email,revision,updated_at FROM mailing_list_delivery_cursor").all(),
  ).toEqual(before);
});
it("does not plan a delivery change from an uninspected setting", () => {
  const address = {
    userId: "person",
    email: "person@example.test",
    primaryEmail: "person@example.test",
    noDelivery: 1,
    confirmedSubscribed: 0,
  };
  const member = { email: address.email, protected: false, delivery: "unknown" as const };
  expect(planMailingListDelivery([address], [member])[0].action).toBe("unchanged");
  expect(planMailingListDelivery([{ ...address, noDelivery: 0, restoreDelivery: 1 }], [member])[0].action).toBe(
    "unchanged",
  );
});
it("counts actual writes and bounds the window when a provider action becomes a no-op", async () => {
  const provider = await fixture();
  vi.mocked(provider.applyChange).mockResolvedValue(false);
  await reconcileMailingListDeliveries(env.DB, provider, { limit: 25, dryRun: false });
  expect((await reconcileMailingListDeliveries(env.DB, provider, { limit: 25, dryRun: false })).changed).toBe(0);
  expect(provider.applyChange).toHaveBeenCalledTimes(2);
});
it("reaches a later delivery restoration after a no-op window", async () => {
  const provider = await fixture();
  const person = await env.DB.prepare("SELECT id FROM users WHERE email='z-primary@example.test'").first<{
    id: string;
  }>();
  await env.DB.prepare(`INSERT INTO google_groups_sync_queue(id,user_id,google_group_email,action,status,attempts,next_attempt_at,created_at)
    VALUES ('cursor-restore',?,?,'restore_delivery','pending',0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`)
    .bind(person!.id, listEmail)
    .run();
  const listing = await provider.listMembers(listEmail);
  vi.mocked(provider.listMembers).mockResolvedValue({
    ...listing,
    members: [...listing.members, { email: "z-primary@example.test", protected: false, delivery: "unknown" }],
  });
  await reconcileMailingListDeliveries(env.DB, provider, { limit: 25, dryRun: false });
  expect(provider.applyChange).not.toHaveBeenCalled();
  await reconcileMailingListDeliveries(env.DB, provider, { limit: 25, dryRun: false });
  expect(provider.applyChange).toHaveBeenCalledWith(listEmail, {
    email: "z-primary@example.test",
    action: "enable_delivery",
    delivery: "all",
  });
});
it("rotates to another list after finishing the current list's address windows", async () => {
  const provider = await fixture();
  const other = "zz-cursor@lists.example.test";
  await env.DB.prepare(`INSERT INTO mailing_lists(id,email,label,purpose,group_id,active,created_at,updated_at)
    SELECT 'cursor-list',?,'Cursor fixture','custom',group_id,1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z' FROM mailing_lists WHERE email='pkic@lists.pkic.org'`)
    .bind(other)
    .run();
  await reconcileMailingListDeliveries(env.DB, provider, { limit: 25, dryRun: false });
  await reconcileMailingListDeliveries(env.DB, provider, { limit: 25, dryRun: false });
  await reconcileMailingListDeliveries(env.DB, provider, { limit: 25, dryRun: false });
  expect(provider.listMembers).toHaveBeenLastCalledWith(other);
});
it("does not let a stale concurrent pass rewind the durable cursor", async () => {
  const provider = await fixture();
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const inspecting = new Promise<void>((resolve) => {
    started = resolve;
  });
  vi.mocked(provider.readDelivery).mockImplementationOnce(async (_list, emails) => {
    started();
    await gate;
    return emails.map((email) => ({ email, protected: false, delivery: "none" }));
  });
  const stale = reconcileMailingListDeliveries(env.DB, provider, { limit: 25, dryRun: false });
  await inspecting;
  await reconcileMailingListDeliveries(env.DB, provider, { limit: 25, dryRun: false });
  await reconcileMailingListDeliveries(env.DB, provider, { limit: 25, dryRun: false });
  const latest = await env.DB.prepare(
    "SELECT list_email,address_email,revision FROM mailing_list_delivery_cursor",
  ).first();
  release();
  await stale;
  expect(
    await env.DB.prepare("SELECT list_email,address_email,revision FROM mailing_list_delivery_cursor").first(),
  ).toEqual(latest);
});
