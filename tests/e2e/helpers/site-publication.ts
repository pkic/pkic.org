import { spawn } from "node:child_process";
import { once } from "node:events";
import { constants } from "node:fs";
import { cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  sitePublicationSnapshotSchema,
  type SitePublicationSnapshot,
} from "../../../assets/shared/schemas/site-publication";
import type { SitePublicationRelease } from "../../../assets/shared/schemas/site-publication-release";
import { stopProcessGroup } from "../../../scripts/e2e-process-group.mjs";

/**
 * Build one local publication, and only one at a time for a test server.
 *
 * Every build of a server shares its publication output and cache. A test that ends while its build still runs (a
 * timeout, or a failure elsewhere) leaves that build running, and the next test's build would then share, and delete,
 * the files the first one is still writing. The build runs as its own process group and is recorded beside the
 * server's state, so the next build first ends the abandoned one and waits until every process in it is gone.
 */
async function buildPublication(state: string, directory: string, environment: NodeJS.ProcessEnv): Promise<void> {
  const record = resolve(state, ".publication-build.pid");
  const abandoned = Number(await readFile(record, "utf8").catch(() => ""));
  if (Number.isInteger(abandoned) && abandoned > 0) await stopProcessGroup(abandoned);
  const build = spawn(
    "pnpm",
    ["exec", "node", "--experimental-strip-types", "scripts/publication/build-local-publication.mjs", directory],
    { env: environment, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  const output: Buffer[] = [];
  for (const stream of [build.stdout, build.stderr]) stream.on("data", (chunk: Buffer) => output.push(chunk));
  const exit = once(build, "close");
  await writeFile(record, String(build.pid));
  const [code] = (await exit) as [number | null];
  await rm(record, { force: true });
  if (code !== 0)
    throw new Error(
      `The local publication build failed with ${code}:\n${Buffer.concat(output).toString("utf8").slice(-64_000)}`,
    );
}

/**
 * A publication renders and post-processes the complete site, several minutes while other shards build theirs
 * beside it, and then waits for the Worker to serve the new release.
 */
const PUBLICATION_BUILD_BUDGET_MS = 600_000;
const RELEASE_ACTIVATION_BUDGET_MS = 120_000;

/** Explicitly publish synthetic D1 changes through the actual Astro release pipeline. */
export async function publishE2eSite(
  page: Page,
  route: string,
  fixtureSnapshot?: SitePublicationSnapshot,
): Promise<{ directory: string; snapshotId: SitePublicationRelease["snapshotId"]; snapshot: SitePublicationSnapshot }> {
  // Each publication brings its own time, so a test's budget covers only its own steps however many it publishes.
  test.info().setTimeout(test.info().timeout + PUBLICATION_BUILD_BUDGET_MS + RELEASE_ACTIVATION_BUDGET_MS);
  const state = process.env.E2E_PREPARED_STATE_DIR ?? (await readFile("test-results/e2e-state-dir", "utf8")).trim();
  await readFile(resolve(state, ".prepared"));
  const directory = resolve(state, `site-release-${crypto.randomUUID()}`);
  await cp(resolve(state, "site"), directory, { recursive: true, mode: constants.COPYFILE_FICLONE });
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PKIC_PUBLICATION_LOCAL_STATE: resolve(state, "v3"),
    CLOUDFLARE_ENV: "local",
  };
  const receiptPath = resolve(state, `publication-snapshot-receipt-${crypto.randomUUID()}.json`);
  environment.PKIC_PUBLICATION_SNAPSHOT_RECEIPT = receiptPath;
  delete environment.PKIC_PUBLICATION_SNAPSHOT;
  if (fixtureSnapshot) {
    const source = resolve(state, `synthetic-publication-source-${crypto.randomUUID()}.json`);
    await writeFile(source, JSON.stringify(sitePublicationSnapshotSchema.parse(fixtureSnapshot)));
    environment.PKIC_PUBLICATION_SNAPSHOT = source;
  }
  await buildPublication(state, directory, environment);
  const control = JSON.parse(await readFile(resolve(state, ".publication-control.json"), "utf8")) as {
    url: string;
    token: string;
  };
  const activated = await page.request.post(control.url, {
    headers: { authorization: `Bearer ${control.token}` },
    data: { directory },
  });
  expect(activated.status(), await activated.text()).toBe(202);
  const release = (await activated.json()) as { snapshotId: string };
  await expect
    .poll(
      async () => {
        try {
          const response = await page.request.get(route);
          return response.status() === 200 ? response.headers()["x-pkic-publication"] : "";
        } catch {
          return "";
        }
      },
      { timeout: RELEASE_ACTIVATION_BUDGET_MS },
    )
    .toBe(`static; snapshot=${release.snapshotId}`);
  // The server now serves this release; a superseded one is a gigabyte nothing reads any more.
  for (const entry of await readdir(state))
    if (entry.startsWith("site-release-") && resolve(state, entry) !== directory)
      await rm(resolve(state, entry), { recursive: true, force: true });
  const snapshot = sitePublicationSnapshotSchema.parse(JSON.parse(await readFile(receiptPath, "utf8")));
  expect(snapshot.snapshotId).toBe(release.snapshotId);
  return { directory, snapshotId: release.snapshotId, snapshot };
}
