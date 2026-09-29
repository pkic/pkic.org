import { signJwt, verifyJwt, type JwtVerifyResult } from "../utils/jwt";

export interface McpSessionTokenClaims {
  typ: "mcp-session";
  sub: string;
  sid: string;
  email: string;
  role: string;
  scopes: string[];
  state?: string;
  exp: number;
}

function isMcpSessionClaims(value: object): value is McpSessionTokenClaims {
  const claims = value as Partial<McpSessionTokenClaims>;
  return (
    claims.typ === "mcp-session" &&
    typeof claims.sub === "string" &&
    typeof claims.sid === "string" &&
    typeof claims.email === "string" &&
    typeof claims.role === "string" &&
    Array.isArray(claims.scopes) &&
    claims.scopes.every((scope) => typeof scope === "string") &&
    (claims.state === undefined || typeof claims.state === "string") &&
    typeof claims.exp === "number"
  );
}

export function signMcpSessionToken(secret: string, claims: Omit<McpSessionTokenClaims, "typ">): Promise<string> {
  return signJwt(secret, { typ: "mcp-session", ...claims });
}

export async function verifyMcpSessionToken(
  secret: string,
  token: string,
): Promise<JwtVerifyResult<McpSessionTokenClaims>> {
  const result = await verifyJwt<object>(secret, token);
  if (!result.ok) return result;
  return isMcpSessionClaims(result.claims) ? { ok: true, claims: result.claims } : { ok: false, reason: "invalid" };
}
