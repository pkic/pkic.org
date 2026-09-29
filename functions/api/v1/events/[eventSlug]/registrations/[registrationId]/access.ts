import type { ValidatedData } from "chanfana";
import {
  eventRegistrationAccessCreateRouteSchema,
  eventRegistrationAccessResponseSchema,
} from "../../../../../../../assets/shared/schemas/route-contracts-event-registration-management";
import { resolveAppBaseUrl } from "../../../../../../_lib/config";
import type { AdminContext } from "../../../../../../_lib/db/context";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { createRegistrationManageUrl } from "../../../../../../_lib/services/registrations/access";
import { requireEventRegistrationManagement } from "../authorization";

export const EventRegistrationAccessCreate = openApiRoute(
  eventRegistrationAccessCreateRouteSchema,
  async (c: AdminContext, data: ValidatedData<typeof eventRegistrationAccessCreateRouteSchema>) => {
    if (!c.env.INTERNAL_SIGNING_SECRET) {
      return json({ error: { code: "SERVER_ERROR", message: "Signing secret not configured" } }, 500);
    }
    const { actor, db, event } = await requireEventRegistrationManagement(c, data.params.eventSlug);
    const ip =
      c.req.raw.headers.get("cf-connecting-ip") ??
      c.req.raw.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "";
    const manageUrl = await createRegistrationManageUrl(db, {
      actor,
      event,
      registrationId: data.params.registrationId,
      signingSecret: c.env.INTERNAL_SIGNING_SECRET,
      ip,
      userAgent: c.req.raw.headers.get("user-agent") ?? "",
      appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    });
    return json(eventRegistrationAccessResponseSchema.parse({ manageUrl }));
  },
);
