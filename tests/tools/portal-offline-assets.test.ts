import { describe, expect, it } from "vitest";
import { portalOfflineAssets, portalOfflineAssetsPlugin } from "../../scripts/lib/portal-offline-assets.mjs";

const chunk = (id: string, imports: string[] = [], dynamicImports: string[] = []) => ({
  type: "chunk",
  facadeModuleId: id,
  modules: { [id]: {} },
  imports,
  dynamicImports,
  viteMetadata: { importedCss: new Set<string>(), importedAssets: new Set<string>() },
});
describe("build-owned scanner offline dependencies", () => {
  it("includes eager transitive modules and scanner lazy decoder resources without admin routes", () => {
    const root = chunk("/repo/assets/ts/member-flows/portal-page.tsx", ["preload.js"], ["admin.js"]);
    const scanner = chunk("/repo/OfflineScannerBootstrap.tsx", ["preload.js"], ["decoder.js"]);
    scanner.viteMetadata.importedCss.add("scanner.css");
    const decoder = chunk("/repo/decoder.ts", ["preload.js"]);
    decoder.viteMetadata.importedAssets.add("decoder.wasm");
    const bundle = {
      "portal.js": root,
      "scanner.js": scanner,
      "decoder.js": decoder,
      "preload.js": chunk("/runtime/preload.ts", ["preload.js"]),
      "admin.js": chunk("/repo/Admin.tsx"),
      "scanner.css": { type: "asset" },
      "decoder.wasm": { type: "asset" },
    };
    const metadata = (id: string) => ({
      importedIds: id === "/repo/OfflineScannerBootstrap.tsx" ? ["/repo/decoder.ts"] : [],
      dynamicallyImportedIds: [],
    });
    const inventory = portalOfflineAssets(bundle, "/_assets/", metadata);
    expect(inventory?.assets).toEqual([
      "/_assets/decoder.js",
      "/_assets/decoder.wasm",
      "/_assets/portal.js",
      "/_assets/preload.js",
      "/_assets/scanner.css",
      "/_assets/scanner.js",
    ]);
    expect(portalOfflineAssets(Object.fromEntries(Object.entries(bundle).reverse()), "/_assets/", metadata)).toEqual(
      inventory,
    );
  });
  it("keeps scanner lazy dependencies when its helper shares an eager App chunk without including admin routes", () => {
    const shared = chunk("/repo/assets/ts/member-flows/portal-page.tsx", [], ["admin.js", "worker.js"]);
    shared.modules["/repo/prepareScannerDecoder.ts"] = {};
    const bundle = {
      "portal.js": shared,
      "admin.js": chunk("/repo/PortalShell.tsx"),
      "worker.js": chunk("/repo/qr-scanner-worker.min.js"),
    };
    const inventory = portalOfflineAssets(bundle, "/_assets/", (id: string) => ({
      importedIds: [],
      dynamicallyImportedIds: id === "/repo/prepareScannerDecoder.ts" ? ["/repo/qr-scanner-worker.min.js"] : [],
    }));
    expect(inventory?.assets).toEqual(["/_assets/portal.js", "/_assets/worker.js"]);
  });
  it("refuses a declared missing dependency instead of producing an incomplete first-install cache", () => {
    expect(() =>
      portalOfflineAssets(
        { "portal.js": chunk("/repo/assets/ts/member-flows/portal-page.tsx", ["missing.js"]) },
        "/_assets/",
      ),
    ).toThrow("external to the public bundle");
  });
  it("targets the client environment when Astro shares its server build configuration", () => {
    const plugin = portalOfflineAssetsPlugin("/");
    expect(plugin.applyToEnvironment({ name: "client" })).toBe(true);
    expect(plugin.applyToEnvironment({ name: "ssr" })).toBe(false);
    expect(plugin.applyToEnvironment({ name: "prerender" })).toBe(false);
    const emitted: unknown[] = [];
    plugin.generateBundle.handler.call(
      { emitFile: (asset: unknown) => emitted.push(asset) },
      {},
      {
        "_assets/portal.js": chunk("/repo/site/portal-entry.ts"),
      },
    );
    expect(emitted).toEqual([expect.objectContaining({ fileName: "scanner-offline-inventory-build.json" })]);
  });
  it("ignores bundles without portal or initial public-shell roots", () => {
    expect(portalOfflineAssets({ "other.js": chunk("/repo/unrelated.ts") }, "/_assets/")).toBeNull();
  });
});
