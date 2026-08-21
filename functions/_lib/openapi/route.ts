import { ApiException, OpenAPIRoute, type OpenAPIRouteSchema, type ValidatedData } from "chanfana";
import { AppError } from "../errors";
import { readBoundedTextBody } from "../http-body";

export const OPENAPI_JSON_MAX_BYTES = 2 * 1024 * 1024;

type RouteHandler<Context, Schema> = (context: Context, data: ValidatedData<Schema>) => Response | Promise<Response>;

async function rejectMalformedJsonBody(context: unknown, schema: OpenAPIRouteSchema): Promise<void> {
  const rawRequest = (context as { req?: { raw?: Request } })?.req?.raw;
  const bodyContent = (schema as { request?: { body?: { content?: Record<string, unknown> } } }).request?.body?.content;
  if (!rawRequest || !bodyContent?.["application/json"]) return;
  const contentType = rawRequest.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) return;
  try {
    JSON.parse(await readBoundedTextBody(rawRequest.clone() as unknown as Request, OPENAPI_JSON_MAX_BYTES));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "INVALID_JSON", "Request body must contain valid JSON");
  }
}

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
      await rejectMalformedJsonBody(context, schema);
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
