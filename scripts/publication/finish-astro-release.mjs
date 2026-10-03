import { publicationTimings } from "./publication-timings.mjs";
import { sitePublicationReleaseSchema } from "../../assets/shared/schemas/site-publication-release.ts";
import { publicationStagingDirectory } from "./build-context.mjs";
import { cp, readFile, writeFile, access, rm, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { JSDOM } from "jsdom";
import { indexPublicPages } from "./index-public-pages.mjs";
import { publishedNewsPages } from "../../site/news-pages.ts";
import { mkdir } from "node:fs/promises";
import { XMLValidator } from "fast-xml-parser";
import { optimizePublicSvgFiles, publicInlineSvgOptimizer } from "./optimize-public-svg.mjs";
import { publicDownloadPublisher } from "./publish-linked-downloads.mjs";
import { publicSocialCardPublisher } from "./publish-social-cards.mjs";
import { publishAgendaLayout } from "./publish-agenda-layout.mjs";
import { publicDiagramPublisher } from "./publish-diagrams.mjs";
import { excludeNonindexableSitemapEntries } from "./exclude-nonindexable-sitemap-entries.mjs";
import { collectConferenceOutputs, conferenceDisplayRedirects } from "./collect-conference-outputs.mjs";

/** Verify the framework's generated pages before exposing them as a static release. */
export async function finishAstroRelease(output, pages) {
  const timings = publicationTimings();
  console.log(`[publication] post-processing started: ${pages.length} routes`);
  let status = "failed";
  try {
    await finishRelease(output, pages, timings);
    status = "completed";
  } finally {
    timings.report(status);
  }
}

async function finishRelease(output, pages, timings) {
  // Content-addressed originals are only inputs to Astro's image service.
  // Generated variants have a transform suffix; retain those and all other framework assets.
  for (const name of await readdir(resolve(output, "_assets"))) {
    if (/^[a-f0-9]{64}\.(png|jpe?g|webp|avif|gif)$/i.test(name)) await rm(resolve(output, "_assets", name));
  }
  const environment = process.env.CLOUDFLARE_ENV ?? "local";
  const source = process.env.PKIC_PUBLICATION_SNAPSHOT;
  const snapshot = JSON.parse(
    await readFile(source ?? resolve(publicationStagingDirectory(), "snapshot.json"), "utf8"),
  );
  if (!source)
    await cp(resolve(publicationStagingDirectory(), "media", "_published"), resolve(output, "_published"), {
      recursive: true,
    });
  const socialCards = await timings.measure("OG image setup", () => publicSocialCardPublisher(output));
  const diagrams = await timings.measure("diagram setup", () => publicDiagramPublisher(output));
  try {
    const svgFiles = await timings.measure("SVG file optimization", () => optimizePublicSvgFiles(output));
    const optimizeInlineSvg = publicInlineSvgOptimizer();
    const publishDownloads = publicDownloadPublisher(output);
    const downloads = new Set();
    const files = svgFiles.map((file) => relative(output, file).split("\\").join("/"));
    const privatePaths = [];
    const memberData = resolve(output, "_published", "members");
    await mkdir(memberData, { recursive: true });
    await writeFile(
      resolve(memberData, "paths.json"),
      JSON.stringify(Object.fromEntries(snapshot.members.map(({ id, slug }) => [id, { id, slug }]))),
    );
    const newsData = resolve(output, "_published", "news");
    await mkdir(newsData, { recursive: true });
    for (const [index, entry] of publishedNewsPages(snapshot.news).entries()) {
      await writeFile(resolve(newsData, `page-${index + 1}.json`), JSON.stringify(entry.page));
    }
    for (const [index, { pathname }] of pages.entries()) {
      if (index % 250 === 0) console.log(`[publication] processing route ${index + 1}/${pages.length}`);
      const route = pathname.replace(/^\//, "").replace(/\/$/, "");
      const file = pathname.endsWith(".xml")
        ? route
        : route === "404"
          ? "404.html"
          : `${route}/index.html`.replace(/^\//, "");
      try {
        await access(resolve(output, file));
      } catch {
        continue;
      }
      if (pathname.endsWith(".xml")) {
        const xml = await readFile(resolve(output, file), "utf8");
        if (XMLValidator.validate(xml) !== true) throw new Error(`Publication contains invalid XML: ${file}`);
        files.push(file);
        continue;
      }
      const document = await timings.measure(
        "HTML read and parse",
        async () => new JSDOM(await readFile(resolve(output, file), "utf8")),
      );
      try {
        const agendaLayout = await timings.measure("agenda layout", () =>
          publishAgendaLayout(document.window.document, output),
        );
        if (agendaLayout) files.push(agendaLayout);
        await timings.measure("OG images", () => socialCards.publish(document.window.document));
        await timings.measure("diagrams", () => diagrams.publish(document.window.document));
        timings.measureSync("inline SVG optimization", () => optimizeInlineSvg(document.window.document));
        for (const download of await timings.measure("linked downloads", () =>
          publishDownloads(document.window.document, `/${file.replace(/index\.html$/, "")}`),
        ))
          downloads.add(download);
        if (/noindex/.test(document.window.document.querySelector('meta[name="robots"]')?.content ?? ""))
          privatePaths.push(`/${file.replace(/index\.html$/, "")}`);
        for (const element of document.window.document.querySelectorAll("[src], [srcset]")) {
          for (const attribute of ["src", "srcset"]) {
            if (/\/api\//.test(element.getAttribute(attribute) ?? ""))
              throw new Error(`An API media reference remains on ${file}`);
          }
        }
        await timings.measure("HTML serialization and write", () =>
          writeFile(resolve(output, file), document.serialize()),
        );
      } finally {
        document.window.close();
      }
      files.push(file);
    }
    // Astro's page list excludes prerendered endpoint files. Feed directories
    // contain the framework-generated RSS endpoints, including localized terms.
    const taxonomyFeeds = [];
    for (const directory of ["feed", "ms/feed"]) {
      for (const file of await readdir(resolve(output, directory), { recursive: true })) {
        if (file.endsWith(".xml")) taxonomyFeeds.push(`${directory}/${file.split("\\").join("/")}`);
      }
    }
    files.push(...downloads);
    files.push(...(await collectConferenceOutputs(output)));
    files.push(...(await diagrams.finish()));
    files.push(...(await socialCards.finish()));
    for (const feed of [
      ...taxonomyFeeds,
      "news/feed.xml",
      "feed/blog/index.xml",
      "sitemap.xml",
      "en/sitemap.xml",
      "ms/sitemap.xml",
      "sitemap-index.xml",
      "sitemap-0.xml",
    ]) {
      let xml = await readFile(resolve(output, feed), "utf8");
      if (feed === "sitemap-0.xml") {
        xml = excludeNonindexableSitemapEntries(xml, privatePaths);
        await writeFile(resolve(output, feed), xml);
      }
      if (XMLValidator.validate(xml) !== true) throw new Error(`Publication contains invalid XML: ${feed}`);
      if (!files.includes(feed)) files.push(feed);
    }
    await access(resolve(output, "robots.txt"));
    files.push("robots.txt");
    if (!files.some((file) => file.startsWith("members/"))) throw new Error("Publication contains no member pages");
    await timings.measure("Pagefind search", () => indexPublicPages(output));
    await writeFile(
      resolve(output, "publication.json"),
      JSON.stringify(
        sitePublicationReleaseSchema.parse({
          version: 1,
          source: source ? "fixture" : "native",
          snapshotId: snapshot.snapshotId,
          environment,
          files,
          privatePaths,
          redirects: [
            ...conferenceDisplayRedirects(files),
            ...JSON.parse(await readFile(resolve(publicationStagingDirectory(), "redirects.json"), "utf8")),
            ...socialCards.manifest.map(({ route, url }) => ({
              from: `/og/${route.replace(/^\/|\/$/g, "") || "index"}/og.jpg`,
              to: url,
              status: 302,
            })),
          ],
        }),
      ),
    );
    await rm(publicationStagingDirectory(), { recursive: true, force: true });
  } finally {
    await diagrams.finish();
  }
}
