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

/** Bind the exact emitted public module closure to the portal shell before sealing the release.
 * @param {readonly string[]} [deferredStyles] stylesheets the lazy sections load on demand instead of the shell
 */
export async function publishPortalOfflineInventory(output, deferredStyles = []) {
  const portal = resolve(output, "portal/index.html");
  const html = await readFile(portal, "utf8");
  const inventories = await Promise.all(
    [resolve(output, PORTAL_OFFLINE_BUILD_INVENTORY), resolve(output, "js/built", PORTAL_OFFLINE_BUILD_INVENTORY)].map(
      async (path) => portalOfflineInventorySchema.parse(JSON.parse(await readFile(path, "utf8"))),
    ),
  );
  const dom = new JSDOM(html);
  const document = dom.window.document;
  // The offline scanner renders inside lazy portal sections whose styles its own module graph does not
  // import, so it keeps every portal stylesheet: those the shell links and those the sections load on demand.
  const linked = [...document.querySelectorAll('link[rel~="stylesheet"][href]')].map((link) =>
    link.getAttribute("href"),
  );
  const stylesheets = [...linked, ...deferredStyles].map((path) => {
    const href = portalOfflineAssetPathSchema.parse(path);
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
