import { buildBylines } from "./bylines.mjs";

/** Bundles every page's byline into the Worker, keyed the way it names a document. */
const moduleId = "virtual:pkic-bylines";
const resolvedModuleId = `\0${moduleId}`;

export function bylinesPlugin(projectRoot) {
  return {
    name: "pkic-bylines",
    resolveId(id) {
      return id === moduleId ? resolvedModuleId : undefined;
    },
    load(id) {
      if (id !== resolvedModuleId) return undefined;
      // `images` is the copy instruction for `prepare-public.mjs`; the page only needs the bylines.
      return `export const bylines = ${JSON.stringify(buildBylines(projectRoot).bylines)};`;
    },
  };
}
