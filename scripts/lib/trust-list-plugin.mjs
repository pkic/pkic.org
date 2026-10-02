import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Bundles the List of Trust Lists snapshot into the Worker.
 *
 * The snapshot is committed (`data/ltl.json`, refreshed by
 * `scripts/sync-trust-list.mjs`), so a build neither reaches the network nor
 * depends on GitHub being up. A missing or unreadable file yields an empty
 * list, which the page reports rather than failing the build.
 */
const moduleId = "virtual:pkic-trust-list";
const resolvedModuleId = `\0${moduleId}`;

export function trustListPlugin(projectRoot) {
  return {
    name: "pkic-trust-list",
    resolveId(id) {
      return id === moduleId ? resolvedModuleId : undefined;
    },
    load(id) {
      if (id !== resolvedModuleId) return undefined;
      let publishers = [];
      try {
        const parsed = JSON.parse(readFileSync(resolve(projectRoot, "data/ltl.json"), "utf8"));
        if (Array.isArray(parsed?.publishers)) publishers = parsed.publishers;
      } catch {
        this.warn("data/ltl.json is missing or unreadable; the trust-list page will render empty.");
      }
      return `export default ${JSON.stringify(publishers)}`;
    },
  };
}
