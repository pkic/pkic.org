import { OpenAPIRoute, type OpenAPIRouteSchema } from "chanfana";

type RouteHandler<Context> = (context: Context) => Response | Promise<Response>;

export function openApiRoute<Context>(schema: OpenAPIRouteSchema, handle: RouteHandler<Context>): typeof OpenAPIRoute {
  return class extends OpenAPIRoute {
    schema = schema;

    handle(context: Context): Response | Promise<Response> {
      return handle(context);
    }
  };
}
