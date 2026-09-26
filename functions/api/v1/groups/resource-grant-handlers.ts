import {
  eventGroupGrantRouteSchemas,
  formPlacementGroupGrantRouteSchemas,
  mailingListGroupGrantRouteSchemas,
  voteGroupGrantRouteSchemas,
} from "../../../../assets/shared/schemas/resource-grants";
import { createResourceGrantRoutes } from "./resource-grant-routes";

export const formPlacementGrantRoutes = createResourceGrantRoutes(
  "formPlacement",
  "placementId",
  formPlacementGroupGrantRouteSchemas,
);
export const eventGrantRoutes = createResourceGrantRoutes("event", "eventId", eventGroupGrantRouteSchemas);
export const voteGrantRoutes = createResourceGrantRoutes("vote", "voteId", voteGroupGrantRouteSchemas);
export const mailingListGrantRoutes = createResourceGrantRoutes(
  "mailingList",
  "listId",
  mailingListGroupGrantRouteSchemas,
);
