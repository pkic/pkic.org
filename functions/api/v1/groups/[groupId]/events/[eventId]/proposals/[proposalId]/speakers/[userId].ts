import type { ValidatedData } from "chanfana";
import {
  groupEventProposalSpeakerDeleteRouteSchema,
  groupEventProposalSpeakerPatchRouteSchema,
} from "../../../../../../../../../../assets/shared/schemas/group-event-proposals";
import { proposalSpeakerPatchResponseSchema } from "../../../../../../../../../../assets/shared/schemas/proposal-speakers";
import { proposalSpeakerRemovalResponseSchema } from "../../../../../../../../../../assets/shared/schemas/proposal-management";
import { resolveAppBaseUrl } from "../../../../../../../../../_lib/config";
import type { AdminContext } from "../../../../../../../../../_lib/db/context";
import { json } from "../../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../../_lib/openapi/route";
import { editProposalSpeaker } from "../../../../../../../../../_lib/services/proposal-speaker-admin";
import { removeProposalSpeakerByManager } from "../../../../../../../../../_lib/services/proposal-speaker-removal";
import { requireGroupProposalSpeakerContext } from "./context";

export const GroupEventProposalSpeakerPatch = openApiRoute(
  groupEventProposalSpeakerPatchRouteSchema,
  async (c: AdminContext, data: ValidatedData<typeof groupEventProposalSpeakerPatchRouteSchema>) => {
    const { db, actor, context, contextGuard } = await requireGroupProposalSpeakerContext(
      c,
      data.params,
      "proposals:manage",
    );
    return json(
      proposalSpeakerPatchResponseSchema.parse(
        await editProposalSpeaker(
          db,
          actor,
          context.proposalId!,
          data.params.userId,
          data.body,
          resolveAppBaseUrl(c.env, c.req.raw),
          { contextGuard },
        ),
      ),
    );
  },
);

export const GroupEventProposalSpeakerDelete = openApiRoute(
  groupEventProposalSpeakerDeleteRouteSchema,
  async (c: AdminContext, data: ValidatedData<typeof groupEventProposalSpeakerDeleteRouteSchema>) => {
    const { db, actor, context, contextGuard } = await requireGroupProposalSpeakerContext(
      c,
      data.params,
      "proposals:manage",
    );
    return json(
      proposalSpeakerRemovalResponseSchema.parse(
        await removeProposalSpeakerByManager(db, {
          actor,
          proposalId: context.proposalId!,
          userId: data.params.userId,
          replacementProposerUserId: data.body.replacementProposerUserId,
          appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
          authorization: { contextGuard },
        }),
      ),
    );
  },
);
