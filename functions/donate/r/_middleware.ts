/**
 * Middleware for /donate/r/* —  mirrors the no-cache policy of /r/*.
 */
import { handleError } from "../../_lib/http";

const NO_STORE = "no-store, max-age=0";

export async function onRequest(c: any, next?: () => Promise<void>): Promise<Response> {
  const isHonoContext = Boolean(c?.req?.raw);
  const request = (isHonoContext ? c.req.raw : c.request) as Request;
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    if (next) {
      await next();
    }
    const response = isHonoContext ? c.res : await c.next();
    response.headers.set("cache-control", NO_STORE);
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (error) {
    const response = handleError(error);
    response.headers.set("cache-control", NO_STORE);
    response.headers.set("x-request-id", requestId);
    return response;
  }
}
