/** Stable local entry points; immutable dependencies keep open tabs consistent across rebuilds. */
export function frontendOutputFiles(isDev) {
  return {
    // Astro’s local portal shell imports this stable bootstrap; its dependencies remain hashed.
    entryFileNames: isDev
      ? (chunk) => (chunk.name === "portalPage" ? "chunks/portal-page.js" : "[name].js")
      : "[name].[hash].js",
    chunkFileNames: "chunks/[name].[hash].js",
    assetFileNames: "[name].[hash][extname]",
  };
}
