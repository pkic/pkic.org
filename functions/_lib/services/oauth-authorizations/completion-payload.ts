import { z } from "zod";
import { permissionSchema, PERMISSIONS } from "../../../../assets/shared/schemas/permissions";
import { oauthClientIdentitySchema } from "../../../../assets/shared/schemas/oauth-authorizations";
import { mcpDelegatedOAuthPropsSchema } from "../../auth/oauth/props";
import { sealValue, openValue } from "../../utils/sealed-value";
import { AppError } from "../../errors";

/** Internal codec for an already provider-validated request; no original request headers or cookies are persisted. */
const payloadSchema = z.object({
  request: z.object({
    responseType: z.literal("code"),
    clientId: oauthClientIdentitySchema.shape.clientId,
    redirectUri: z.string().min(1),
    scope: z.array(permissionSchema).max(PERMISSIONS.length),
    state: z.string(),
    codeChallenge: z.string().optional(),
    codeChallengeMethod: z.literal("S256").optional(),
    resource: z.union([z.string(), z.array(z.string())]).optional(),
  }),
  props: mcpDelegatedOAuthPropsSchema,
});
export type OauthCompletionPayload = z.infer<typeof payloadSchema>;
const purpose = "pkic-oauth-authorization-completion";
export async function sealOauthCompletion(value: unknown, secret: string, id: string) {
  return sealValue(JSON.stringify(payloadSchema.parse(value)), secret, purpose, id);
}
export async function openOauthCompletion(value: string, secret: string, id: string) {
  const payload = payloadSchema.parse(JSON.parse(await openValue(value, secret, purpose, id)));
  if (payload.props.authorizationId !== id)
    throw new AppError(401, "MCP_AUTHORIZATION_INACTIVE", "Authorize the MCP client again");
  return payload;
}
export const sealOauthRedirect = (value: string, secret: string, id: string) =>
  sealValue(value, secret, `${purpose}:redirect`, id);
export const openOauthRedirect = (value: string, secret: string, id: string) =>
  openValue(value, secret, `${purpose}:redirect`, id);
