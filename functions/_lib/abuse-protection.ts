import { z } from "zod";
import { TURNSTILE_TOKEN_HEADER, type PublicActionPolicy } from "../../assets/shared/schemas/abuse-protection";
import { USER_SESSION_TOKEN_HEADER } from "./auth/user-session";
import { requireAdminFromRequest } from "./auth/admin";
import { requirePermission } from "./auth/permissions";
import { requestDb, markResponseSensitive, type AdminContext } from "./db/context";
import { AppError } from "./errors";
import { enforceRateLimit } from "./rate-limit";
import { getClientIp } from "./request";

const verificationSchema = z.object({
  success: z.boolean(),
  action: z.string().optional(),
  hostname: z.string().optional(),
});

/** Runs after contract validation and before any handler effect. */
export async function enforcePublicAction(c: AdminContext, policy: PublicActionPolicy): Promise<void> {
  if (!c.env.TURNSTILE_ENABLED || c.env.TURNSTILE_ENABLED === "false") return;
  if (c.env.TURNSTILE_ENABLED !== "true")
    throw new AppError(503, "BOT_PROTECTION_UNAVAILABLE", "Verification is temporarily unavailable.");
  markResponseSensitive(c);
  const clientIp = getClientIp(c.req.raw);
  await enforceRateLimit({ binding: c.env.IP_RATE_LIMITER, namespace: `abuse-${policy.action}`, key: clientIp });

  // Only verified bearer credentials with the declared live permission qualify.
  // A cookie or an API-client header is never an exemption.
  if (c.req.raw.headers.has("authorization")) {
    const request = new Request(c.req.raw.url, { headers: c.req.raw.headers });
    request.headers.delete("cookie");
    request.headers.delete(USER_SESSION_TOKEN_HEADER);
    const actor = await requireAdminFromRequest(requestDb(c), request, c.env);
    requirePermission(actor, policy.apiPermission);
    await enforceRateLimit({
      binding: c.env.IP_RATE_LIMITER,
      namespace: `abuse-client-${policy.action}`,
      key: actor.id,
    });
    return;
  }

  const siteKey = c.env.TURNSTILE_SITE_KEY?.trim();
  const secret = c.env.TURNSTILE_SECRET?.trim();
  const hostnames = (c.env.TURNSTILE_HOSTNAMES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const deploymentHost = new URL(c.env.APP_BASE_URL || c.req.raw.url).hostname;
  const unsafeLocalHost = !localHosts.has(deploymentHost) && hostnames.some((host) => localHosts.has(host));
  if (!siteKey || !secret || hostnames.length === 0 || unsafeLocalHost) {
    throw new AppError(
      503,
      "BOT_PROTECTION_UNAVAILABLE",
      "Verification is temporarily unavailable. Please try again later.",
    );
  }
  const token = c.req.raw.headers.get(TURNSTILE_TOKEN_HEADER);
  if (!token) {
    throw new AppError(403, "TURNSTILE_REQUIRED", "Please complete the verification to continue.", {
      siteKey,
      action: policy.action,
    });
  }
  if (token.length > 2048) throw invalidVerification();
  const body = new URLSearchParams({ secret, response: token });
  if (clientIp) body.set("remoteip", clientIp);
  let verified: z.infer<typeof verificationSchema>;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Verification unavailable");
    verified = verificationSchema.parse(await response.json());
  } catch {
    throw new AppError(
      503,
      "BOT_PROTECTION_UNAVAILABLE",
      "Verification is temporarily unavailable. Please try again later.",
    );
  }
  if (!verified.success || verified.action !== policy.action || !hostnames.includes(verified.hostname ?? "")) {
    throw invalidVerification();
  }
}

function invalidVerification(): AppError {
  return new AppError(403, "TURNSTILE_INVALID", "Verification expired or failed. Please submit the form again.");
}
