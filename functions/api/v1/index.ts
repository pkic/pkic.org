import { OpenAPIRoute } from "chanfana";
import { apiRootGetRouteSchema } from "../../../assets/shared/schemas/route-contracts";
import { json } from "../../_lib/http";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export async function onRequest(_c?: any): Promise<Response> {
  const response = json({
    name: "PKI Consortium API",
    version: "v1",
    docs: "/api/v1/redocs",
    status: "ok",
  });
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
}

export class RouteGet extends OpenAPIRoute {
  schema = apiRootGetRouteSchema;

  async handle(c: any) {
    return onRequest(c);
  }
}
