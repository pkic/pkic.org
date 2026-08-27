import type { ValidatedData } from "chanfana";
import { adminProposalSpeakersRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { getProposalSpeakerRoster } from "../../../../../_lib/services/proposal-speaker-admin";

export async function onRequestGet(
  c: AdminContext,
  data: ValidatedData<typeof adminProposalSpeakersRouteSchema>,
): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  return json(await getProposalSpeakerRoster(db, admin, data.params.proposalId, resolveAppBaseUrl(c.env, c.req.raw)));
}
