import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { expect, it } from "vitest";
import { publishPortalOfflineInventory } from "../../scripts/publication/publish-portal-offline-inventory.mjs";
import {
  PORTAL_OFFLINE_BUILD_INVENTORY,
  PORTAL_OFFLINE_STATIC_ASSETS,
  portalOfflineInventorySchema,
} from "../../assets/shared/schemas/portal-offline-assets";

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "portal-offline-publication-"));
  try {
    const files: Record<string, string> = {
      "portal/index.html":
        '<!DOCTYPE html><html><head><script type="module" src="/_assets/portal.js"></script><script type="module" src="/js/built/loader.js"></script></head><body>Sign in</body></html>',
      "_assets/portal.js": "import './preload.js'",
      "_assets/preload.js": "export {}",
      "js/built/loader.js": "export {}",
      [PORTAL_OFFLINE_BUILD_INVENTORY]: JSON.stringify({
        version: 1,
        entrypoints: ["/_assets/portal.js"],
        assets: ["/_assets/portal.js", "/_assets/preload.js"],
      }),
      [`js/built/${PORTAL_OFFLINE_BUILD_INVENTORY}`]: JSON.stringify({
        version: 1,
        entrypoints: ["/js/built/loader.js"],
        assets: ["/js/built/loader.js"],
      }),
    };
    for (const file of PORTAL_OFFLINE_STATIC_ASSETS) files[file.slice(1)] = "canonical public resource";
    for (const [file, content] of Object.entries(files)) {
      await mkdir(dirname(join(directory, file)), { recursive: true });
      await writeFile(join(directory, file), content);
    }
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
it("binds both emitted bundle closures and public fonts to the final shell with deterministic content digest", async () => {
  await fixture(async (directory) => {
    const path = await publishPortalOfflineInventory(directory);
    const bytes = await readFile(join(directory, path));
    expect(path).toBe(`_assets/scanner-offline-${createHash("sha256").update(bytes).digest("hex")}.json`);
    const inventory = portalOfflineInventorySchema.parse(JSON.parse(bytes.toString()));
    expect(inventory.assets).toContain("/_assets/preload.js");
    for (const font of PORTAL_OFFLINE_STATIC_ASSETS) expect(inventory.assets).toContain(font);
    const html = await readFile(join(directory, "portal/index.html"), "utf8");
    expect(html).toContain(`rel="pkic-scanner-offline" href="/${path}"`);
    expect(html.toLowerCase()).toContain("<!doctype html>");
    expect(await publishPortalOfflineInventory(directory)).toBe(path);
    expect(await readFile(join(directory, "portal/index.html"), "utf8")).toBe(html);
  });
});
it("refuses missing transitive resources before attaching a misleading offline-ready inventory", async () => {
  await fixture(async (directory) => {
    await rm(join(directory, "_assets/preload.js"));
    await expect(publishPortalOfflineInventory(directory)).rejects.toThrow();
    expect(await readFile(join(directory, "portal/index.html"), "utf8")).not.toContain("pkic-scanner-offline");
  });
});
it("refuses private endpoints in emitted inventory metadata", async () => {
  await fixture(async (directory) => {
    await writeFile(
      join(directory, PORTAL_OFFLINE_BUILD_INVENTORY),
      JSON.stringify({ version: 1, entrypoints: ["/api/v1/auth/session"], assets: ["/api/v1/auth/session"] }),
    );
    await expect(publishPortalOfflineInventory(directory)).rejects.toThrow("bounded public build resources");
  });
});

it("owns eagerly linked portal CSS outside the scanner graph without adding admin JavaScript", async () => {
  await fixture(async (directory) => {
    const page = join(directory, "portal/index.html");
    await writeFile(
      page,
      (await readFile(page, "utf8")).replace("</head>", '<link href="/_assets/route.css" rel="stylesheet"></head>'),
    );
    await writeFile(join(directory, "_assets/route.css"), "@font-face{src:url(/fonts/Roboto-latin.woff2)}");
    await writeFile(join(directory, "_assets/admin.js"), "export {}");
    const path = await publishPortalOfflineInventory(directory);
    const inventory = portalOfflineInventorySchema.parse(JSON.parse(await readFile(join(directory, path), "utf8")));
    expect(inventory.assets).toContain("/_assets/route.css");
    expect(inventory.assets).toContain("/fonts/Roboto-latin.woff2");
    expect(inventory.assets).not.toContain("/_assets/admin.js");
    expect(await publishPortalOfflineInventory(directory)).toBe(path);
  });
});
it("refuses a missing eager stylesheet before claiming the portal is offline-ready", async () => {
  await fixture(async (directory) => {
    const page = join(directory, "portal/index.html");
    await writeFile(
      page,
      (await readFile(page, "utf8")).replace("</head>", '<link rel="stylesheet" href="/_assets/missing.css"></head>'),
    );
    await expect(publishPortalOfflineInventory(directory)).rejects.toThrow();
    expect(await readFile(page, "utf8")).not.toContain("pkic-scanner-offline");
  });
});
it.each(["https://external.example/style.css", "/api/v1/private.css", "/_assets/../private.css"])(
  "refuses unsafe eager stylesheet %s before publishing an inventory",
  async (href) => {
    await fixture(async (directory) => {
      const page = join(directory, "portal/index.html");
      await writeFile(
        page,
        (await readFile(page, "utf8")).replace("</head>", `<link rel="stylesheet" href="${href}"></head>`),
      );
      await expect(publishPortalOfflineInventory(directory)).rejects.toThrow("bounded public build resources");
      expect(await readFile(page, "utf8")).not.toContain("pkic-scanner-offline");
    });
  },
);
