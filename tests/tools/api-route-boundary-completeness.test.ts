import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { listTypeScriptFiles, readTypeScriptSource, REPOSITORY_ROOT, sourceLine } from "./helpers/source-files";

const API_ROOT = join(REPOSITORY_ROOT, "functions/api/v1");
const RAW_ROUTE_ALLOWLIST = new Set([
  "functions/api/v1/admin/auth/router.ts:get:/session",
  "functions/api/v1/admin/auth/router.ts:post:/logout",
  "functions/api/v1/admin/auth/router.ts:post:/request-link",
  "functions/api/v1/admin/auth/router.ts:post:/verify-link",
  "functions/api/v1/admin/events/[eventSlug]/registrations/router.ts:get:/export",
  "functions/api/v1/auth/member/router.ts:post:/logout",
  "functions/api/v1/auth/member/router.ts:post:/request-link",
  "functions/api/v1/auth/member/router.ts:post:/verify-link",
  "functions/api/v1/auth/sponsor-portal/router.ts:post:/request-link",
  "functions/api/v1/auth/sponsor-portal/router.ts:post:/verify-link",
  "functions/api/v1/headshots/[userId]/router.ts:get:/:file",
  "functions/api/v1/internal/email/router.ts:post:/reset-failed",
  "functions/api/v1/internal/jobs/router.ts:post:/run",
  "functions/api/v1/internal/reminders/router.ts:post:/run",
  "functions/api/v1/internal/retention/router.ts:post:/run",
  "functions/api/v1/og/donation/router.ts:get:/:session_id",
  "functions/api/v1/og/router.ts:get:/:code",
  "functions/api/v1/proposals/speaker/[token]/router.ts:get:/presentation/download",
  "functions/api/v1/sponsor-portal/events/[eventId]/attendees/router.ts:get:/export",
  "functions/api/v1/sponsor-portal/router.ts:post:/logout",
]);
const MANUAL_JSON_ALLOWLIST = new Set([
  "functions/api/v1/admin/auth/request-link.ts",
  "functions/api/v1/admin/auth/verify-link.ts",
  "functions/api/v1/auth/member/request-link.ts",
  "functions/api/v1/auth/member/verify-link.ts",
  "functions/api/v1/auth/passkeys/register-complete.ts",
  "functions/api/v1/auth/sponsor-portal/request-link.ts",
  "functions/api/v1/auth/sponsor-portal/verify-link.ts",
  "functions/api/v1/internal/email/reset-failed.ts",
  "functions/api/v1/internal/email/retry.ts",
  "functions/api/v1/internal/jobs/run.ts",
  "functions/api/v1/internal/reminders/run.ts",
]);

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

describe("API route boundary completeness", () => {
  const sources = apiSources();

  it("keeps raw Hono routes within the explicit transport allowlist", () => {
    const registrations = sources.flatMap(rawRouteRegistrations).sort();
    expect(registrations).toEqual([...RAW_ROUTE_ALLOWLIST].sort());
  });

  it("limits manual JSON parsing to explicit auth-first and internal boundaries", () => {
    const violations = sources
      .filter((details) => !MANUAL_JSON_ALLOWLIST.has(details.relativePath))
      .flatMap(manualJsonParsing);
    expect(violations).toEqual([]);
  });

  it("requires mounted OpenAPI handlers to consume validated data", () => {
    expect(sources.flatMap(optionalValidatedData)).toEqual([]);
  });
});
