import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { requireInternalSecret } from "../../../../_lib/request";
import { createProposalAccessLink } from "../../../../_lib/services/proposal-access-links";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const actor = await requireAdminFromRequest(db, c.req.raw, c.env);
  const manageUrl = await createProposalAccessLink(db, {
    actor,
    proposalId: c.req.param("proposalId"),
    signingSecret: requireInternalSecret(c.env),
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
  });
  return json({ manageUrl });
}
