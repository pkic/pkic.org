import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { assembleStaticRelease } from "../../scripts/publication/assemble-static-release.mjs";

/** Worker integration tests consume the same Astro assets as a real deployment. */
export async function prepareStaticPublicationFixture(root) {
  const build = spawnSync("pnpm", ["run", "build:astro"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      CLOUDFLARE_ENV: "local",
      PKIC_PUBLICATION_SNAPSHOT: resolve(root, "tests/fixtures/site-publication.json"),
    },
    encoding: "utf8",
  });
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error(`Static publication fixture build failed:\n${build.stdout}\n${build.stderr}`);
  await assembleStaticRelease(resolve(root, "dist/astro"), resolve(root, "public"), "local");
}
import process from "node:process";
