import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { fakeServiceAccountEnv } from "./helpers/google-groups";
import { insertIndividualMember } from "./helpers/membership";
import {
  claimPendingGoogleGroupsSyncRows,
  enqueueGoogleGroupsSync,
  processGoogleGroupsSyncQueue,
  drainGoogleGroupsEnrollmentNotificationIntents,
} from "../functions/_lib/services/google-groups";
import { prepareGoogleGroupsSyncNotificationStatements } from "../functions/_lib/services/google-groups/notification-intents";
import { makeOwnEmailAddressPrimary } from "../functions/_lib/services/own-email-addresses";

const listEmail = "pkic@lists.pkic.org",
  primaryA = "address-a@example.test",
  primaryB = "address-b@example.test";
beforeEach(resetDb);
afterEach(() => vi.unstubAllGlobals());
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it.each(
  ["subscribed", "archive_only", "inherit"].flatMap((preference) =>
    [false, true].map((overlap) => ({ preference, overlap })),
  ),
)(
  "applies the latest mailbox and alias delivery after an in-flight primary swap ($preference, overlap $overlap)",
  async ({ preference, overlap }) => {
    const { userId } = await insertIndividualMember(env.DB, "H6", primaryA);
    const at = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET email_verified_at=?,email_verification_method='magic_link' WHERE id=?").bind(
        at,
        userId,
      ),
      env.DB.prepare(
        "INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,created_at) VALUES ('swap-alias',?,?,?,?,?)",
      ).bind(userId, primaryB, primaryB, at, at),
      ...(preference === "inherit"
        ? []
        : [
            env.DB.prepare(
              "INSERT INTO mailing_list_subscription_preferences(user_id,mailing_list_id,preference,created_at,updated_at) SELECT ?,id,?,?,? FROM mailing_lists WHERE email=?",
            ).bind(userId, preference, at, at, listEmail),
          ]),
    ]);
    const initialAction = preference === "inherit" ? "restore_delivery" : "add_to_list";
    await enqueueGoogleGroupsSync(env.DB, { userId, googleGroupEmail: listEmail, action: initialAction });
    const oldStarted = deferred(),
      releaseOld = deferred(),
      newStarted = deferred(),
      releaseNew = deferred();
    let oldPaused = false,
      newPaused = false;
    const members = new Map<string, { email: string; role: string; type: string; delivery_settings: string }>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("oauth2.googleapis.com")) return Response.json({ access_token: "synthetic-token" });
        if (url.includes("/members?")) return Response.json({ members: [...members.values()] });
        if (init?.method === "POST") {
          const input = JSON.parse(String(init.body)) as { email: string; delivery_settings?: string };
          if (input.email === primaryA && !oldPaused) {
            oldPaused = true;
            oldStarted.resolve();
            await releaseOld.promise;
          }
          if (overlap && input.email === primaryB && !newPaused) {
            newPaused = true;
            newStarted.resolve();
            await releaseNew.promise;
          }
          if (members.has(input.email)) return new Response(null, { status: 409 });
          members.set(input.email, {
            email: input.email,
            role: "MEMBER",
            type: "USER",
            delivery_settings: input.delivery_settings ?? "ALL_MAIL",
          });
          return Response.json({});
        }
        const email = decodeURIComponent(new URL(url).pathname.split("/").at(-1)!);
        const member = members.get(email);
        if (!member) return new Response(null, { status: 404 });
        if (init?.method === "PUT") {
          Object.assign(member, JSON.parse(String(init.body)));
          return Response.json(member);
        }
        return Response.json(member);
      }),
    );
    const configured = await fakeServiceAccountEnv();
    const oldWorker = processGoogleGroupsSyncQueue(env.DB, configured, 1);
    await oldStarted.promise;
    await makeOwnEmailAddressPrimary(env.DB, { userId, emailId: "swap-alias" });
    const newWorker = overlap ? processGoogleGroupsSyncQueue(env.DB, configured, 1) : null;
    if (overlap) await newStarted.promise;
    releaseOld.resolve();
    await oldWorker;
    releaseNew.resolve();
    if (newWorker) await newWorker;
    expect(
      await env.DB.prepare(
        `SELECT queue.status FROM google_groups_membership_desired_state desired JOIN google_groups_sync_queue queue ON queue.user_id=desired.user_id AND queue.google_group_email=desired.google_group_email AND queue.generation=desired.generation WHERE desired.user_id=? AND desired.google_group_email=?`,
      )
        .bind(userId, listEmail)
        .first("status"),
    ).toBe("pending");
    expect(await processGoogleGroupsSyncQueue(env.DB, configured, 1)).toMatchObject({ succeeded: 1, failed: 0 });
    expect(members.get(primaryB)?.delivery_settings).toBe(preference === "archive_only" ? "NONE" : "ALL_MAIL");
    expect(members.get(primaryA)?.delivery_settings).toBe("NONE");
    await drainGoogleGroupsEnrollmentNotificationIntents(env.DB, 10);
    const outbox = await env.DB.prepare(
      "SELECT recipient_email,payload_json FROM email_outbox WHERE template_key='mailing-list-enrolled'",
    ).all<{ recipient_email: string; payload_json: string }>();
    expect(outbox.results).toHaveLength(initialAction === "add_to_list" ? 1 : 0);
    if (initialAction === "add_to_list") {
      expect(outbox.results[0].recipient_email).toBe(primaryB);
      expect(JSON.parse(outbox.results[0].payload_json).lists).toEqual([listEmail]);
    }
  },
);
it("retains enrollment intent when a worker dies after adding and its replacement receives 409 with zero recorded attempts", async () => {
  const { userId } = await insertIndividualMember(env.DB, "H6", primaryA);
  const id = await enqueueGoogleGroupsSync(env.DB, { userId, googleGroupEmail: listEmail, action: "add_to_list" });
  const [claim] = await claimPendingGoogleGroupsSyncRows(env.DB, 1);
  await env.DB.batch(prepareGoogleGroupsSyncNotificationStatements(env.DB, claim, crypto.randomUUID()));
  // The provider accepted the first effect; the process died before finalizing D1.
  await env.DB.prepare("UPDATE google_groups_sync_queue SET lease_expires_at='2026-01-01T00:00:00.000Z' WHERE id=?")
    .bind(id)
    .run();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("oauth2.googleapis.com")) return Response.json({ access_token: "synthetic-token" });
      if (url.includes("/members?"))
        return Response.json({ members: [{ email: primaryA, role: "MEMBER", type: "USER" }] });
      if (init?.method === "POST") return new Response(null, { status: 409 });
      return Response.json({ role: "MEMBER", type: "USER" });
    }),
  );
  expect(await processGoogleGroupsSyncQueue(env.DB, await fakeServiceAccountEnv(), 1)).toMatchObject({ succeeded: 1 });
  expect(await drainGoogleGroupsEnrollmentNotificationIntents(env.DB, 10)).toBe(1);
  expect(await drainGoogleGroupsEnrollmentNotificationIntents(env.DB, 10)).toBe(0);
});
