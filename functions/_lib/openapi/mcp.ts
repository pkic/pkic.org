import type { AuthScope } from "../auth/scopes";

export const AUTH_EXTENSION = "x-pkic-auth";
export const MCP_EXTENSION = "x-pkic-mcp";

type AuthSecurityScheme = "BearerAuth";

export interface AuthOperationMetadata {
  required: true;
  scheme?: AuthSecurityScheme;
  scopes?: AuthScope[];
}

export interface McpOperationMetadata {
  expose: true;
  scopes?: AuthScope[];
  readonly?: boolean;
}

type JsonObject = Record<string, any>;

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
const WRITE_METHODS = new Set(["post", "put", "patch", "delete"]);

function isAdminPath(path: string): boolean {
  return path.startsWith("/api/v1/admin/");
}

function isInternalPath(path: string): boolean {
  return path.startsWith("/api/v1/internal/");
}

function isAdminAuthPath(path: string): boolean {
  return path.startsWith("/api/v1/admin/auth");
}

function isMcpDefaultReadablePath(path: string): boolean {
  return isAdminPath(path) && !isAdminAuthPath(path);
}

function isBearerAuthPath(path: string): boolean {
  return isMcpDefaultReadablePath(path) || isInternalPath(path);
}

function inferredAuthSchemeForOperation(): AuthSecurityScheme {
  return "BearerAuth";
}

function uniqueScopes(scopes: AuthScope[]): AuthScope[] {
  return [...new Set(scopes)];
}

function formatRequiredScopes(scopes: AuthScope[]): string {
  return scopes.map((scope) => `\`${scope}\``).join(", ");
}

function withRequiredScopesDescription(operation: JsonObject, scopes: AuthScope[]): JsonObject {
  if (scopes.length === 0) {
    return operation;
  }

  const requiredScopes = `Required scopes: ${formatRequiredScopes(scopes)}.`;
  const description = typeof operation.description === "string" ? operation.description.trim() : "";
  const cleanedDescription = description.replace(/\s*Required scopes: .*\.$/s, "").trim();

  return {
    ...operation,
    description: cleanedDescription ? `${cleanedDescription}\n\n${requiredScopes}` : requiredScopes,
  };
}

export function inferredScopesForOperation(path: string, method: string): AuthScope[] {
  const scopes: AuthScope[] = [];

  if (!isBearerAuthPath(path)) {
    return scopes;
  }

  if (isInternalPath(path)) {
    return ["admin:read"];
  }

  if (path.includes("/proposal") || path.includes("/proposals")) {
    if (path.includes("/reviews")) {
      scopes.push(WRITE_METHODS.has(method) ? "proposal-reviews:write" : "proposal-reviews:read");
    } else if (path.includes("/finalize")) {
      scopes.push("proposal-finalization:write");
    } else {
      scopes.push("proposals:read");
    }
  }

  if (path.includes("/events")) {
    scopes.push("events:read");
  }

  return uniqueScopes(scopes.length > 0 ? scopes : ["admin:read"]);
}

function operationAuthMetadata(path: string, method: string, operation: JsonObject): AuthOperationMetadata | undefined {
  const explicit = operation[AUTH_EXTENSION] as AuthOperationMetadata | undefined;
  if (explicit?.required === true) {
    return {
      required: true,
      scheme: explicit.scheme ?? inferredAuthSchemeForOperation(),
      scopes: uniqueScopes(explicit.scopes ?? inferredScopesForOperation(path, method)),
    };
  }

  if (!isBearerAuthPath(path)) {
    return undefined;
  }

  return {
    required: true,
    scheme: inferredAuthSchemeForOperation(),
    scopes: inferredScopesForOperation(path, method),
  };
}

function hasMcpMetadata(operation: unknown): operation is JsonObject & { [MCP_EXTENSION]: McpOperationMetadata } {
  if (!operation || typeof operation !== "object") return false;
  const metadata = (operation as JsonObject)[MCP_EXTENSION];
  return metadata?.expose === true;
}

function shouldExposeToMcp(path: string, method: string, operation: JsonObject): boolean {
  if (hasMcpMetadata(operation)) {
    return true;
  }

  return isMcpDefaultReadablePath(path) && (method === "get" || method === "head");
}

export function decorateOpenApiSpec(spec: JsonObject): JsonObject {
  const paths: JsonObject = {};

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object") continue;

    const decoratedPathItem: JsonObject = { ...(pathItem as JsonObject) };
    for (const [key, value] of Object.entries(pathItem as JsonObject)) {
      if (!HTTP_METHODS.has(key) || !value || typeof value !== "object") continue;

      const operation = value as JsonObject;
      const auth = operationAuthMetadata(path, key, operation);
      if (!auth) continue;
      const scopes = auth.scopes ?? [];

      decoratedPathItem[key] = {
        ...withRequiredScopesDescription(operation, scopes),
        [AUTH_EXTENSION]: auth,
        "x-pkic-required-scopes": scopes,
        security: operation.security ?? [{ [auth.scheme ?? "BearerAuth"]: scopes }],
      };
    }

    paths[path] = decoratedPathItem;
  }

  return {
    ...spec,
    paths,
    components: {
      ...(spec.components ?? {}),
      securitySchemes: {
        ...(spec.components?.securitySchemes ?? {}),
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "PKI Consortium bearer token passed in the Authorization header as Bearer <token>. Security requirement values list required PKIC scopes/roles.",
        },
      },
    },
  };
}

export function filterOpenApiSpecForMcp(spec: JsonObject): JsonObject {
  const decoratedSpec = decorateOpenApiSpec(spec);
  const filteredPaths: JsonObject = {};

  for (const [path, pathItem] of Object.entries(decoratedSpec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object") continue;

    const filteredPathItem: JsonObject = {};
    for (const [key, value] of Object.entries(pathItem as JsonObject)) {
      if (!HTTP_METHODS.has(key)) continue;
      if (!value || typeof value !== "object") continue;
      if (!shouldExposeToMcp(path, key, value as JsonObject)) continue;

      const operation = value as JsonObject;
      const mcpMetadata = operation[MCP_EXTENSION] as McpOperationMetadata | undefined;
      const auth = operationAuthMetadata(path, key, operation);
      const scopes = uniqueScopes(mcpMetadata?.scopes ?? auth?.scopes ?? inferredScopesForOperation(path, key));

      filteredPathItem[key] = {
        ...withRequiredScopesDescription(operation, scopes),
        [MCP_EXTENSION]: {
          expose: true,
          readonly: mcpMetadata?.readonly ?? !WRITE_METHODS.has(key),
          scopes,
        },
        "x-pkic-required-scopes": scopes,
        security: [{ McpSession: scopes }],
      };
    }

    if (Object.keys(filteredPathItem).length > 0) {
      filteredPaths[path] = filteredPathItem;
    }
  }

  return {
    ...decoratedSpec,
    info: {
      ...decoratedSpec.info,
      title: `${decoratedSpec.info?.title ?? "PKI Consortium API"} MCP`,
    },
    paths: filteredPaths,
    components: {
      ...(decoratedSpec.components ?? {}),
      securitySchemes: {
        ...(decoratedSpec.components?.securitySchemes ?? {}),
        McpSession: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Scoped MCP session token passed in the Authorization header as Bearer <token>. Security requirement values list required PKIC scopes/roles.",
        },
      },
    },
  };
}
