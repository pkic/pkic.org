/** Build-only list of the portal stylesheets that its lazy sections load themselves. */
export const PORTAL_DEFERRED_STYLES_BUILD_FILE = "portal-deferred-styles-build.json";

const portalScript = "/site/pages/portal/index.astro";
const sourceId = (id) => (id ?? "").replaceAll("\\", "/").split("?")[0];

/**
 * Astro links the CSS of every module the portal script reaches, including through `import()`, so the
 * page blocked on every section's styles. Vite already loads a lazy chunk's CSS before that chunk runs,
 * so only the CSS of the script's static imports must be linked; the server-rendered shell keeps its own.
 */
export function portalDeferredStyles(bundle, prefix) {
  const chunks = Object.entries(bundle).filter(([, chunk]) => chunk.type === "chunk");
  const entries = chunks
    .filter(([, chunk]) => sourceId(chunk.facadeModuleId).endsWith(portalScript))
    .map(([file]) => file);
  if (!entries.length) return null;
  const closure = (starts, edges) => {
    const seen = new Set(),
      queue = [...starts];
    while (queue.length) {
      const file = queue.pop();
      if (seen.has(file)) continue;
      const chunk = bundle[file];
      if (!chunk) throw new Error(`Portal chunk is absent from the emitted bundle: ${file}`);
      seen.add(file);
      if (chunk.type === "chunk") queue.push(...edges(chunk));
    }
    return seen;
  };
  const css = (files) => new Set([...files].flatMap((file) => [...(bundle[file].viteMetadata?.importedCss ?? [])]));
  const eager = closure(entries, (chunk) => chunk.imports ?? []);
  const lazy = closure(
    [...eager].flatMap((file) => bundle[file].dynamicImports ?? []),
    (chunk) => [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])],
  );
  const linked = css(eager);
  return [...css(lazy)]
    .filter((file) => !linked.has(file))
    .map((file) => prefix + file)
    .sort();
}

export function portalDeferredStylesPlugin(prefix) {
  return {
    name: "pkic-portal-deferred-styles",
    apply: "build",
    applyToEnvironment(environment) {
      return environment.name === "client";
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const stylesheets = portalDeferredStyles(bundle, prefix);
        if (stylesheets)
          this.emitFile({
            type: "asset",
            fileName: PORTAL_DEFERRED_STYLES_BUILD_FILE,
            source: JSON.stringify({ version: 1, stylesheets }),
          });
      },
    },
  };
}
