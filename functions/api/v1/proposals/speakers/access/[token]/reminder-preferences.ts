import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../../../../_lib/request";
import { setSpeakerPresentationReminderPreference } from "../../../../../../_lib/services/speaker-presentation-reminder-preferences";
import { proposalSpeakerReminderPreferencePatchRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts";

export const ProposalSpeakerReminderPreferencePatch = openApiRoute(
  proposalSpeakerReminderPreferencePatchRouteSchema,
  async (c: AdminContext, data) => {
    c.set?.("sensitive", true);
    const result = await setSpeakerPresentationReminderPreference(
      requestDb(c),
      data.params.token,
      requireInternalSecret(c.env),
      data.body.state,
    );
    return json({ success: true, ...result });
  },
);
