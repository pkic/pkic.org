import { z } from "zod";
import { permissionSchema } from "../../../../assets/shared/schemas/permissions";
import { utcInstantSchema } from "../../../../assets/shared/schemas/api-common";
import { databaseIdSchema } from "../../../../assets/shared/schemas/identifiers";
import { AppError } from "../../errors";
import type { AuthAdmin } from "../../types";
import type { AuthScope } from "../scopes";

const actorFields = { id: z.string().min(1), email: z.string().min(1), scopes: z.array(permissionSchema) };
const userProps = z.object({
  identityType: z.literal("user"),
  ...actorFields,
  sessionId: z.string().min(1),
  sessionExpiresAt: utcInstantSchema,
  sessionIdleExpiresAt: utcInstantSchema,
  state: z.string().nullable(),
});
export const mcpDelegatedOAuthPropsSchema = userProps
  .extend({ authTransport: z.literal("oauth"), authorizationId: databaseIdSchema })
  .strict();
export const mcpOAuthPropsSchema = z.union([
  mcpDelegatedOAuthPropsSchema,
  userProps.extend({ authTransport: z.enum(["bearer", "cookie"]) }).strict(),
  z
    .object({
      identityType: z.literal("service"),
      role: z.string().min(1),
      ...actorFields,
      authTransport: z.literal("api-key"),
    })
    .strict(),
]);
export type McpOAuthProps = z.infer<typeof mcpOAuthPropsSchema>;
export type McpUserOAuthProps = Extract<McpOAuthProps, { identityType: "user" }>;
export type McpServiceOAuthProps = Extract<McpOAuthProps, { identityType: "service" }>;
export type UserMcpOAuthTransport = McpUserOAuthProps["authTransport"];
export type McpOAuthTransport = McpOAuthProps["authTransport"];
export function parseMcpOauthProps(value: unknown): McpOAuthProps | undefined {
  if (value === undefined) return undefined;
  const parsed = mcpOAuthPropsSchema.safeParse(value);
  if (!parsed.success) throw new AppError(401, "MCP_AUTH_PROPS_INVALID", "Authorize the MCP client again");
  return parsed.data;
}
export function buildMcpOauthProps(
  admin: AuthAdmin,
  scopes: readonly AuthScope[],
  authTransport: McpOAuthTransport,
  staffIdleExpiresAt?: string,
): McpOAuthProps {
  const shared = { id: admin.id, email: admin.email, scopes: [...scopes] };
  if (admin.identityType === "service") {
    if (authTransport !== "api-key")
      throw new AppError(500, "MCP_AUTH_TRANSPORT_INVALID", "A service actor must use the API-key transport");
    return { identityType: "service", role: admin.role, ...shared, authTransport };
  }
  if (authTransport === "api-key" || !admin.sessionId || !admin.expiresAt || !staffIdleExpiresAt)
    throw new AppError(
      500,
      "MCP_AUTH_TRANSPORT_INVALID",
      "A user-backed MCP actor requires a session-backed transport",
    );
  const user = {
    identityType: "user" as const,
    ...shared,
    sessionId: admin.sessionId,
    sessionExpiresAt: admin.expiresAt,
    sessionIdleExpiresAt: staffIdleExpiresAt,
    state: admin.state ?? null,
  };
  if (authTransport === "oauth") {
    if (!admin.oauthAuthorizationId)
      throw new AppError(500, "MCP_AUTHORIZATION_REQUIRED", "A persisted authorization is required");
    return { ...user, authTransport, authorizationId: admin.oauthAuthorizationId };
  }
  return { ...user, authTransport };
}
