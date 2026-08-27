import {
  proposalProgramsListResponseSchema,
  proposalProgramsListRouteSchema,
} from "../../../../assets/shared/schemas/proposal-programs";
import { requireUserBackedAdminFromRequest } from "../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { listProposalPrograms } from "../../../_lib/services/proposal-programs";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";

export const MeProposalProgramsList = openApiRoute(proposalProgramsListRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  const result = await listProposalPrograms(db, actor, data.query);
  return json(
    proposalProgramsListResponseSchema.parse({
      programs: result.programs,
      page: buildPageInfo(data.query.limit, data.query.offset, result.total, result.programs.length),
    }),
  );
});
