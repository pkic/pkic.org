import { OpenAPIRoute } from "chanfana";
import { json } from "../../_lib/http";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export async function onRequest(_c?: any): Promise<Response> {
  const response = json({
    name: "PKI Consortium API",
    version: "v1",
    docs: "/docs/events-backend/API.md",
    status: "ok",
  });
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
}

export class RouteGet extends OpenAPIRoute {
  schema = {};

  async handle(c: any) {
    return onRequest(c);
  }
}
