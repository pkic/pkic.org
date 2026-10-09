import { createHash } from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import {
  PORTAL_OFFLINE_BUILD_INVENTORY,
  PORTAL_OFFLINE_INVENTORY_LINK,
  PORTAL_OFFLINE_INVENTORY_MAX_BYTES,
  PORTAL_OFFLINE_STATIC_ASSETS,
  portalOfflineInventorySchema,
  portalOfflineAssetPathSchema,
} from "../../assets/shared/schemas/portal-offline-assets.ts";

/** Bind the exact emitted public module closure to the portal shell before sealing the release. */
export async function publishPortalOfflineInventory(output) {
  const portal = resolve(output, "portal/index.html");
  const html = await readFile(portal, "utf8");
  const inventories = await Promise.all(
    [resolve(output, PORTAL_OFFLINE_BUILD_INVENTORY), resolve(output, "js/built", PORTAL_OFFLINE_BUILD_INVENTORY)].map(
      async (path) => portalOfflineInventorySchema.parse(JSON.parse(await readFile(path, "utf8"))),
    ),
  );
  const dom = new JSDOM(html);
  const document = dom.window.document;
  // Astro can eagerly link CSS from lazy routes. The actual shell owns those
  // public styles even when its scanner module graph does not import them.
  const stylesheets = [...document.querySelectorAll('link[rel~="stylesheet"][href]')].map((link) => {
    const href = portalOfflineAssetPathSchema.parse(link.getAttribute("href"));
    if (!href.endsWith(".css")) throw new Error(`Portal stylesheet is not CSS: ${href}`);
    return href;
  });
  const inventory = portalOfflineInventorySchema.parse({
    version: 1,
    entrypoints: [...new Set(inventories.flatMap((item) => item.entrypoints))].sort(),
    assets: [
      ...new Set([...inventories.flatMap((item) => item.assets), ...PORTAL_OFFLINE_STATIC_ASSETS, ...stylesheets]),
    ].sort(),
  });
  for (const asset of inventory.assets) {
    const info = await stat(resolve(output, asset.slice(1)));
    if (!info.isFile() || info.size === 0) throw new Error(`Offline resource is unavailable: ${asset}`);
  }
  for (const script of document.querySelectorAll('script[type="module"][src]')) {
    const src = script.getAttribute("src");
    if (!inventory.entrypoints.includes(src))
      throw new Error(`Portal module is missing from its offline inventory: ${src}`);
  }
  const bytes = JSON.stringify(inventory);
  if (Buffer.byteLength(bytes) > PORTAL_OFFLINE_INVENTORY_MAX_BYTES)
    throw new Error("Offline inventory exceeds its byte limit");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const path = `/_assets/scanner-offline-${digest}.json`;
  await writeFile(resolve(output, path.slice(1)), bytes);
  document.querySelector(`link[rel="${PORTAL_OFFLINE_INVENTORY_LINK}"]`)?.remove();
  const link = document.createElement("link");
  link.rel = PORTAL_OFFLINE_INVENTORY_LINK;
  link.href = path;
  document.head.append(link);
  await writeFile(portal, dom.serialize());
  return path.slice(1);
}
