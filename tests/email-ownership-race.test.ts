import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { insertUser } from "./helpers/membership";
import { queryAll } from "./helpers/context";
import { buildFindOrCreateUserStatement } from "../functions/_lib/services/users";
import { prepareVerifyOwnedEmailStatements } from "../functions/_lib/services/email-verification";
import { nowIso } from "../functions/_lib/utils/time";

describe("mailbox ownership proof races", () => {
  beforeEach(resetDb);
  it("does not remove a pending alias that became verified before the claim committed", async () => {
    const source = await insertUser(env.DB, "established@source.example");
    const email = "person@work.example";
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO user_emails(id,user_id,email,normalized_email,created_at) VALUES(?,?,?,?,?)")
      .bind(id, source, email, email, nowIso())
      .run();
    const plan = await buildFindOrCreateUserStatement(env.DB, { email, mailboxVerified: true });
    await env.DB.prepare("UPDATE user_emails SET verified_at=?,verification_method='magic_link' WHERE id=?")
      .bind(nowIso(), id)
      .run();
    await expect(
      env.DB.batch([
        ...plan.statements,
        ...prepareVerifyOwnedEmailStatements(env.DB, {
          userId: plan.user.id,
          normalizedEmail: email,
          method: "magic_link",
        }),
      ]),
    ).rejects.toThrow();
    expect(
      await queryAll(env.DB, "SELECT user_id FROM user_emails WHERE id=? AND verified_at IS NOT NULL", [id]),
    ).toEqual([{ user_id: source }]);
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE id=?", [plan.user.id])).toEqual([]);
  });
  it("does not recover an unverified primary after another mailbox established the account", async () => {
    const email = "pending@work.example";
    const source = await insertUser(env.DB, email);
    const plan = await buildFindOrCreateUserStatement(env.DB, { email, mailboxVerified: true });
    const at = nowIso();
    await env.DB.prepare(
      "INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,verification_method,created_at) VALUES(?,?,?,?,?,'magic_link',?)",
    )
      .bind(crypto.randomUUID(), source, "owner@elsewhere.example", "owner@elsewhere.example", at, at)
      .run();
    await expect(
      env.DB.batch([
        ...plan.statements,
        ...prepareVerifyOwnedEmailStatements(env.DB, { userId: source, normalizedEmail: email, method: "magic_link" }),
      ]),
    ).rejects.toThrow();
    expect(await queryAll(env.DB, "SELECT email_verified_at FROM users WHERE id=?", [source])).toEqual([
      { email_verified_at: null },
    ]);
    expect(
      await queryAll(env.DB, "SELECT id FROM user_emails WHERE user_id=? AND verified_at IS NOT NULL", [source]),
    ).toHaveLength(1);
  });
});
