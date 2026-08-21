import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { sendAdminProposalSpeakerReminders } from "../../../../../../../_lib/services/proposal-reminders";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  await sendAdminProposalSpeakerReminders(db, {
    proposalId: c.req.param("proposalId"),
    userId: c.req.param("userId"),
    kind: "profile",
    actorUserId: admin.id,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
  });
  return json({ success: true });
}
