import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { clientAssetManifestSchema } from "../assets/shared/schemas/client-assets";

// The standalone frontend build owns lazy module and stylesheet loading.
export const clientAssets = clientAssetManifestSchema.parse(
  JSON.parse(await readFile(resolve("public/js/built/manifest.json"), "utf8")),
);
