import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";
import {
  sitePublicationSnapshotSchema,
  type SitePublicationSnapshot,
} from "../../../assets/shared/schemas/site-publication";
import type { SitePublicationRelease } from "../../../assets/shared/schemas/site-publication-release";

/** Explicitly publish synthetic D1 changes through the actual Astro release pipeline. */
export async function publishE2eSite(
  page: Page,
  route: string,
  fixtureSnapshot?: SitePublicationSnapshot,
): Promise<{ directory: string; snapshotId: SitePublicationRelease["snapshotId"]; snapshot: SitePublicationSnapshot }> {
  const state = process.env.E2E_PREPARED_STATE_DIR ?? (await readFile("test-results/e2e-state-dir", "utf8")).trim();
  await readFile(resolve(state, ".prepared"));
  const directory = resolve(state, `site-release-${crypto.randomUUID()}`);
  await cp(resolve(state, "site"), directory, { recursive: true });
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
  await promisify(execFile)(
    "pnpm",
    ["exec", "node", "--experimental-strip-types", "scripts/publication/build-local-publication.mjs", directory],
    {
      env: environment,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
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
      { timeout: 30_000 },
    )
    .toBe(`static; snapshot=${release.snapshotId}`);
  const snapshot = sitePublicationSnapshotSchema.parse(JSON.parse(await readFile(receiptPath, "utf8")));
  expect(snapshot.snapshotId).toBe(release.snapshotId);
  return { directory, snapshotId: release.snapshotId, snapshot };
}
