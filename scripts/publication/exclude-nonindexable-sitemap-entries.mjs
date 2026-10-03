import { JSDOM } from "jsdom";

/** Generated discovery must honor the same robots exclusions as rendered pages. */
export function excludeNonindexableSitemapEntries(xml, paths) {
  const excluded = new Set(paths);
  const dom = new JSDOM(xml, { contentType: "text/xml" });
  try {
    for (const entry of Array.from(dom.window.document.getElementsByTagName("url"))) {
      const location = entry.getElementsByTagName("loc")[0]?.textContent;
      if (location && excluded.has(new URL(location).pathname)) entry.remove();
    }
    return dom.serialize();
  } finally {
    dom.window.close();
  }
}
