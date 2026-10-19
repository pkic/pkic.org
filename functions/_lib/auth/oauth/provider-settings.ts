import type { OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import type { Env } from "../../types";
import { AUTH_SCOPES } from "../scopes";
import { mcpTokenLifetime } from "./session-authorization";
import {
  MCP_PATH,
  MCP_OAUTH_AUTHORIZE_PATH,
  MCP_OAUTH_TOKEN_PATH,
  MCP_OAUTH_REGISTER_PATH,
  mcpOauthLifetimes,
} from "./policy";

/** One protocol/TTL policy for HTTP token exchange and durable approval completion. */
export function mcpOauthProviderSettings(
  env: Env,
): Pick<
  OAuthProviderOptions<Env>,
  | "apiRoute"
  | "authorizeEndpoint"
  | "tokenEndpoint"
  | "clientRegistrationEndpoint"
  | "scopesSupported"
  | "accessTokenTTL"
  | "refreshTokenTTL"
  | "allowPlainPKCE"
  | "clientIdMetadataDocumentEnabled"
  | "tokenExchangeCallback"
> {
  const lifetimes = mcpOauthLifetimes(env);
  return {
    apiRoute: MCP_PATH,
    authorizeEndpoint: MCP_OAUTH_AUTHORIZE_PATH,
    tokenEndpoint: MCP_OAUTH_TOKEN_PATH,
    clientRegistrationEndpoint: MCP_OAUTH_REGISTER_PATH,
    scopesSupported: [...AUTH_SCOPES],
    ...lifetimes,
    allowPlainPKCE: false,
    clientIdMetadataDocumentEnabled: true,
    tokenExchangeCallback: (exchange) => mcpTokenLifetime(env, exchange.props, lifetimes.accessTokenTTL, exchange),
  };
}
