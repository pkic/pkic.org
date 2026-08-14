import { apiRootGetRouteSchema } from "../../../assets/shared/schemas/route-contracts";
import { json } from "../../_lib/http";
import { openApiRoute } from "../../_lib/openapi/route";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export const RouteGet = openApiRoute(apiRootGetRouteSchema, async () => {
  const response = json({
    name: "PKI Consortium API",
    version: "v1",
    docs: "/api/v1/redocs",
    status: "ok",
  });
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
});
