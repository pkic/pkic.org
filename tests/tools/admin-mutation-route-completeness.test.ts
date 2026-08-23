import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ADMIN_API_ROOT = join(REPOSITORY_ROOT, "functions/api/v1/admin");
const ALLOWED_AUTH_MUTATIONS = new Set([
  "functions/api/v1/admin/auth/router.ts:post:/request-link",
  "functions/api/v1/admin/auth/router.ts:post:/logout",
  "functions/api/v1/admin/auth/router.ts:post:/verify-link",
]);

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.startsWith("._") ? [path] : [];
  });
}

function rawAdminMutationRegistrations(): string[] {
  return listTypeScriptFiles(ADMIN_API_ROOT).flatMap((path) => {
    const relativePath = relative(REPOSITORY_ROOT, path);
    const source = readFileSync(path, "utf8");
    return [...source.matchAll(/\bapp\.(post|put|patch|delete)\s*\(\s*["']([^"']+)["']/g)].map(
      (match) => `${relativePath}:${match[1]}:${match[2]}`,
    );
  });
}

describe("admin mutation route completeness", () => {
  it("allows only the three auth bootstrap/session mutations", () => {
    const registrations = rawAdminMutationRegistrations();
    expect(registrations.filter((registration) => !ALLOWED_AUTH_MUTATIONS.has(registration))).toEqual([]);
    expect(registrations.sort()).toEqual([...ALLOWED_AUTH_MUTATIONS].sort());
  });
});
