/**
 * GET /api/v1/admin/donations/:id
 *
 * Returns a single donation by its primary key.
 */

import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { getAdminDonationById } from "../../../../_lib/services/donations";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const id = c.req.param("id");
  if (!id) return json({ error: { code: "BAD_REQUEST", message: "Missing donation id" } }, 400);

  const row = await getAdminDonationById(requestDb(c), id);

  if (!row) return json({ error: { code: "NOT_FOUND", message: "Donation not found" } }, 404);

  return json({ donation: row });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(c);
}
