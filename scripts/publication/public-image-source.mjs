import { resolve, sep } from "node:path";

/** Resolve published local imagery without permitting network or API lookups. */
export function publicImageFile(source, output, { allowSvg = false } = {}) {
  const url = new URL(source, "https://pkic.org");
  if (url.origin !== "https://pkic.org") return null;
  const file = resolve(output, `.${decodeURIComponent(url.pathname)}`);
  if (!file.startsWith(`${resolve(output)}${sep}`) || /\/api\//.test(url.pathname))
    throw new Error(`Public image is outside the static publication: ${source}`);
  if (!/\.(png|jpe?g|webp|avif|gif)$/i.test(url.pathname) && !(allowSvg && /\.svg$/i.test(url.pathname))) return null;
  return file;
}
