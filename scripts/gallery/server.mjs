import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { preactAlias, preactEsbuild } from "../lib/preact-vite.mjs";

export const GALLERY_PORT = 8796;

/** Start the component gallery: the design-system preview with fixture data, served by Vite alone. */
export function startGallery({ port = GALLERY_PORT, host = "127.0.0.1" } = {}) {
  return createServer({
    configFile: false,
    root: fileURLToPath(new URL(".", import.meta.url)),
    // The tokens name fonts by site path (`/fonts/...`); serve them from the static tree.
    publicDir: fileURLToPath(new URL("../../static", import.meta.url)),
    clearScreen: false,
    resolve: { alias: preactAlias },
    esbuild: preactEsbuild,
    server: { host, port, strictPort: true },
  }).then((server) => server.listen());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startGallery();
  server.printUrls();
  console.log("Open one pattern alone with ?only=<id>, e.g. /?only=reaction-picker");
}
