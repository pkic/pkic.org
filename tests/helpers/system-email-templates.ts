import app from "../../functions/router";
import { env } from "cloudflare:workers";
import { createAdminSession } from "./auth";
import { queryAll, seedEventAndAdmin } from "./context";
import { insertUser } from "./membership";
import { seedWorkflowEmailTemplates } from "./event-workflow";

let systemToken = "email-templates-system-token";

function systemRequest(path: string, init: RequestInit = {}, token = systemToken): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`https://app.test${path}`, { ...init, headers });
}
export async function callSystem(path: string, init: RequestInit = {}, token = systemToken): Promise<Response> {
  return app.fetch(
    systemRequest(path, init, token),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

export async function callWithToken(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return callSystem(path, init, token);
}

export async function createStaffSession(
  permission: "email-templates:read" | "email-templates:write",
): Promise<string> {
  const staffId = await insertUser(
    env.DB,
    `email-template-${permission.split(":")[1]}-${crypto.randomUUID()}@example.test`,
  );
  await env.DB.prepare(
    `INSERT INTO permission_grants
       (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
     VALUES (?, ?, ?, NULL, NULL, ?, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), staffId, permission, staffId)
    .run();
  return createAdminSession(env.DB, staffId, `email-template-${crypto.randomUUID()}`);
}

export async function setupSystemTemplates(): Promise<{ adminId: string }> {
  await seedEventAndAdmin(env.DB);
  const adminRow = (
    await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
  )[0];
  systemToken = await createAdminSession(env.DB, adminRow.id, systemToken);
  await seedWorkflowEmailTemplates(env.DB, adminRow.id);
  return { adminId: adminRow.id };
}
