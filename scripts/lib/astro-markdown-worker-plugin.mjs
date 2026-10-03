/**
 * Astro's Unified processor imports its workerd Prism loader even when
 * syntaxHighlight is false. The Astro Cloudflare adapter normally supplies
 * this binding; our standalone Worker uses @cloudflare/vite-plugin instead.
 * No Prism languages are configured for this site's Markdown processor.
 */
export function astroMarkdownWorkerPlugin() {
  const id = "virtual:astro-cloudflare:prism";
  const resolved = `\0${id}`;
  return {
    name: "pkic-astro-markdown-worker",
    resolveId(source) {
      return source === id ? resolved : undefined;
    },
    load(source) {
      return source === resolved ? "export const bundledLanguages = {};" : undefined;
    },
  };
}
