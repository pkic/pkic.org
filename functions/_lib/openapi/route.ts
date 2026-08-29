import {
  ApiException,
  coerceInputs,
  OpenAPIRoute,
  type AnyZodObject,
  type OpenAPIRouteSchema,
  type ValidatedData,
} from "chanfana";
import { AppError } from "../errors";
import { JSON_REQUEST_MAX_BYTES, readBoundedJsonBody } from "../http-body";

export { JSON_REQUEST_MAX_BYTES as OPENAPI_JSON_MAX_BYTES } from "../http-body";

type RouteHandler<Context, Schema> = (context: Context, data: ValidatedData<Schema>) => Response | Promise<Response>;
type BeforeValidation<Context> = (context: Context) => void | Promise<void>;

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
  beforeValidation?: BeforeValidation<Context>,
): typeof OpenAPIRoute {
  return class extends OpenAPIRoute {
    schema = schema;

    private async primeUnvalidatedData(): Promise<void> {
      if (this.unvalidatedData !== undefined) return;

      const request = this.params.router.getRequest(this.args);
      const unvalidatedData: Record<string, unknown> = {};

      if (schema.request?.params) {
        unvalidatedData.params = coerceInputs(this.params.router.getUrlParams(this.args), schema.request.params);
      }

      if (schema.request?.query) {
        unvalidatedData.query = coerceInputs(new URL(request.url).searchParams, schema.request.query) ?? {};
      }

      if (schema.request?.headers) {
        const headerSchema = schema.request.headers as AnyZodObject;
        const headers: Record<string, string | null> = {};
        for (const header of Object.keys(headerSchema.shape)) {
          headers[header] = request.headers.get(header);
        }
        unvalidatedData.headers = coerceInputs(headers, headerSchema) ?? {};
      }

      if (
        !["get", "head"].includes(request.method.toLowerCase()) &&
        schema.request?.body?.content?.["application/json"]?.schema
      ) {
        // This cache is the sole downstream body source, so consume the
        // original stream once. Cloning would tee the body and retain an
        // unused branch in memory for every JSON mutation request. Network
        // requests may expose a zero-byte stream rather than `body === null`,
        // so optionality is decided after the bounded read.
        unvalidatedData.body = await readBoundedJsonBody(request as unknown as Request, JSON_REQUEST_MAX_BYTES, {
          allowEmpty: schema.request.body.required === false,
        });
      }

      // Chanfana's validator consumes this cache. Priming it here gives us a
      // bounded JSON read and one JSON.parse without a second request.json().
      this.unvalidatedData = unvalidatedData;
    }

    async handle(context: Context): Promise<Response> {
      await beforeValidation?.(context);
      await this.primeUnvalidatedData();
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
