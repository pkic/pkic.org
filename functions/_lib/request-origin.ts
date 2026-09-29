import { AppError } from "./errors";
import { logError } from "./logging";

/**
 * Rejects cross-site browser mutations. This is shared by public checkout
 * routes so origin policy cannot drift between payment products.
 */
export function assertSameOriginRequest(request: Request, expectedOrigin: string, operation: string): void {
  const secFetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const invalidFetchSite = secFetchSite !== null && secFetchSite !== "same-origin" && secFetchSite !== "none";
  const invalidOrigin = origin !== null && origin !== expectedOrigin;

  if (!invalidFetchSite && !invalidOrigin) return;

  logError("CROSS_ORIGIN_MUTATION_BLOCKED", {
    operation,
    secFetchSite,
    origin,
    expectedOrigin,
  });
  throw new AppError(403, "FORBIDDEN", "Cross-origin requests are not allowed");
}
