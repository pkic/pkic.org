import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { expect } from "@playwright/test";
import { createTestHarness, unstable_readConfig as readConfig, type Unstable_Config } from "wrangler";
import { sitePublicationReleaseSchema } from "../../../assets/shared/schemas/site-publication-release";
import type { publishE2eSite } from "./site-publication";

/** Serve the real built release and application Worker with D1 deliberately absent. */
export async function startPublicAgendaOutage(artifact: Awaited<ReturnType<typeof publishE2eSite>>) {
  const release = sitePublicationReleaseSchema.parse(
    JSON.parse(await readFile(resolve(artifact.directory, "publication.json"), "utf8")),
  );
  expect(release.environment).toBe("local");
  expect(release.snapshotId).toBe(artifact.snapshotId);
  expect(release.integrity).toBeDefined();
  // Use the existing native-Node verifier, including its canonical schema graph.
  await promisify(execFile)(
    "pnpm",
    [
      "exec",
      "node",
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      'import { readFile } from "node:fs/promises"; import { resolve } from "node:path"; ' +
        'import { sitePublicationReleaseSchema } from "./assets/shared/schemas/site-publication-release.ts"; ' +
        'import { verifyReleaseIntegrity } from "./scripts/publication/release-integrity.mjs"; ' +
        "const directory = process.argv[1]; const release = sitePublicationReleaseSchema.parse(" +
        'JSON.parse(await readFile(resolve(directory, "publication.json"), "utf8"))); ' +
        "await verifyReleaseIntegrity(directory, release);",
      artifact.directory,
    ],
    { maxBuffer: 1024 * 1024 },
  );
  const configPath = resolve("dist/pkic_org_base/wrangler.json");
  const generatedConfig: unknown = JSON.parse(await readFile(configPath, "utf8"));
  // Direct SDK normalization does not retain the generated environment marker.
  expect(generatedConfig).toMatchObject({ targetEnvironment: "local", name: "pkic-org-local" });
  const config = readConfig({ config: configPath });
  expect(config.name).toBe("pkic-org-local");
  expect(config.vars.SERVICE_MODE).toBe("normal");
  expect(config.d1_databases.map((database: Unstable_Config["d1_databases"][number]) => database.binding)).toContain(
    "DB",
  );
  if (!config.main || !config.assets) throw new Error("Expected the real generated Worker and static assets");
  const server = createTestHarness({
    workers: [
      {
        config: {
          name: "public-agenda-no-d1",
          main: resolve(dirname(configPath), config.main),
          no_bundle: config.no_bundle,
          compatibility_date: config.compatibility_date,
          compatibility_flags: config.compatibility_flags,
          rules: config.rules,
          vars: config.vars,
          assets: { ...config.assets, directory: artifact.directory },
          d1_databases: [],
        },
      },
    ],
  });
  try {
    const { url } = await server.listen();
    const bindings = await server.getWorker<Record<string, unknown>>().getEnv();
    expect(bindings).not.toHaveProperty("DB");
    expect(bindings).toHaveProperty(config.assets.binding ?? "ASSETS_PUBLIC");
    return {
      url,
      release,
      close: () => server.close(),
      async proveDatabaseUnavailable(eventSlug: string) {
        const path = `/api/v1/events/${encodeURIComponent(eventSlug)}/forms/placements/event_registration`;
        const response = await server.fetch(path);
        expect(response.status).toBe(500);
        const body: unknown = await response.json();
        expect(body).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
        // withD1Session is the real Worker's first access to the absent D1 binding.
        await expect
          .poll(() => JSON.stringify(server.getLogs()))
          .toMatch(/Cannot read properties of undefined \(reading ['"]withSession['"]\)/);
        const databaseLogs = server.getLogs().filter((entry) => JSON.stringify(entry).includes("withSession"));
        expect(JSON.stringify(databaseLogs)).toContain("withD1Session");
        return {
          path,
          status: response.status,
          body,
          databaseLogs,
          databaseBindingPresent: Object.hasOwn(bindings, "DB"),
        };
      },
    };
  } catch (error) {
    await server.close();
    throw error;
  }
}
