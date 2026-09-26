import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import {
  clearGoogleGroupsSuppression,
  isGoogleGroupsSuppressed,
  observeGoogleGroupsMembership,
} from "../functions/_lib/services/google-groups/observe-membership";
import type { GoogleGroupsDirectoryClient } from "../functions/_lib/services/google-groups/contracts";

const GROUP = "members@pkic.org";

/** A provider that reports exactly the membership the test dictates. */
function directoryReporting(emails: string[], complete = true): GoogleGroupsDirectoryClient {
  return {
    applyMembership: async () => {
      throw new Error("observation must never write to the provider");
    },
    listMembers: async () => ({ emails: emails.map((email) => email.toLowerCase()), complete }),
  };
}

async function desire(userId: string, action: "add_to_list" | "remove_from_list"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO google_groups_membership_desired_state
       (user_id, google_group_email, desired_action, generation, updated_at)
     VALUES (?, ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(user_id, google_group_email) DO UPDATE SET desired_action = excluded.desired_action`,
  )
    .bind(userId, GROUP, action)
    .run();
}

async function observed(userId: string) {
  const [row] = await queryAll<{
    confirmed_subscribed_at: string | null;
    unsubscribed_at: string | null;
    unsubscribe_source: string | null;
    suppressed: number;
  }>(
    env.DB,
    `SELECT confirmed_subscribed_at, unsubscribed_at, unsubscribe_source, suppressed
       FROM google_groups_observed_membership WHERE user_id = ? AND google_group_email = ?`,
    [userId, GROUP],
  );
  return row;
}

describe("google groups unsubscribe detection", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDb();
    userId = await insertUser(env.DB, "member@example.test");
    await desire(userId, "add_to_list");
  });

  it("records when a member was first confirmed present", async () => {
    await observeGoogleGroupsMembership(env.DB, directoryReporting(["member@example.test"]), {
      groupEmails: [GROUP],
    });

    const row = await observed(userId);
    expect(row.confirmed_subscribed_at).not.toBeNull();
    expect(row.unsubscribed_at).toBeNull();
    expect(row.suppressed).toBe(0);
  });

  it("treats absence after a confirmed presence as an unsubscribe", async () => {
    await observeGoogleGroupsMembership(env.DB, directoryReporting(["member@example.test"]), {
      groupEmails: [GROUP],
    });
    const result = await observeGoogleGroupsMembership(env.DB, directoryReporting([]), { groupEmails: [GROUP] });

    expect(result.unsubscribesDetected).toBe(1);
    const row = await observed(userId);
    expect(row.unsubscribed_at).not.toBeNull();
    expect(row.unsubscribe_source).toBe("provider_absence");
    expect(row.suppressed).toBe(1);
  });

  it("does not call an absence an unsubscribe when presence was never confirmed", async () => {
    // Queued but not yet added: absent, but they never left anything.
    const result = await observeGoogleGroupsMembership(env.DB, directoryReporting([]), { groupEmails: [GROUP] });

    expect(result.unsubscribesDetected).toBe(0);
    const row = await observed(userId);
    expect(row.confirmed_subscribed_at).toBeNull();
    expect(row.unsubscribed_at).toBeNull();
    expect(row.suppressed).toBe(0);
  });

  it("suppresses the member so no later reconciliation can re-add them", async () => {
    await observeGoogleGroupsMembership(env.DB, directoryReporting(["member@example.test"]), {
      groupEmails: [GROUP],
    });
    await observeGoogleGroupsMembership(env.DB, directoryReporting([]), { groupEmails: [GROUP] });

    expect(await isGoogleGroupsSuppressed(env.DB, userId, GROUP)).toBe(true);

    // Desired state still says they belong — this is exactly the situation a
    // naive "desired minus actual" sweep would resolve by re-subscribing them.
    await desire(userId, "add_to_list");
    await observeGoogleGroupsMembership(env.DB, directoryReporting([]), { groupEmails: [GROUP] });
    expect(await isGoogleGroupsSuppressed(env.DB, userId, GROUP)).toBe(true);
  });

  it("does not re-detect or overwrite the original unsubscribe on later passes", async () => {
    await observeGoogleGroupsMembership(env.DB, directoryReporting(["member@example.test"]), {
      groupEmails: [GROUP],
    });
    await observeGoogleGroupsMembership(env.DB, directoryReporting([]), { groupEmails: [GROUP] });
    const first = await observed(userId);

    const second = await observeGoogleGroupsMembership(env.DB, directoryReporting([]), { groupEmails: [GROUP] });
    expect(second.unsubscribesDetected).toBe(0);
    expect((await observed(userId)).unsubscribed_at).toBe(first.unsubscribed_at);
  });

  it("refuses to infer anything from a truncated listing", async () => {
    await observeGoogleGroupsMembership(env.DB, directoryReporting(["member@example.test"]), {
      groupEmails: [GROUP],
    });

    const result = await observeGoogleGroupsMembership(env.DB, directoryReporting([], false), {
      groupEmails: [GROUP],
    });

    expect(result.groupsSkippedIncomplete).toBe(1);
    expect(result.unsubscribesDetected).toBe(0);
    expect((await observed(userId)).unsubscribed_at).toBeNull();
  });

  it("only an explicit resubscribe clears suppression", async () => {
    await observeGoogleGroupsMembership(env.DB, directoryReporting(["member@example.test"]), {
      groupEmails: [GROUP],
    });
    await observeGoogleGroupsMembership(env.DB, directoryReporting([]), { groupEmails: [GROUP] });
    expect(await isGoogleGroupsSuppressed(env.DB, userId, GROUP)).toBe(true);

    await clearGoogleGroupsSuppression(env.DB, userId, GROUP);
    expect(await isGoogleGroupsSuppressed(env.DB, userId, GROUP)).toBe(false);
    expect((await observed(userId)).unsubscribed_at).toBeNull();
  });
});
