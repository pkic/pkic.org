import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createTestHarness, unstable_readConfig as readConfig } from "wrangler";
import { expect, it } from "vitest";

it("bypasses the Worker for published HTML and images while retaining API routing", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "pkic-static-routing-"));
  const assets = resolve(root, "assets");
  for (const route of ["", "about", "join", "events/2026/example", "portal"]) {
    await mkdir(resolve(assets, route), { recursive: true });
    await writeFile(resolve(assets, route, "index.html"), `Published ${route || "home"}`);
  }
  await writeFile(resolve(assets, "sitemap.xml"), "<urlset/>");
  await writeFile(resolve(assets, "robots.txt"), "User-agent: *\nDisallow: /\n");
  await mkdir(resolve(assets, "members", "example"), { recursive: true });
  await mkdir(resolve(assets, "_published", "media"), { recursive: true });
  await writeFile(resolve(assets, "members", "example", "index.html"), "Approved publication");
  await writeFile(resolve(assets, "_published", "media", "example.webp"), "Static image");
  await mkdir(resolve(assets, "_published", "social"), { recursive: true });
  await writeFile(resolve(assets, "_published", "social", "example.jpg"), "Static social card");
  await writeFile(
    resolve(assets, "_headers"),
    "/_published/social/*.jpg\n    Cache-Control: public, max-age=31536000, immutable\n",
  );
  await mkdir(resolve(assets, "news"), { recursive: true });
  await writeFile(resolve(assets, "news", "index.html"), "Published member news");
  await writeFile(resolve(assets, "news", "feed.xml"), "<rss><channel/></rss>");
  await writeFile(
    resolve(assets, "_redirects"),
    "/news/feed/ /news/feed.xml 301\n/og/members/example/og.jpg /_published/social/example.jpg 302\n",
  );
  const main = resolve(root, "worker.mjs");
  await writeFile(main, 'export default { fetch() { return new Response("Worker invoked", { status: 599 }); } };');
  const config = readConfig({ config: resolve("wrangler.jsonc"), env: "local" });
  const server = createTestHarness({
    workers: [
      {
        config: {
          name: "static-publication-test",
          main,
          compatibility_date: config.compatibility_date,
          assets: { ...config.assets, directory: assets },
        },
      },
    ],
  });
  try {
    await server.listen();
    for (const route of [
      "/",
      "/about/",
      "/join/",
      "/events/2026/example/",
      "/portal/",
      "/sitemap.xml",
      "/robots.txt",
    ]) {
      expect((await server.fetch(route)).status, route).toBe(200);
    }
    const page = await server.fetch("/members/example/");
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("Approved publication");
    const image = await server.fetch("/_published/media/example.webp");
    expect(image.status).toBe(200);
    expect(await image.text()).toBe("Static image");
    const social = await server.fetch("/_published/social/example.jpg");
    expect(social.status).toBe(200);
    expect(await social.text()).toBe("Static social card");
    expect(social.headers.get("cache-control")).toContain("immutable");
    const oldSocial = await server.fetch("/og/members/example/og.jpg?v=old-version", { redirect: "manual" });
    expect(oldSocial.status).toBe(302);
    expect(new URL(oldSocial.headers.get("location")!, "https://pkic.org").pathname).toBe(
      "/_published/social/example.jpg",
    );
    const news = await server.fetch("/news/");
    expect(news.status).toBe(200);
    expect(await news.text()).toBe("Published member news");
    const redirect = await server.fetch("/news/feed/", { redirect: "manual" });
    expect(redirect.status).toBe(301);
    expect(new URL(redirect.headers.get("location")!, "https://pkic.org").pathname).toBe("/news/feed.xml");
    const feed = await server.fetch("/news/feed.xml");
    expect(feed.status).toBe(200);
    expect(await feed.text()).toContain("<rss>");
    const api = await server.fetch("/api/v1/auth/session");
    expect(api.status).toBe(599);
    expect(await api.text()).toBe("Worker invoked");
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
