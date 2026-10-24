import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";
import { expect, it } from "vitest";
import { modelRegistrySchema } from "../../assets/shared/model-registry";
import { createTemporaryDirectory } from "./helpers/temporary-directory";

async function fixture() {
  const source = await readFile("data/model-versions.yaml", "utf8");
  const registry = modelRegistrySchema.parse(parse(source));
  const commit = registry.models
    .flatMap((model) => model.versions)
    .find((version) => version.status === "draft")!.commit;
  const output = resolve(await createTemporaryDirectory("model-draft-cli-"), "registry.yaml");
  const script = resolve("scripts/models/refresh-draft-pins.ts");
  const run = (fetch: string, allowUnavailable = false) => {
    const args = ["--output", output, ...(allowUnavailable ? ["--allow-unavailable"] : [])];
    const code = `
      import { pathToFileURL } from 'node:url';
      process.argv = [process.execPath, ${JSON.stringify(script)}, ...${JSON.stringify(args)}];
      globalThis.fetch = ${fetch};
      await import(pathToFileURL(${JSON.stringify(script)}).href);
    `;
    return promisify(execFile)(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", code]);
  };
  return { source, commit, output, run };
}

it("executes the native Node entrypoint and writes its build snapshot", async () => {
  const value = await fixture();
  const result = await value.run(`async () => Response.json({ sha: ${JSON.stringify(value.commit)} })`);
  expect(result.stdout).toContain("build snapshot written");
  expect(await readFile(value.output, "utf8")).toBe(value.source);
});

it.each([403, 429, 503, "network"])("retains reviewed pins on %s only when explicitly allowed", async (failure) => {
  const value = await fixture();
  const fetch =
    failure === "network"
      ? 'async () => { throw new TypeError("fetch failed"); }'
      : `async () => new Response(null, { status: ${failure} })`;
  await expect(value.run(fetch)).rejects.toThrow("GitHub draft source is unavailable");
  await writeFile(value.output, "stale build snapshot");
  const result = await value.run(fetch, true);
  expect(result.stderr).toContain("retaining reviewed model pins");
  expect(await readFile(value.output, "utf8")).toBe(value.source);
});

it.each([401, 404])("still fails on non-availability HTTP status %s", async (status) => {
  const value = await fixture();
  await expect(value.run(`async () => new Response(null, { status: ${status} })`, true)).rejects.toThrow(
    `GitHub draft lookup failed: ${status}`,
  );
});

it("still rejects malformed commit data when availability fallback is enabled", async () => {
  const value = await fixture();
  await expect(value.run('async () => Response.json({ sha: "invalid" })', true)).rejects.toThrow();
});

it("still rejects invalid model content when availability fallback is enabled", async () => {
  const value = await fixture();
  const head = "b".repeat(40);
  const fetch = `async (url) => {
    if (url.includes('/commits/')) return Response.json({ sha: '${head}' });
    if (url.includes('/actions/')) return Response.json({ workflow_runs: [{ head_sha: '${head}', conclusion: 'success' }] });
    return new Response('model: invalid');
  }`;
  await expect(value.run(fetch, true)).rejects.toThrow();
});
