import {
  PORTAL_OFFLINE_BUILD_INVENTORY,
  portalOfflineInventorySchema,
} from "../../assets/shared/schemas/portal-offline-assets.ts";

const normalized = (id) => id.replaceAll("\\", "/").split("?")[0];
const roots = [
  "/site/pages/portal/index.astro",
  "/site/portal-entry.ts",
  "/assets/ts/member-flows/portal-page.tsx",
  "/assets/ts/shared/browser-validation.ts",
  "/assets/ts/loader.ts",
  "/assets/ts/public-site.ts",
];
const scannerRoots = [
  "/OfflineScannerBootstrap.tsx",
  "/prepareScannerDecoder.ts",
  "/qr-scanner.min.js",
  "/qr-scanner-worker.min.js",
];

/** Build metadata owns the module graph; never infer dependencies from generated JavaScript text.
 * @param {(id: string) => { importedIds?: readonly string[], dynamicallyImportedIds?: readonly string[], isExternal?: boolean } | null} [moduleInfo]
 */
export function portalOfflineAssets(bundle, prefix, moduleInfo = () => null) {
  const entries = [],
    queue = [],
    scannerModules = [],
    moduleChunks = new Map();
  for (const [file, chunk] of Object.entries(bundle)) {
    if (chunk.type !== "chunk") continue;
    const ids = [chunk.facadeModuleId, ...Object.keys(chunk.modules ?? {})].filter(Boolean).map(normalized);
    const entry = ids.some((id) => roots.some((root) => id.endsWith(root)));
    const scanner = ids.some((id) => scannerRoots.some((root) => id.endsWith(root)));
    if (entry) entries.push(prefix + file);
    for (const id of Object.keys(chunk.modules ?? {})) moduleChunks.set(id, file);
    if (scanner)
      scannerModules.push(
        ...Object.keys(chunk.modules ?? {}).filter((id) => scannerRoots.some((root) => normalized(id).endsWith(root))),
      );
    if (entry || scanner) queue.push(file);
  }
  if (!queue.length) return null;
  // A bundled chunk can contain both a scanner helper and App. Follow the
  // scanner's source-module edges, never every lazy route in that shared chunk.
  const scannerChunks = new Set(),
    visitedModules = new Set();
  while (scannerModules.length) {
    const id = scannerModules.pop();
    if (visitedModules.has(id)) continue;
    visitedModules.add(id);
    const info = moduleInfo(id);
    if (!info) throw new Error(`Offline scanner module metadata is missing: ${id}`);
    if (info.isExternal) continue;
    const file = moduleChunks.get(id);
    if (file) scannerChunks.add(file);
    scannerModules.push(...(info.importedIds ?? []), ...(info.dynamicallyImportedIds ?? []));
  }
  const assets = new Set(),
    seen = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const chunk = bundle[file];
    if (!chunk) throw new Error(`Offline dependency is absent from the emitted bundle: ${file}`);
    assets.add(prefix + file);
    if (chunk.type !== "chunk") continue;
    for (const name of [
      ...(chunk.imports ?? []),
      ...(chunk.dynamicImports ?? []).filter((name) => scannerChunks.has(name)),
    ]) {
      if (!bundle[name]) throw new Error(`Offline dependency is external to the public bundle: ${name}`);
      queue.push(name);
    }
    for (const name of [...(chunk.viteMetadata?.importedCss ?? []), ...(chunk.viteMetadata?.importedAssets ?? [])]) {
      if (!bundle[name]) throw new Error(`Offline resource is absent from the emitted bundle: ${name}`);
      assets.add(prefix + name);
    }
  }
  return portalOfflineInventorySchema.parse({
    version: 1,
    entrypoints: [...new Set(entries)].sort(),
    assets: [...assets].sort(),
  });
}

/** Shared by the standalone public shell build and Astro's portal client build. */
export function portalOfflineAssetsPlugin(prefix) {
  return {
    name: "pkic-portal-offline-assets",
    apply: "build",
    applyToEnvironment(environment) {
      return environment.name === "client";
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const inventory = portalOfflineAssets(bundle, prefix, (id) => this.getModuleInfo(id));
        if (inventory)
          this.emitFile({ type: "asset", fileName: PORTAL_OFFLINE_BUILD_INVENTORY, source: JSON.stringify(inventory) });
      },
    },
  };
}
