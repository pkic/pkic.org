import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PORTAL_DEFERRED_STYLES_BUILD_FILE, portalDeferredStyles } from "../../scripts/lib/portal-deferred-styles.mjs";
import { deferPortalRouteStyles } from "../../scripts/publication/defer-portal-route-styles.mjs";

const chunk = (id: string, imports: string[] = [], dynamicImports: string[] = [], css: string[] = []) => ({
  type: "chunk",
  facadeModuleId: id,
  imports,
  dynamicImports,
  viteMetadata: { importedCss: new Set(css) },
});

describe("portal stylesheets its lazy sections load themselves", () => {
  const bundle = {
    "_assets/script.js": chunk(
      "/repo/site/pages/portal/index.astro?astro&type=script&index=0&lang.ts",
      ["_assets/core.js"],
      ["_assets/portal-page.js"],
    ),
    "_assets/core.js": chunk("/repo/core.ts", [], [], ["_assets/core.css"]),
    "_assets/portal-page.js": chunk(
      "/repo/portal-page.tsx",
      ["_assets/core.js"],
      ["_assets/room.js"],
      ["_assets/shell.css"],
    ),
    "_assets/room.js": chunk("/repo/VirtualRoom.tsx", [], [], ["_assets/room.css", "_assets/core.css"]),
    "_assets/other.js": chunk("/repo/public-site.ts", [], [], ["_assets/public.css"]),
  };

  it("defers the CSS reached only through import() and keeps the script's static imports linked", () => {
    expect(portalDeferredStyles(bundle, "/")).toEqual(["/_assets/room.css", "/_assets/shell.css"]);
    expect(portalDeferredStyles(Object.fromEntries(Object.entries(bundle).reverse()), "/")).toEqual([
      "/_assets/room.css",
      "/_assets/shell.css",
    ]);
  });

  it("leaves bundles without the portal page alone", () => {
    expect(portalDeferredStyles({ "_assets/other.js": bundle["_assets/other.js"] }, "/")).toBeNull();
  });

  it("refuses a chunk the bundle does not emit", () => {
    expect(() => portalDeferredStyles({ "_assets/script.js": bundle["_assets/script.js"] }, "/")).toThrow(
      "absent from the emitted bundle",
    );
  });
});

async function release(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "portal-deferred-styles-"));
  try {
    await mkdir(join(directory, "portal"));
    await writeFile(
      join(directory, "portal/index.html"),
      '<!DOCTYPE html><html><head><link rel="stylesheet" href="/_assets/shell.css"><link rel="stylesheet" href="/_assets/room.css"></head><body></body></html>',
    );
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("portal shell stylesheets", () => {
  it("unlinks only the deferred stylesheets and returns them for the offline inventory", async () => {
    await release(async (directory) => {
      await writeFile(
        join(directory, PORTAL_DEFERRED_STYLES_BUILD_FILE),
        JSON.stringify({ version: 1, stylesheets: ["/_assets/room.css"] }),
      );
      expect(await deferPortalRouteStyles(directory)).toEqual(["/_assets/room.css"]);
      const html = await readFile(join(directory, "portal/index.html"), "utf8");
      expect(html).toContain('href="/_assets/shell.css"');
      expect(html).not.toContain("room.css");
    });
  });

  it("keeps every stylesheet linked for the hot-reloading client bundle", async () => {
    await release(async (directory) => {
      const page = join(directory, "portal/index.html");
      await writeFile(
        page,
        (await readFile(page, "utf8")).replace("<body>", '<body><div id="portal-app" data-client-dev="true"></div>'),
      );
      await writeFile(
        join(directory, PORTAL_DEFERRED_STYLES_BUILD_FILE),
        JSON.stringify({ version: 1, stylesheets: ["/_assets/room.css"] }),
      );
      expect(await deferPortalRouteStyles(directory)).toEqual(["/_assets/room.css"]);
      expect(await readFile(page, "utf8")).toContain('href="/_assets/room.css"');
    });
  });

  it("refuses a build without the deferred list instead of shipping every stylesheet unnoticed", async () => {
    await release(async (directory) => {
      await expect(deferPortalRouteStyles(directory)).rejects.toThrow();
    });
  });

  it.each(["https://external.example/room.css", "/_assets/room.js"])("refuses deferring %s", async (href) => {
    await release(async (directory) => {
      await writeFile(
        join(directory, PORTAL_DEFERRED_STYLES_BUILD_FILE),
        JSON.stringify({ version: 1, stylesheets: [href] }),
      );
      await expect(deferPortalRouteStyles(directory)).rejects.toThrow();
      expect(await readFile(join(directory, "portal/index.html"), "utf8")).toContain("room.css");
    });
  });
});
