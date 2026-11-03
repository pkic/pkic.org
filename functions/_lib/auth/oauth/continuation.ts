import { mcpOauthRequestIdSchema } from "../../../../assets/shared/schemas/mcp-oauth";
import { getClientIp } from "../../request";
import { enforceRateLimit } from "../../rate-limit";
import { AppError } from "../../errors";
import {
  currentAuthorizeReturnTo,
  parseOauthRequestFromReturnTo,
  sanitizeAuthorizeReturnTo,
  type McpOAuthEnv,
} from "./authorization";

const CONTINUATION_TTL_SECONDS = 15 * 60;
const key = (id: string) => `mcp-authorization-request:${id}`;

/** Keep the provider-validated request across normal login, including email opened in a new tab. */
export async function createMcpAuthorizationContinuation(request: Request, env: McpOAuthEnv): Promise<string> {
  await enforceRateLimit({
    binding: env.IP_RATE_LIMITER,
    namespace: "mcp-authorization-request:ip",
    key: getClientIp(request),
  });
  const returnTo = sanitizeAuthorizeReturnTo(currentAuthorizeReturnTo(request));
  await parseOauthRequestFromReturnTo(request, env.OAUTH_PROVIDER, returnTo);
  const id = crypto.randomUUID();
  await env.OAUTH_KV.put(key(id), returnTo, { expirationTtl: CONTINUATION_TTL_SECONDS });
  return id;
}

/** A reference only recovers a request; the normal session and explicit consent still authorize it. */
export async function readMcpAuthorizationContinuation(request: Request, env: McpOAuthEnv): Promise<string> {
  const parsed = mcpOauthRequestIdSchema.safeParse(new URL(request.url).searchParams.get("request"));
  const returnTo = parsed.success ? await env.OAUTH_KV.get(key(parsed.data)) : null;
  if (!returnTo)
    throw new AppError(400, "OAUTH_REQUEST_EXPIRED", "This connection request expired. Start connecting again.");
  return sanitizeAuthorizeReturnTo(returnTo);
}
