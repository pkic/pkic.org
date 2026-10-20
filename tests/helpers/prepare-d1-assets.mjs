import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

// Wrangler supplies the asset binding and routing, but D1/service tests must
// not depend on a checkout's public/ or pay for a real site publication.
let directory;
export function prepareD1AssetsDirectory() {
  if (!directory) {
    directory = mkdtempSync(join(tmpdir(), "pkic-d1-assets-"));
    process.once("exit", () => rmSync(directory, { recursive: true, force: true }));
  }
  return directory;
}
