import { attendeePeerInvitesRouteSchema } from "../../../../../assets/shared/schemas/registration";
import { createPeerInviteHandler } from "../../../../_lib/openapi/peer-invite-route";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const onRequestPost = createPeerInviteHandler("attendee");
export const EventsEventSlugInvitesPost = openApiRoute(attendeePeerInvitesRouteSchema, onRequestPost);
