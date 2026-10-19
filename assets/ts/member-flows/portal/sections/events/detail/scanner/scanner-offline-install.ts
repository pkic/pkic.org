import {
  PORTAL_OFFLINE_INVENTORY_MAX_BYTES,
  PORTAL_OFFLINE_INVENTORY_LINK,
  portalOfflineInventoryPathSchema,
  portalOfflineInventorySchema,
} from "../../../../../../../shared/schemas/portal-offline-assets";

/** Only the build's content-addressed public inventory can extend the offline shell. */
export async function scannerOfflineAssets(html: string): Promise<string[]> {
  const links = [
    ...html.matchAll(new RegExp(`<link rel="${PORTAL_OFFLINE_INVENTORY_LINK}" href="([^"]+)"[^>]*>`, "g")),
  ];
  if (links.length !== 1) throw new Error("Scanner offline inventory is unavailable");
  const path = portalOfflineInventoryPathSchema.parse(links[0]![1]);
  const response = await fetch(path, { credentials: "omit" });
  if (!response.ok || Number(response.headers.get("content-length") ?? 0) > PORTAL_OFFLINE_INVENTORY_MAX_BYTES)
    throw new Error("Scanner offline inventory could not be prepared");
  if (!response.body) throw new Error("Scanner offline inventory is empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > PORTAL_OFFLINE_INVENTORY_MAX_BYTES) {
        await reader.cancel();
        throw new Error("Scanner offline inventory is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (path !== `/_assets/scanner-offline-${hash}.json`) throw new Error("Scanner offline inventory digest differs");
  const inventory = portalOfflineInventorySchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  const shell = [...html.matchAll(/(?:src|href)="((?:\/js\/built\/|\/_assets\/)[^"?#]+\.(?:js|css))"/g)].map(
    (match) => match[1]!,
  );
  if (!shell.length || shell.some((entry) => !inventory.assets.includes(entry)))
    throw new Error("Scanner offline inventory does not own this shell");
  const scripts = [...html.matchAll(/<script[^>]*src="((?:\/js\/built\/|\/_assets\/)[^"?#]+\.js)"/g)].map(
    (match) => match[1]!,
  );
  if (!scripts.length || scripts.some((entry) => !inventory.entrypoints.includes(entry)))
    throw new Error("Scanner offline entrypoint differs from its inventory");
  return inventory.assets;
}
