import { ApiException, OpenAPIRoute, type OpenAPIRouteSchema, type ValidatedData } from "chanfana";
import { AppError } from "../errors";

type RouteHandler<Context, Schema> = (context: Context, data: ValidatedData<Schema>) => Response | Promise<Response>;

/**
 * Wraps a route schema + handler in a chanfana `OpenAPIRoute` that actually
 * validates the request (params/query/body) against `schema` before calling
 * `handle`, instead of just carrying `schema` for documentation while the
 * handler re-derives everything from the raw request itself (PR #1 review).
 *
 * Validation failures are translated from chanfana's own exception type
 * into this app's `AppError` so they flow through the existing
 * `handleError` path and keep the same `{error:{code,message,details}}`
 * envelope every other route already returns — chanfana's default
 * `formatChanfanaError` shape (`{errors,success,result}`) would otherwise
 * be a second, inconsistent error format for validation failures only.
 */
export function openApiRoute<Schema extends OpenAPIRouteSchema, Context = any>(
  schema: Schema,
  handle: RouteHandler<Context, Schema>,
): typeof OpenAPIRoute {
  return class extends OpenAPIRoute {
    schema = schema;

    async handle(context: Context): Promise<Response> {
      let data: ValidatedData<Schema>;
      try {
        data = await this.getValidatedData<Schema>();
      } catch (error) {
        if (error instanceof ApiException) {
          throw new AppError(error.status, "VALIDATION_ERROR", "Invalid request", error.buildResponse());
        }
        throw error;
      }
      return handle(context, data);
    }
  };
}
