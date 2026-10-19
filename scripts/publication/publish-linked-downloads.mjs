import { boundDocumentRedirect, validateDocumentRoutes } from "./collect-document-redirects.mjs";
import { legacyDownloadAliasPublisher } from "./publish-legacy-download-aliases.mjs";
import { stat, copyFile, mkdir } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";

/** Preserve authored bundle download URLs while publishing only referenced static files. */
export function publicDownloadPublisher(output, documentRoutes) {
  if (documentRoutes) validateDocumentRoutes(documentRoutes);
  const published = new Set();
  const root = resolve(output);
  const publishAliases = legacyDownloadAliasPublisher(output, documentRoutes);
  return async (document, route) => {
    const references = [...document.querySelectorAll("a[href]")].map((link) => ({
      href: link.getAttribute("href"),
      required: false,
    }));
    for (const assessment of document.querySelectorAll("[data-self-assessment]")) {
      for (const attribute of ["data-data-url", "data-config-url"]) {
        const href = assessment.getAttribute(attribute);
        if (href) references.push({ href, required: true });
      }
    }
    for (const { href, required } of references) {
      // External references and fragment navigation do not address a local bundle.
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) continue;
      const url = new URL(href, `https://pkic.org${route}`);
      if (url.origin !== "https://pkic.org" || !/\.[a-z0-9]+$/i.test(url.pathname)) continue;
      if (boundDocumentRedirect(documentRoutes, url.pathname)) continue;
      if (boundDocumentRedirect(documentRoutes, `/content-media${url.pathname}`)) continue;
      const path = decodeURIComponent(url.pathname).replace(/^\//, "");
      const destination = resolve(root, path);
      if (!destination.startsWith(`${root}${sep}`)) throw new Error("Download escapes the release directory");
      try {
        await stat(destination);
        continue;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const source = resolve(root, "content-media", path);
      if (!source.startsWith(`${resolve(root, "content-media")}${sep}`))
        throw new Error("Download escapes the content bundle");
      try {
        if (!(await stat(source)).isFile()) throw new Error(`Publication dependency is not a file: ${path}`);
      } catch (error) {
        if (error.code === "ENOENT" && !required) continue;
        throw error;
      }
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination);
      published.add(path);
    }
    for (const alias of await publishAliases(document, route)) published.add(alias);
    return [...published];
  };
}
