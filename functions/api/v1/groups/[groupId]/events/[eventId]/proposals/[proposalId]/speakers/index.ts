import type { ValidatedData } from "chanfana";
import { groupEventProposalSpeakersRouteSchema } from "../../../../../../../../../../assets/shared/schemas/group-event-proposals";
import { resolveAppBaseUrl } from "../../../../../../../../../_lib/config";
import type { AdminContext } from "../../../../../../../../../_lib/db/context";
import { json } from "../../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../../_lib/openapi/route";
import { getProposalSpeakerRoster } from "../../../../../../../../../_lib/services/proposal-speaker-admin";
import { groupProposalSpeakerHeadshotUrl, requireGroupProposalSpeakerContext } from "./context";

export const GroupEventProposalSpeakersGet = openApiRoute(
  groupEventProposalSpeakersRouteSchema,
  async (c: AdminContext, data: ValidatedData<typeof groupEventProposalSpeakersRouteSchema>) => {
    const { db, actor, context } = await requireGroupProposalSpeakerContext(c, data.params, "proposals:score");
    return json(
      await getProposalSpeakerRoster(db, actor, context.proposalId!, resolveAppBaseUrl(c.env, c.req.raw), {
        proposalHeadshotUrl: (userId, updatedAt) =>
          groupProposalSpeakerHeadshotUrl(c, { ...data.params, userId }, updatedAt),
      }),
    );
  },
);
