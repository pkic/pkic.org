import { readdirSync } from "node:fs";
import { extname, resolve } from "node:path";
import { webinarSponsors } from "./webinar-assets.mjs";

const moduleId = "virtual:pkic-content-media";
const resolvedModuleId = `\0${moduleId}`;

function contentMediaPaths(contentRoot, directory = contentRoot, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || entry.name.startsWith("._")) return [];
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return contentMediaPaths(contentRoot, resolve(directory, entry.name), relativePath);
    return extname(entry.name).toLowerCase() === ".md" ? [] : [relativePath];
  });
}

export function contentMediaPlugin(projectRoot) {
  return {
    name: "pkic-content-media",
    resolveId(id) {
      return id === moduleId ? resolvedModuleId : undefined;
    },
    load(id) {
      if (id !== resolvedModuleId) return undefined;
      const paths = contentMediaPaths(resolve(projectRoot, "content")).sort();
      return `export default ${JSON.stringify(paths)}; export const webinarSponsors = ${JSON.stringify(webinarSponsors(projectRoot))};`;
    },
  };
}
