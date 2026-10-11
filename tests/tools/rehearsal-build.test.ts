import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildRehearsalSite } from "../../scripts/rehearsal/build.mjs";
import { rehearsalConfig, rehearsalEnvironment } from "../../scripts/rehearsal/config.mjs";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "rehearsal-build-"));
  directories.push(root);
  const state = path.join(root, "state");
  mkdirSync(state);
  const config = rehearsalConfig(process.cwd(), state, 8788, 8799, "synthetic-secret");
  const configPath = path.join(state, "wrangler.json");
  writeFileSync(configPath, JSON.stringify(config));
  return { root, state, config, configPath };
}

describe("rehearsal application build", () => {
  it("publishes current assets and a self-contained Worker while preserving isolated runtime bindings", () => {
    const { root, state, config, configPath } = fixture();
    const worker = path.join(root, "dist/built_worker");
    const client = path.join(root, "dist/client");
    const deploy = path.join(root, ".wrangler/deploy");
    for (const directory of [worker, client, deploy, path.join(state, "site")])
      mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(state, "site/stale.html"), "stale");
    writeFileSync(path.join(state, "database-sentinel"), "retained");
    writeFileSync(path.join(client, "index.html"), "Astro publication");
    writeFileSync(path.join(worker, "index.js"), 'export { default } from "./chunk.js";');
    writeFileSync(path.join(worker, "chunk.js"), "export default {};");
    const rules = [{ type: "ESModule", globs: ["**/*.js"] }];
    writeFileSync(
      path.join(worker, "wrangler.json"),
      JSON.stringify({ main: "index.js", rules, vars: { SENDGRID_API_BASE: "unwanted" } }),
    );
    writeFileSync(
      path.join(deploy, "config.json"),
      JSON.stringify({ configPath: "../../dist/built_worker/wrangler.json" }),
    );
    const run = vi.fn();
    buildRehearsalSite(root, state, rehearsalEnvironment({ PATH: "/bin", CLOUDFLARE_ENV: "production" }), run);
    expect(run.mock.calls[0]?.[2]).toMatchObject({
      cwd: root,
      env: { CLOUDFLARE_ENV: "local", PKIC_PUBLICATION_LOCAL_STATE: path.join(state, "v3") },
    });
    const runtime = JSON.parse(readFileSync(configPath, "utf8"));
    expect(runtime).toEqual({ ...config, main: path.join(state, "worker/index.js"), no_bundle: true, rules });
    rmSync(path.join(root, "dist"), { recursive: true });
    expect(readFileSync(runtime.main, "utf8")).toContain("./chunk.js");
    expect(readFileSync(path.join(state, "worker/chunk.js"), "utf8")).toContain("export default");
    expect(readFileSync(path.join(state, "site/index.html"), "utf8")).toBe("Astro publication");
    expect(readFileSync(path.join(state, "database-sentinel"), "utf8")).toBe("retained");
    expect(() => readFileSync(path.join(state, "site/stale.html"))).toThrow();
  });

  it("retains the previous site and runtime configuration when the build fails", () => {
    const { root, state, config, configPath } = fixture();
    mkdirSync(path.join(state, "site"));
    writeFileSync(path.join(state, "site/index.html"), "previous publication");
    expect(() =>
      buildRehearsalSite(root, state, {}, () => {
        throw new Error("Build failed");
      }),
    ).toThrow("Build failed");
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual(config);
    expect(readFileSync(path.join(state, "site/index.html"), "utf8")).toBe("previous publication");
  });
});
