import { speakerPeerInvitesRouteSchema } from "../../../../../../assets/shared/schemas/registration";
import { createPeerInviteHandler } from "../../../../../_lib/openapi/peer-invite-route";
import { openApiRoute } from "../../../../../_lib/openapi/route";

export const onRequestPost = createPeerInviteHandler("speaker");
export const EventSpeakerInvitationsPost = openApiRoute(speakerPeerInvitesRouteSchema, onRequestPost);
