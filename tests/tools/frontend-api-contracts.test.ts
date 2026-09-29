import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const checker = path.join(repositoryRoot, "scripts/check-frontend-api-contracts.mjs");
const temporaryRoots: string[] = [];

function createFrontendFixture(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "pkic-frontend-api-contracts-"));
  temporaryRoots.push(root);
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(root, "assets/ts", relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, source);
  }
  return root;
}

const sharedClientFixture = {
  "shared/api-client.ts":
    "export declare function requestJson<T>(url: string, schema: unknown): Promise<T>;\nexport declare function getJson<T>(url: string, schema: unknown): Promise<T>;\n",
};

function runChecker(root: string): string {
  return execFileSync(process.execPath, [checker, "--root", root], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function checkerFailure(root: string): string {
  try {
    runChecker(root);
    throw new Error("Expected frontend API contract checker to fail.");
  } catch (error) {
    const result = error as { stderr?: string };
    return result.stderr ?? "";
  }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("frontend API contract architecture", () => {
  it("rejects caller-selected response generics", () => {
    const output = checkerFailure(
      createFrontendFixture({
        ...sharedClientFixture,
        "fixture.ts":
          'import { getJson } from "./shared/api-client";\nvoid getJson<{ id: string }>("/api/v1/example");\n',
      }),
    );

    expect(output).toContain("Do not call getJson<T>()");
  });

  it("rejects casts of direct fetch JSON responses", () => {
    const output = checkerFailure(
      createFrontendFixture({
        "fixture.ts": "async function load(response: Response) { return (await response.json()) as { id: string }; }\n",
      }),
    );

    expect(output).toContain("Do not cast a fetch JSON response");
  });

  it("permits binary and no-content fetch helpers that do not parse JSON", () => {
    const output = runChecker(
      createFrontendFixture({
        "fixture.ts":
          'export async function requestBinary(url: string) { return fetch(url).then((response) => response.blob()); }\nexport async function requestNoContent(url: string) { await fetch(url, { method: "DELETE" }); }\n',
      }),
    );

    expect(output).toContain("schema-validated");
  });

  it("rejects aliased and property-access transport generics", () => {
    const output = checkerFailure(
      createFrontendFixture({
        ...sharedClientFixture,
        "fixture.ts":
          'import { getJson as load } from "./shared/api-client";\nimport * as client from "./shared/api-client";\nconst localLoad = load;\nvoid load<{ id: string }>("/api/v1/example");\nvoid client.getJson<{ id: string }>("/api/v1/example");\nvoid localLoad<{ id: string }>("/api/v1/example");\n',
      }),
    );

    expect(output.match(/Do not call getJson<T>\(\)/g)).toHaveLength(3);
  });

  it("rejects requestJson generics and permissive response schemas", () => {
    const output = checkerFailure(
      createFrontendFixture({
        ...sharedClientFixture,
        "fixture.ts":
          'import { requestJson, getJson } from "./shared/api-client";\nconst responseSchema = z.unknown();\nvoid requestJson<{ id: string }>("/api/v1/example", z.any());\nvoid getJson("/api/v1/example", responseSchema);\nvoid getJson("/api/v1/example", z["custom"]());\n',
      }),
    );

    expect(output).toContain("Do not call requestJson<T>()");
    expect(output.match(/Do not pass z\.any\(\), z\.unknown\(\), or z\.custom\(\)/g)).toHaveLength(3);
  });
});
