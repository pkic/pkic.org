import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { userCreateResponseSchema } from "../assets/shared/schemas/user-create";
import { createUser } from "../functions/_lib/services/user-create";
import { createUserBackedAuthAdmin } from "../functions/_lib/auth/admin-identity";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { resetDb } from "./helpers/reset-db";

let token: string;
let actorId: string;
beforeEach(async () => {
  await resetDb();
  await seedEventAndAdmin(env.DB);
  actorId = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0].id;
  token = await createAdminSession(env.DB, actorId, "user-create-tests");
});
function request(body: unknown, authenticated = true) {
  return callApi(env, "/api/v1/users", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
describe("staff user creation", () => {
  it("creates an ordinary unverified account atomically with its audit entry", async () => {
    const response = await request({ email: "New.Person@Example.test", firstName: "New", lastName: "Person" });
    expect(response.status).toBe(201);
    const { userId } = userCreateResponseSchema.parse(await response.json());
    const users = await queryAll<{ role: string; normalized_email: string }>(
      env.DB,
      "SELECT role, normalized_email, email_verified_at FROM users WHERE id = ?",
      userId,
    );
    expect(users).toEqual([{ role: "user", normalized_email: "new.person@example.test", email_verified_at: null }]);
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id = ?", userId)).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'user_created' AND entity_id = ?", userId),
    ).toHaveLength(1);
  });
  it("rejects privileged fields and unauthenticated writes", async () => {
    expect((await request({ email: "new@example.test", role: "admin" })).status).toBe(400);
    expect((await request({ email: "new@example.test" }, false)).status).toBe(401);
  });
  it("refuses an existing email and concurrent duplicates without extra audit records", async () => {
    const results = await Promise.all([
      request({ email: "same@example.test" }),
      request({ email: "SAME@example.test" }),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'user_created'")).toHaveLength(1);
  });
  it("rolls back when user-write authority is removed before commit", async () => {
    const actor = createUserBackedAuthAdmin({ id: actorId, email: "admin@pkic.org", role: "admin" });
    const raced = mutateBeforeNextBatch(env.DB, async () => {
      await env.DB.prepare("UPDATE users SET role = 'user' WHERE id = ?").bind(actorId).run();
    });
    await expect(createUser(raced, actor, { email: "blocked@example.test" })).rejects.toMatchObject({
      code: "USER_AUTHORIZATION_CHANGED",
    });
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE email = 'blocked@example.test'")).toHaveLength(0);
  });
});
