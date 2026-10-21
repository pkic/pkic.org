import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";
import { expect, it } from "vitest";
import { modelRegistrySchema } from "../../assets/shared/model-registry";
import { createTemporaryDirectory } from "./helpers/temporary-directory";

it("executes the native Node entrypoint and writes its build snapshot", async () => {
  const source = await readFile("data/model-versions.yaml", "utf8");
  const registry = modelRegistrySchema.parse(parse(source));
  const commit = registry.models
    .flatMap((model) => model.versions)
    .find((version) => version.status === "draft")!.commit;
  const output = resolve(await createTemporaryDirectory("model-draft-cli-"), "registry.yaml");
  const script = resolve("scripts/models/refresh-draft-pins.ts");
  const code = `
    import { pathToFileURL } from 'node:url';
    process.argv = [process.execPath, ${JSON.stringify(script)}, '--output', ${JSON.stringify(output)}];
    globalThis.fetch = async () => Response.json({ sha: ${JSON.stringify(commit)} });
    await import(pathToFileURL(${JSON.stringify(script)}).href);
  `;
  const result = await promisify(execFile)(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "--eval",
    code,
  ]);
  expect(result.stdout).toContain("build snapshot written");
  expect(await readFile(output, "utf8")).toBe(source);
});
