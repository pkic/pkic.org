import { z } from "zod";

export const PORTAL_OFFLINE_INVENTORY_LINK = "pkic-scanner-offline";
export const PORTAL_OFFLINE_BUILD_INVENTORY = "scanner-offline-inventory-build.json";
export const PORTAL_OFFLINE_STATIC_ASSETS = [
  "/fonts/Roboto-latin.woff2",
  "/fonts/Roboto-latin-ext.woff2",
  "/img/logo.svg",
  "/img/icon-180x180-white-trans.png",
  // The installed event app: its hero and ticket art and the manifest's icons.
  "/img/pqc/mark-color-dark.svg",
  "/img/pqc/canal-houses.svg",
  "/img/pqc/app-icon.svg",
  "/img/pqc/app-icon-192.png",
  "/img/pqc/app-icon-512.png",
  "/img/icon-180x180-white-black.png",
] as const;
const staticAssets = new Set<string>(PORTAL_OFFLINE_STATIC_ASSETS);
export const portalOfflineAssetPathSchema = z
  .string()
  .max(240)
  .refine(
    (value) =>
      staticAssets.has(value) ||
      (/^\/(?:_assets|js\/built)\/[A-Za-z0-9_./-]+\.(?:js|css|wasm|woff2|svg|png)$/.test(value) &&
        !value.includes("..") &&
        !value.includes("//")),
    "Offline assets must be bounded public build resources.",
  );
export const portalOfflineInventorySchema = z
  .object({
    version: z.literal(1),
    entrypoints: z.array(portalOfflineAssetPathSchema).min(1).max(32),
    assets: z.array(portalOfflineAssetPathSchema).min(1).max(512),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.assets).size === value.assets.length &&
      value.entrypoints.every((entry) => value.assets.includes(entry)),
    "Offline entrypoints must belong to the unique resource inventory.",
  );
export const PORTAL_OFFLINE_INVENTORY_MAX_BYTES = 128 * 1024;
export const portalOfflineInventoryPathSchema = z.string().regex(/^\/_assets\/scanner-offline-[a-f0-9]{64}\.json$/);
