/** Where mail about a record made as an identity goes. */
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { recordRecipientEmailSql } from "../functions/_lib/services/identities/record-recipient";
import { nowIso } from "../functions/_lib/utils/time";
import { queryAll } from "./helpers/context";
import { insertOrganization, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

let userId: string;
let identityId: string;
let emailId: string;

async function recipient(): Promise<string> {
  const [row] = await queryAll<{ email: string }>(
    env.DB,
    `SELECT ${recordRecipientEmailSql("?", "u")} AS email FROM users u WHERE u.id = ?`,
    [identityId, userId],
  );
  return row.email;
}

describe("record recipient rule", () => {
  beforeEach(async () => {
    await resetDb();
    userId = await insertUser(env.DB, "kim@gmail.example");
    identityId = crypto.randomUUID();
    emailId = crypto.randomUUID();
    const at = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user_emails (id, user_id, email, normalized_email, verified_at, verification_method, created_at)
         VALUES (?, ?, 'kim@acme.example', 'kim@acme.example', ?, 'magic_link', ?)`,
      ).bind(emailId, userId, at, at),
      env.DB.prepare(
        `INSERT INTO identities (id, user_id, organization_id, source, email_id, invited_at, started_at, created_at, updated_at)
         VALUES (?, ?, ?, 'staff', ?, ?, ?, ?, ?)`,
      ).bind(identityId, userId, await insertOrganization(env.DB, "Acme"), emailId, at, at, at, at),
    ]);
  });

  it("uses the identity's verified address while it is active and deliverable", async () => {
    expect(await recipient()).toBe("kim@acme.example");
  });

  it.each(["delivery_bounced_at", "delivery_blocked_at"] as const)(
    "falls back to the primary while the identity's address has an unresolved %s",
    async (column) => {
      await env.DB.prepare(`UPDATE user_emails SET ${column} = ? WHERE id = ?`).bind(nowIso(), emailId).run();
      expect(await recipient()).toBe("kim@gmail.example");
      await env.DB.prepare("UPDATE user_emails SET delivery_delivered_at = ? WHERE id = ?")
        .bind(new Date(Date.now() + 1000).toISOString(), emailId)
        .run();
      expect(await recipient()).toBe("kim@acme.example");
    },
  );

  it("falls back to the primary once the identity ends or its address is unproved", async () => {
    await env.DB.prepare("UPDATE user_emails SET verified_at = NULL WHERE id = ?").bind(emailId).run();
    expect(await recipient()).toBe("kim@gmail.example");
    await env.DB.prepare("UPDATE user_emails SET verified_at = ? WHERE id = ?").bind(nowIso(), emailId).run();
    await env.DB.prepare("UPDATE identities SET ended_at = ? WHERE id = ?").bind(nowIso(), identityId).run();
    expect(await recipient()).toBe("kim@gmail.example");
  });
});
