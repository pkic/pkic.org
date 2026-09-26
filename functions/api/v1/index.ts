import { apiRootGetRouteSchema } from "../../../assets/shared/schemas/route-contracts";
import { apiStatusResponse } from "../../_lib/availability";
import type { AdminContext } from "../../_lib/db/context";
import { openApiRoute } from "../../_lib/openapi/route";

export const RouteGet = openApiRoute(apiRootGetRouteSchema, (c: AdminContext) => apiStatusResponse(c.env));
