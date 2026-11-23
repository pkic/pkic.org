import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { z } from "zod";
import { portalOfflineAssetPathSchema } from "../../assets/shared/schemas/portal-offline-assets.ts";
import { PORTAL_DEFERRED_STYLES_BUILD_FILE } from "../lib/portal-deferred-styles.mjs";

const deferredStylesSchema = z.strictObject({
  version: z.literal(1),
  stylesheets: z.array(portalOfflineAssetPathSchema.refine((path) => path.endsWith(".css"), "Not a stylesheet")),
});

/** Unlink the stylesheets the portal's lazy sections load on demand, so the shell no longer blocks on them. */
export async function deferPortalRouteStyles(output) {
  const { stylesheets } = deferredStylesSchema.parse(
    JSON.parse(await readFile(resolve(output, PORTAL_DEFERRED_STYLES_BUILD_FILE), "utf8")),
  );
  const deferred = new Set(stylesheets);
  const portal = resolve(output, "portal/index.html");
  const dom = new JSDOM(await readFile(portal, "utf8"));
  // The hot-reloading rehearsal runs the separately built client bundle, which never loads its entry's own
  // CSS, so its shell keeps every linked stylesheet.
  if (dom.window.document.querySelector('#portal-app[data-client-dev="true"]')) return stylesheets;
  for (const link of dom.window.document.querySelectorAll('link[rel~="stylesheet"][href]'))
    if (deferred.has(link.getAttribute("href"))) link.remove();
  await writeFile(portal, dom.serialize());
  return stylesheets;
}
