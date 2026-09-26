import { enforcePublicAction } from "../abuse-protection";
import type { PublicActionPolicy } from "../../../assets/shared/schemas/abuse-protection";
import type { AdminContext } from "../db/context";
import {
  ApiException,
  coerceInputs,
  OpenAPIRoute,
  type AnyZodObject,
  type OpenAPIRouteSchema,
  type ValidatedData,
} from "chanfana";
import type { z } from "zod";
import { AppError } from "../errors";
import type { apiValidationErrorDetailsSchema } from "../../../assets/shared/schemas/api-common";
import { JSON_REQUEST_MAX_BYTES, readBoundedJsonBody } from "../http-body";

export { JSON_REQUEST_MAX_BYTES as OPENAPI_JSON_MAX_BYTES } from "../http-body";

type RouteHandler<Context, Schema> = (context: Context, data: ValidatedData<Schema>) => Response | Promise<Response>;
type BeforeValidation<Context> = (context: Context) => void | Promise<void>;

/** One entry of chanfana's `ApiException.buildResponse()`. */
interface ChanfanaErrorEntry {
  code: number;
  message: string;
  path?: readonly string[] | null;
}

/** The request sections chanfana validates as one wrapper object. */
const REQUEST_SECTIONS = new Set(["body", "query", "params", "headers"]);

/**
 * Translates chanfana's validation entries into the shared
 * `apiValidationErrorDetailsSchema` shape (`{formErrors, fieldErrors}`) that
 * the browser's validation-map helpers understand, so a refused request names
 * the exact fields instead of reaching the reader as a bare "Invalid
 * request". Issue paths arrive as `["body", "organizationId"]`; the section
 * segment is transport framing, not a field name, so it is stripped, and an
 * issue on a whole section (or with no path) becomes a form-level error.
 */
function sharedValidationDetails(
  entries: readonly ChanfanaErrorEntry[],
): z.infer<typeof apiValidationErrorDetailsSchema> {
  const formErrors: string[] = [];
  const fieldErrors: Record<string, string[]> = {};
  for (const entry of entries) {
    const path = Array.isArray(entry.path) ? [...entry.path] : [];
    if (path.length > 0 && REQUEST_SECTIONS.has(path[0])) path.shift();
    if (path.length === 0) {
      formErrors.push(entry.message);
    } else {
      (fieldErrors[path.join(".")] ??= []).push(entry.message);
    }
  }
  return { formErrors, fieldErrors };
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
/**
 * An empty query parameter means the caller did not supply one.
 *
 * `?q=` is what a cleared search box, an unset filter or a hand-built query
 * string produces, and chanfana's `coerceInputs` turns the empty value into
 * `null` — which every optional field in the shared list contract then
 * refuses with "expected string, received null". The whole list came back as
 * a 400 and the surface rendered nothing, which is what issue #11 reported as
 * representatives failing to appear and members failing to list.
 *
 * A list endpoint has no notion of "filter by the empty string": absent and
 * empty are the same request. The frontend's shared collection already drops
 * empty values before it builds the query, so this makes the two ends agree
 * — and, more to the point, means no caller can take a list down by sending
 * a parameter it left blank.
 */
function withoutEmptyValues(query: URLSearchParams): URLSearchParams {
  const supplied = new URLSearchParams();
  for (const [key, value] of query.entries()) {
    if (value !== "") supplied.append(key, value);
  }
  return supplied;
}

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
        const supplied = withoutEmptyValues(new URL(request.url).searchParams);
        unvalidatedData.query = coerceInputs(supplied, schema.request.query) ?? {};
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
          throw new AppError(
            error.status,
            "VALIDATION_ERROR",
            "Invalid request",
            sharedValidationDetails(error.buildResponse() as ChanfanaErrorEntry[]),
          );
        }
        throw error;
      }
      const policy = (schema as OpenAPIRouteSchema & { "x-pkic-abuse-protection"?: PublicActionPolicy })[
        "x-pkic-abuse-protection"
      ];
      if (policy) await enforcePublicAction(context as AdminContext, policy);
      return handle(context, data);
    }
  };
}
