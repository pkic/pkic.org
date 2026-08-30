import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { listTypeScriptFiles, readTypeScriptSource, REPOSITORY_ROOT, sourceLine } from "./helpers/source-files";

const API_ROOT = join(REPOSITORY_ROOT, "functions/api/v1");
const RAW_ROUTE_ALLOWLIST = new Set([
  "functions/api/v1/donations/router.ts:get:/checkouts/:sessionId/badge",
  "functions/api/v1/registrations/router.ts:get:/referrals/:code/badge",
  "functions/api/v1/users/[userId]/headshots/router.ts:get:/:file",
  "functions/api/v1/proposals/speaker/[token]/router.ts:get:/presentation/download",
]);
const APPROVED_API_ROOTS = new Set([
  "analytics",
  "audit-log",
  "auth",
  "calendar",
  "donations",
  "email",
  "events",
  "forms",
  "geolocation",
  "groups",
  "invites",
  "leadership",
  "meetings",
  "members",
  "membership",
  "organizations",
  "permissions",
  "proposals",
  "registrations",
  "retention",
  "roles",
  "scheduler",
  "sponsors",
  "users",
  "votes",
]);
const MANUAL_JSON_ALLOWLIST = new Set(["functions/api/v1/auth/passkeys/register-complete.ts"]);

type SourceDetails = {
  path: string;
  relativePath: string;
  source: string;
  file: ts.SourceFile;
};

function apiSources(): SourceDetails[] {
  return listTypeScriptFiles(API_ROOT).map((path) => {
    const source = readTypeScriptSource(path);
    return {
      path,
      relativePath: relative(REPOSITORY_ROOT, path),
      source,
      file: ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
    };
  });
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  node.forEachChild((child) => visit(child, callback));
}

function rawRouteRegistrations(details: SourceDetails): string[] {
  const registrations: string[] = [];
  visit(details.file, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    if (!ts.isIdentifier(node.expression.expression) || node.expression.expression.text !== "app") return;
    const method = node.expression.name.text;
    if (!new Set(["get", "post", "put", "patch", "delete"]).has(method)) return;
    const route = node.arguments[0];
    if (!route || !ts.isStringLiteralLike(route)) return;
    registrations.push(`${details.relativePath}:${method}:${route.text}`);
  });
  return registrations;
}

function manualJsonParsing(details: SourceDetails): string[] {
  const locations: string[] = [];
  visit(details.file, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
    if (node.expression.text !== "parseJsonBody") return;
    locations.push(`${details.relativePath}:${sourceLine(details.source, node.getStart(details.file))}`);
  });
  return locations;
}

function optionalValidatedData(details: SourceDetails): string[] {
  const locations: string[] = [];
  visit(details.file, (node) => {
    if (!ts.isParameter(node) || !node.type || !node.type.getText(details.file).includes("ValidatedData")) return;
    const explicitlyUndefined =
      ts.isUnionTypeNode(node.type) && node.type.types.some((type) => type.kind === ts.SyntaxKind.UndefinedKeyword);
    if (!node.questionToken && !explicitlyUndefined) return;
    locations.push(`${details.relativePath}:${sourceLine(details.source, node.getStart(details.file))}`);
  });
  return locations;
}

function mountedApiRoots(): string[] {
  const details = apiSources().find((source) => source.relativePath === "functions/api/v1/router.ts");
  if (!details) throw new Error("Missing API root router");
  const roots = new Set<string>();
  visit(details.file, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    if (!ts.isIdentifier(node.expression.expression) || node.expression.expression.text !== "openapi") return;
    if (!new Set(["get", "route"]).has(node.expression.name.text)) return;
    const route = node.arguments[0];
    if (!route || !ts.isStringLiteralLike(route) || route.text === "/") return;
    const root = route.text.replace(/^\/+/, "").split("/")[0];
    if (root) roots.add(root);
  });
  return [...roots].sort();
}

describe("API route boundary completeness", () => {
  const sources = apiSources();

  it("keeps raw Hono routes within the explicit transport allowlist", () => {
    const registrations = sources.flatMap(rawRouteRegistrations).sort();
    expect(registrations).toEqual([...RAW_ROUTE_ALLOWLIST].sort());
  });

  it("mounts only approved business and resource domains at the API root", () => {
    expect(mountedApiRoots()).toEqual([...APPROVED_API_ROOTS].sort());
  });

  it("limits manual JSON parsing to explicit auth-first and signed-integration boundaries", () => {
    const violations = sources
      .filter((details) => !MANUAL_JSON_ALLOWLIST.has(details.relativePath))
      .flatMap(manualJsonParsing);
    expect(violations).toEqual([]);
  });

  it("requires mounted OpenAPI handlers to consume validated data", () => {
    expect(sources.flatMap(optionalValidatedData)).toEqual([]);
  });
});
