/**
 * Middleware for /donate/r/* —  mirrors the no-cache policy of /r/*.
 */
import { handleError } from "../../_lib/http";
import type { PagesContext } from "../../_lib/types";

const NO_STORE = "no-store, max-age=0";

export async function onRequest(context: PagesContext): Promise<Response> {
  const requestId = context.request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    if (!context.next) return new Response("Middleware misconfiguration", { status: 500 });
    const response = await context.next();
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
