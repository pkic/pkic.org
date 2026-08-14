import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { listPresentationVersions } from "../../../../../../../_lib/services/presentation-versions";
import { first } from "../../../../../../../_lib/db/queries";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposalId = c.req.param("proposalId");

  const proposal = await first<{ id: string }>(
    requestDb(c),
    "SELECT id FROM session_proposals WHERE id = ? AND deleted_at IS NULL",
    [proposalId],
  );
  if (!proposal) return json({ error: { message: "Proposal not found" } }, 404);

  const versions = await listPresentationVersions(requestDb(c), proposalId);
  return json({ versions });
}
