import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { recordProviderPresences } from "../functions/_lib/services/google-groups/observe-membership";
import { resetDb } from "./helpers/reset-db";
import { insertIndividualMember } from "./helpers/membership";
import { makeOwnEmailAddressPrimary } from "../functions/_lib/services/own-email-addresses";
import { listMailingListDeliveryAddresses } from "../functions/_lib/services/mailing-list-subscriptions/delivery-addresses";
import { prepareMailingListEmailChange } from "../functions/_lib/services/mailing-list-subscriptions/queue-email-change";
import {
  planMailingListDelivery,
  reconcileMailingListDelivery,
} from "../functions/_lib/services/mailing-list-subscriptions/reconcile-delivery";
import type {
  MailingListDeliveryMember,
  MailingListDeliveryProvider,
} from "../functions/_lib/services/mailing-list-subscriptions/delivery-provider";

const listEmail = "pkic@lists.pkic.org",
  at = "2026-01-01T00:00:00.000Z";
async function subscriber() {
  const member = await insertIndividualMember(env.DB, "H6", "primary@example.test");
  await env.DB.prepare(`INSERT INTO mailing_list_subscription_preferences(user_id,mailing_list_id,preference,created_at,updated_at)
    SELECT ?,id,'subscribed',?,? FROM mailing_lists WHERE email=?`)
    .bind(member.userId, at, at, listEmail)
    .run();
  await env.DB.prepare(`INSERT INTO google_groups_sync_queue(id,user_id,google_group_email,action,status,attempts,next_attempt_at,created_at)
    VALUES ('test-intent',?,?,'add_to_list','completed',0,?,?)`)
    .bind(member.userId, listEmail, at, at)
    .run();
  return member.userId;
}
function provider(members: MailingListDeliveryMember[]): MailingListDeliveryProvider {
  return { listMembers: vi.fn(async () => ({ members, complete: true })), applyChange: vi.fn(async () => {}) };
}
const ordinary = (email: string): MailingListDeliveryMember => ({ email, protected: false, delivery: "all" });
async function alias(userId: string, verified = true) {
  await env.DB.prepare(
    "INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,created_at) VALUES ('alias',?,'archive@example.test','archive@example.test',?,?)",
  )
    .bind(userId, verified ? at : null, at)
    .run();
}
describe("provider-neutral mailing-list delivery", () => {
  beforeEach(resetDb);
  it("uses current subscriptions for primaries and verified aliases", async () => {
    const userId = await subscriber();
    await alias(userId, false);
    expect((await listMailingListDeliveryAddresses(env.DB, listEmail)).map((row) => row.email)).toEqual([
      "primary@example.test",
    ]);
    await env.DB.prepare("UPDATE user_emails SET verified_at=? WHERE id='alias'").bind(at).run();
    expect(await listMailingListDeliveryAddresses(env.DB, listEmail)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: "archive@example.test", primaryEmail: "primary@example.test", noDelivery: 1 }),
      ]),
    );
    await env.DB.prepare("UPDATE mailing_list_subscription_preferences SET preference='unsubscribed' WHERE user_id=?")
      .bind(userId)
      .run();
    expect(await listMailingListDeliveryAddresses(env.DB, listEmail)).toEqual([]);
  });
  it("removes stale ordinary members, protects privileged entries and gives aliases no delivery", async () => {
    const userId = await subscriber();
    await alias(userId);
    const delivery = provider([ordinary("stale@example.test"), { ...ordinary("owner@example.test"), protected: true }]);
    const report = await reconcileMailingListDelivery(
      delivery,
      listEmail,
      await listMailingListDeliveryAddresses(env.DB, listEmail),
      { limit: 25, dryRun: false },
    );
    expect(report.entries.find((entry) => entry.email === "owner@example.test")?.action).toBe("protected");
    expect(delivery.applyChange).toHaveBeenCalledWith(listEmail, {
      email: "stale@example.test",
      action: "unsubscribe",
    });
    expect(delivery.applyChange).toHaveBeenCalledWith(listEmail, {
      email: "archive@example.test",
      action: "subscribe",
      delivery: "none",
    });
    expect(vi.mocked(delivery.applyChange).mock.calls.map(([, change]) => change.email)).not.toContain(
      "owner@example.test",
    );
  });
  it("queues an email change using the existing queue and full sync removes the obsolete address", async () => {
    const userId = await subscriber();
    await env.DB.prepare(
      "INSERT INTO google_groups_observed_membership(user_id,google_group_email,confirmed_subscribed_at) VALUES (?,?,?)",
    )
      .bind(userId, listEmail, at)
      .run();
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET email='new@example.test',normalized_email='new@example.test' WHERE id=?").bind(
        userId,
      ),
      ...prepareMailingListEmailChange(env.DB, userId, at),
    ]);
    expect(
      await env.DB.prepare("SELECT status FROM google_groups_sync_queue WHERE user_id=? ORDER BY rowid DESC LIMIT 1")
        .bind(userId)
        .first("status"),
    ).toBe("pending");
    const delivery = provider([ordinary("primary@example.test")]);
    await reconcileMailingListDelivery(delivery, listEmail, await listMailingListDeliveryAddresses(env.DB, listEmail), {
      limit: 25,
      dryRun: false,
    });
    expect(delivery.applyChange).toHaveBeenCalledWith(listEmail, {
      email: "primary@example.test",
      action: "unsubscribe",
    });
    expect(delivery.applyChange).toHaveBeenCalledWith(listEmail, { email: "new@example.test", action: "subscribe" });
  });
  it("retains a verified old primary as an alias after an actual address swap", async () => {
    const userId = await subscriber();
    await alias(userId);
    await env.DB.prepare("UPDATE users SET email_verified_at=? WHERE id=?").bind(at, userId).run();
    await makeOwnEmailAddressPrimary(env.DB, { userId, emailId: "alias" });
    const delivery = provider([ordinary("primary@example.test"), ordinary("archive@example.test")]);
    await reconcileMailingListDelivery(delivery, listEmail, await listMailingListDeliveryAddresses(env.DB, listEmail), {
      limit: 25,
      dryRun: false,
    });
    expect(delivery.applyChange).toHaveBeenCalledWith(listEmail, {
      email: "primary@example.test",
      action: "disable_delivery",
      delivery: "none",
    });
    expect(
      await env.DB.prepare("SELECT wake_requested FROM scheduled_jobs WHERE job_key='google_groups_sync'").first(
        "wake_requested",
      ),
    ).toBe(1);
  });
  it("preserves a known provider unsubscribe and withdraws dependent alias access", async () => {
    const userId = await subscriber();
    await alias(userId);
    await env.DB.prepare(
      "INSERT INTO google_groups_observed_membership(user_id,google_group_email,confirmed_subscribed_at) VALUES (?,?,?)",
    )
      .bind(userId, listEmail, at)
      .run();
    const plan = planMailingListDelivery(await listMailingListDeliveryAddresses(env.DB, listEmail), [
      ordinary("archive@example.test"),
    ]);
    expect(plan.find((entry) => entry.email === "primary@example.test")?.action).toBe("unsubscribed");
    expect(plan.find((entry) => entry.email === "archive@example.test")?.action).toBe("unsubscribe");
  });
  it("does not apply an incomplete roster or write during a dry run", async () => {
    await subscriber();
    const delivery = provider([ordinary("stale@example.test")]);
    await reconcileMailingListDelivery(delivery, listEmail, await listMailingListDeliveryAddresses(env.DB, listEmail), {
      limit: 25,
      dryRun: true,
    });
    expect(delivery.applyChange).not.toHaveBeenCalled();
    vi.mocked(delivery.listMembers).mockResolvedValue({ members: [ordinary("stale@example.test")], complete: false });
    await expect(reconcileMailingListDelivery(delivery, listEmail, [], { limit: 25, dryRun: false })).rejects.toThrow(
      "Incomplete",
    );
    expect(delivery.applyChange).not.toHaveBeenCalled();
  });
  it("bounds writes and rechecks pause only for actual changes", async () => {
    const members = Array.from({ length: 50 }, (_, i) => ordinary(`member${i}@example.test`));
    const delivery = provider(members),
      canApply = vi.fn(async () => true);
    await reconcileMailingListDelivery(delivery, listEmail, [], { limit: 2, dryRun: false, canApply });
    expect(delivery.applyChange).toHaveBeenCalledTimes(2);
    expect(canApply).toHaveBeenCalledTimes(2);
  });
  it("records a provider presence baseline in the existing observations table", async () => {
    const userId = await subscriber();
    const addresses = await listMailingListDeliveryAddresses(env.DB, listEmail);
    const delivery = provider([ordinary("primary@example.test")]);
    await reconcileMailingListDelivery(delivery, listEmail, addresses, {
      limit: 25,
      dryRun: false,
      recordPresence: (rows) => recordProviderPresences(env.DB, listEmail, rows),
    });
    expect(
      await env.DB.prepare("SELECT confirmed_subscribed_at FROM google_groups_observed_membership WHERE user_id=?")
        .bind(userId)
        .first("confirmed_subscribed_at"),
    ).not.toBeNull();
    expect(delivery.applyChange).not.toHaveBeenCalled();
  });
});
