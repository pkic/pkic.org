import { handleError } from "../http";

const NO_STORE_CACHE_CONTROL = "no-store, max-age=0";

interface MiddlewareContext {
  req?: { raw: Request };
  request?: Request;
  res?: Response;
  next?: () => Promise<Response>;
}

/** Applies the shared request-id and no-store policy to stateful redirect routes. */
export async function handleNoStoreRoute(context: MiddlewareContext, next?: () => Promise<void>): Promise<Response> {
  const isHonoContext = Boolean(context.req?.raw);
  const request = (isHonoContext ? context.req?.raw : context.request) as Request | undefined;
  if (!request) {
    throw new Error("No request is available to the no-store middleware");
  }
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  try {
    if (next) await next();
    const response = isHonoContext ? context.res : await context.next?.();
    if (!response) throw new Error("No response was produced by the no-store middleware");
    response.headers.set("cache-control", NO_STORE_CACHE_CONTROL);
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (error) {
    const response = handleError(error);
    response.headers.set("cache-control", NO_STORE_CACHE_CONTROL);
    response.headers.set("x-request-id", requestId);
    return response;
  }
}
