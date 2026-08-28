import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listTypeScriptFiles, readTypeScriptSource, REPOSITORY_ROOT } from "./helpers/source-files";

const ADMIN_API_ROOT = join(REPOSITORY_ROOT, "functions/api/v1/admin");
const ALLOWED_AUTH_MUTATIONS = new Set<string>();

function rawAdminMutationRegistrations(): string[] {
  return listTypeScriptFiles(ADMIN_API_ROOT).flatMap((path) => {
    const relativePath = relative(REPOSITORY_ROOT, path);
    const source = readTypeScriptSource(path);
    return [...source.matchAll(/\bapp\.(post|put|patch|delete)\s*\(\s*["']([^"']+)["']/g)].map(
      (match) => `${relativePath}:${match[1]}:${match[2]}`,
    );
  });
}

describe("admin mutation route completeness", () => {
  it("has no local auth bootstrap/session mutations", () => {
    const registrations = rawAdminMutationRegistrations();
    expect(registrations.filter((registration) => !ALLOWED_AUTH_MUTATIONS.has(registration))).toEqual([]);
    expect(registrations.sort()).toEqual([...ALLOWED_AUTH_MUTATIONS].sort());
  });
});
