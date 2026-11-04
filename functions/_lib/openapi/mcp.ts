import type { AuthScope } from "../auth/scopes";

export const AUTH_EXTENSION = "x-pkic-auth";
export const MCP_EXTENSION = "x-pkic-mcp";

type AuthSecurityScheme = "BearerAuth";

export interface AuthOperationMetadata {
  required: true;
  scheme?: AuthSecurityScheme;
  scopes?: AuthScope[];
  scopesAnyOf?: AuthScope[][];
}

export interface McpOperationMetadata {
  expose: boolean;
  reason?: string;
  readonly?: boolean;
}

type JsonObject = Record<string, any>;

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
const WRITE_METHODS = new Set(["post", "put", "patch", "delete"]);

function inferredAuthSchemeForOperation(): AuthSecurityScheme {
  return "BearerAuth";
}

function uniqueScopes(scopes: AuthScope[]): AuthScope[] {
  return [...new Set(scopes)];
}

function uniqueScopeAlternatives(alternatives: AuthScope[][]): AuthScope[][] {
  return [
    ...new Map(
      alternatives
        .map(uniqueScopes)
        .filter((scopes) => scopes.length > 0)
        .map((scopes) => [scopes.join("\u0000"), scopes]),
    ).values(),
  ];
}

function formatRequiredScopes(scopes: AuthScope[]): string {
  return scopes.map((scope) => `\`${scope}\``).join(", ");
}

function withRequiredScopesDescription(
  operation: JsonObject,
  scopes: AuthScope[],
  scopesAnyOf: AuthScope[][] = [],
): JsonObject {
  if (scopes.length === 0 && scopesAnyOf.length === 0) {
    return operation;
  }

  const requiredScopes =
    scopesAnyOf.length > 0
      ? `Required scope alternative: ${scopesAnyOf.map((alternative) => `[${formatRequiredScopes(alternative)}]`).join(" or ")}.`
      : `Required scopes: ${formatRequiredScopes(scopes)}.`;
  const description = typeof operation.description === "string" ? operation.description.trim() : "";
  const cleanedDescription = description.replace(/\s*Required (?:scopes|scope alternative): .*\.$/s, "").trim();

  return {
    ...operation,
    description: cleanedDescription ? `${cleanedDescription}\n\n${requiredScopes}` : requiredScopes,
  };
}

/**
 * Authorization metadata comes from each route's own `x-pkic-auth`
 * declaration. It used to be inferred from the `/api/v1/admin/` prefix, which
 * meant "staff surface"; that prefix is retired, so every predicate built on
 * it was permanently false and the inference silently stopped applying. Rather
 * than guess from path shape, an operation now either declares its
 * requirement or is reported by the contract test below as undeclared.
 */
function operationAuthMetadata(path: string, method: string, operation: JsonObject): AuthOperationMetadata | undefined {
  const explicit = operation[AUTH_EXTENSION] as AuthOperationMetadata | undefined;
  if (explicit?.required === true) {
    const scopesAnyOf = uniqueScopeAlternatives(explicit.scopesAnyOf ?? []);
    return {
      required: true,
      scheme: explicit.scheme ?? inferredAuthSchemeForOperation(),
      scopes: uniqueScopes(explicit.scopes ?? []),
      ...(scopesAnyOf.length > 0 ? { scopesAnyOf } : {}),
    };
  }

  if (explicit?.required === false) {
    return undefined;
  }

  // Undeclared. Reported by the OpenAPI auth-declaration contract test so the
  // backlog is visible and cannot grow, rather than being asserted here on a
  // guess about what the route actually enforces.
  return undefined;
}

function shouldExposeToMcp(path: string, method: string, operation: JsonObject): boolean {
  // This selects transport capabilities, never permissions. The canonical
  // route still authenticates, validates, and authorizes every request.
  if (!isApiPath(path) || !MCP_HTTP_METHODS.has(method) || operation[MCP_EXTENSION]?.expose === false) return false;
  const supportsJson = (content: unknown) =>
    !content ||
    (typeof content === "object" &&
      Object.keys(content).every((type) => type === "application/json" || type.endsWith("+json")));
  if (!supportsJson(operation.requestBody?.content)) return false;
  return Object.entries(operation.responses ?? {}).every(
    ([status, response]) => !/^2\d\d$/.test(status) || supportsJson((response as JsonObject)?.content),
  );
}

export const MCP_HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

export function isApiPath(path: string): boolean {
  return path === "/api/v1" || path.startsWith("/api/v1/");
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
      const scopesAnyOf = auth.scopesAnyOf ?? [];
      const scheme = auth.scheme ?? "BearerAuth";

      decoratedPathItem[key] = {
        ...withRequiredScopesDescription(operation, scopes, scopesAnyOf),
        [AUTH_EXTENSION]: auth,
        ...(scopesAnyOf.length > 0
          ? { "x-pkic-required-scopes-any-of": scopesAnyOf }
          : { "x-pkic-required-scopes": scopes }),
        security:
          operation.security ??
          (scopesAnyOf.length > 0
            ? scopesAnyOf.map((alternative) => ({ [scheme]: alternative }))
            : [{ [scheme]: scopes }]),
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

    const filteredPathItem: JsonObject = Object.fromEntries(
      Object.entries(pathItem as JsonObject).filter(([key]) => !HTTP_METHODS.has(key)),
    );
    let hasOperation = false;
    for (const [key, value] of Object.entries(pathItem as JsonObject)) {
      if (!HTTP_METHODS.has(key)) continue;
      if (!value || typeof value !== "object") continue;
      if (!shouldExposeToMcp(path, key, value as JsonObject)) continue;

      const operation = value as JsonObject;
      hasOperation = true;
      const mcpMetadata = operation[MCP_EXTENSION] as McpOperationMetadata | undefined;
      const auth = operationAuthMetadata(path, key, operation);
      const scopesAnyOf = uniqueScopeAlternatives(auth?.scopesAnyOf ?? []);
      const scopes = uniqueScopes(auth?.scopes ?? []);

      filteredPathItem[key] = {
        ...withRequiredScopesDescription(operation, scopes, scopesAnyOf),
        [MCP_EXTENSION]: {
          expose: true,
          readonly: mcpMetadata?.readonly ?? !WRITE_METHODS.has(key),
          scopes,
          ...(scopesAnyOf.length > 0 ? { scopesAnyOf } : {}),
        },
        ...(scopesAnyOf.length > 0
          ? { "x-pkic-required-scopes-any-of": scopesAnyOf }
          : { "x-pkic-required-scopes": scopes }),
        ...(Array.isArray(operation.security)
          ? {
              security: operation.security.map((requirement: JsonObject) =>
                Object.fromEntries(
                  Object.entries(requirement).map(([scheme, value]) => [
                    scheme === "BearerAuth" ? "McpSession" : scheme,
                    value,
                  ]),
                ),
              ),
            }
          : {}),
      };
    }

    if (hasOperation) {
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
