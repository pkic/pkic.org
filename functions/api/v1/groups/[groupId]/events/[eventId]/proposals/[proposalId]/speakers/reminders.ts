import {
  groupEventProposalSpeakerReminderRouteSchema,
  groupEventProposalSpeakerRemindersRouteSchema,
} from "../../../../../../../../../../assets/shared/schemas/group-event-proposals";
import {
  proposalSpeakerReminderResponseSchema,
  proposalSpeakerRemindersResponseSchema,
} from "../../../../../../../../../../assets/shared/schemas/proposal-speakers";
import { resolveAppBaseUrl } from "../../../../../../../../../_lib/config";
import type { AdminContext } from "../../../../../../../../../_lib/db/context";
import { json } from "../../../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../../../_lib/openapi/route";
import { sendProposalSpeakerReminders } from "../../../../../../../../../_lib/services/proposal-reminders";
import { requireGroupProposalSpeakerContext } from "./context";

function reminder(kind: "profile" | "presentation", bulk: boolean) {
  return async (c: AdminContext, data: { params: Record<string, string> }) => {
    const { db, actor, context, contextGuard } = await requireGroupProposalSpeakerContext(
      c,
      data.params as { groupId: string; eventId: string; proposalId: string; userId: string },
      "proposals:manage",
    );
    const result = await sendProposalSpeakerReminders(db, {
      proposalId: context.proposalId!,
      userId: bulk ? undefined : data.params.userId,
      kind,
      actor,
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
      authorization: { contextGuard },
    });
    return json(
      bulk
        ? proposalSpeakerRemindersResponseSchema.parse({ success: true, queued: result.outboxIds.length })
        : proposalSpeakerReminderResponseSchema.parse({ success: true }),
    );
  };
}

export const GroupEventProposalSpeakerRemindPost = openApiRoute(
  groupEventProposalSpeakerReminderRouteSchema,
  reminder("profile", false),
);
export const GroupEventProposalSpeakerRemindPresentationPost = openApiRoute(
  groupEventProposalSpeakerReminderRouteSchema,
  reminder("presentation", false),
);
export const GroupEventProposalRemindSpeakersPost = openApiRoute(
  groupEventProposalSpeakerRemindersRouteSchema,
  reminder("profile", true),
);
export const GroupEventProposalRemindPresentationPost = openApiRoute(
  groupEventProposalSpeakerRemindersRouteSchema,
  reminder("presentation", true),
);
