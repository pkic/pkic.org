import { SELF } from "cloudflare:test";
import { publicPageImages } from "./helpers/public-page-images";
import { describe, expect, it } from "vitest";
import {
  contentPathToRoute,
  loadSiteContent,
  parseFrontMatter,
  publishedSiteRoutes,
  siteContentComponentAudit,
  siteMapEntries,
  siteNavigation,
  siteRedirectEntries,
} from "../functions/_lib/services/site-content";
import { compileContentIgnorePatterns, contentSourceIsIncluded } from "../functions/_lib/services/site-markdown";
import { siteContentSlug } from "../assets/shared/site-content-slug";
import { renderContentMarkdown } from "../functions/_lib/services/site-components";
import fixturePublication from "./fixtures/site-publication.json";
import { sitePublicationSnapshotSchema } from "../assets/shared/schemas/site-publication";

describe("Vite public-site rendering", () => {
  it("preserves authored donation columns and sticky sizing", async () => {
    const content = await loadSiteContent("/donate/");
    expect(content?.html).toContain('class="content-row"');
    expect(content?.html).toContain('class="content-col content-col--lg-7"');
    expect(content?.html).toContain('class="content-col content-col--lg-5 content-col--sticky"');
    expect(content?.html).toContain("data-donation-form");
    expect(content?.html).not.toContain("pk-content-component--columns");
    expect(content?.html).toMatch(/class="content-row">\s*<div class="content-col/);
    expect(content?.html).not.toMatch(/<p>\s*<div class="content-col/);
  });
  it("renders an explicitly published database event through the existing registration template", async () => {
    const content = await loadSiteContent("/events/2026/static-publication-workshop/register/", {
      publication: sitePublicationSnapshotSchema.parse(fixturePublication),
    });
    expect(content?.html).toContain("data-event-registration");
    expect(content?.title).toBe("Event registration — Static publication workshop (synthetic)");
    expect(content?.robots).toContain("noindex");
    expect(
      await loadSiteContent("/events/2026/unpublished-private-event/register/", {
        publication: sitePublicationSnapshotSchema.parse(fixturePublication),
      }),
    ).toBeNull();
  });
  it("preserves localized archives and keeps their listings in the selected language", async () => {
    const routes = siteMapEntries().map(({ route }) => route);
    for (const route of [
      "/ms/",
      "/ms/blog/",
      "/ms/authors/",
      "/ms/authors/pki-consortium/",
      "/ms/series/",
      "/ms/tags/",
      "/ms/tags/asean/",
      "/ms/tags/conference/",
      "/ms/tags/kuala-lumpur/",
      "/ms/tags/post-quantum-cryptography/",
      "/ms/tags/pqc/",
    ]) {
      expect(routes).toContain(route);
      expect(await loadSiteContent(route)).not.toBeNull();
    }
    const blog = await loadSiteContent("/ms/blog/");
    for (const taxonomy of ["authors", "tags", "series"])
      expect(blog?.hero?.descriptionHtml).toContain(`href="/ms/${taxonomy}/"`);
    expect(blog?.listing?.items).toHaveLength(2);
    for (const item of blog?.listing?.items ?? []) expect(item.href).toMatch(/^\/ms\//);
    const author = await loadSiteContent("/ms/authors/pki-consortium/");
    expect(author?.taxonomy?.posts).toHaveLength(2);
    for (const post of author?.taxonomy?.posts ?? []) expect(post.href).toMatch(/^\/ms\//);
  });

  it("publishes every taxonomy page linked by pagination", async () => {
    const routes = new Set(siteMapEntries().map(({ route }) => route));
    const first = await loadSiteContent("/tags/ssl/tls/");
    expect(first?.taxonomy?.pageCount).toBeGreaterThan(1);
    for (let page = 2; page <= (first?.taxonomy?.pageCount ?? 1); page++) {
      const route = `/tags/ssl/tls/page/${page}/`;
      expect(routes.has(route)).toBe(true);
      expect((await loadSiteContent(route))?.taxonomy?.page).toBe(page);
    }
  });

  it("includes both complete code of conduct documents in the membership agreement", async () => {
    const join = await loadSiteContent("/join/");
    for (const route of ["/code-of-conduct/participants/", "/code-of-conduct/publications/"]) {
      const document = await loadSiteContent(route);
      expect(document).not.toBeNull();
      expect(join?.html).toContain(document!.html);
    }
  });

  it("preserves Hugo taxonomy paths in browser links", () => {
    expect(siteContentSlug("TLS 1.2")).toBe("tls-1.2");
    expect(siteContentSlug("It's Time for S/MIME")).toBe("its-time-for-s/mime");
  });

  it("inserts component HTML without interpreting dollar replacement patterns", async () => {
    const html = await renderContentMarkdown(':::alert{type="warning"}\nPrices: $$ and $&.\n:::', {
      assetUrl: (name) => `/content-media/test/${name}`,
      assetUrls: () => [],
      data: {},
      eventData: undefined,
      listing: () => ({ heading: "Test", items: [], page: 1, pageCount: 1 }),
      route: "/test/",
      sourcePath: "content/test.md",
    });
    expect(html).toContain("$$");
    expect(html).toMatch(/\$(?:&amp;|&#x26;)/);
  });

  it("keeps explicitly unpublished source documentation out of pages and discovery", async () => {
    const hidden = [
      "/wg/pkimm/extensions/README/",
      "/wg/pkimm/integrations/README/",
      "/wg/pkimm/extensions/templates/",
      "/wg/pkimm/model/categories/templates/",
      "/wg/pkimm/model/release-notes/templates/",
    ];
    const routes = publishedSiteRoutes();
    const sitemap = siteMapEntries().map((entry) => entry.route);
    for (const route of hidden) {
      expect(routes).not.toContain(route);
      expect(sitemap).not.toContain(route);
      expect(await loadSiteContent(route)).toBeNull();
      expect((await SELF.fetch(`https://pkic.org${route}`)).status).toBe(404);
    }
    expect(await loadSiteContent("/portal/")).not.toBeNull();
  });

  it("preserves ordinary and dated blog routes", () => {
    expect(contentPathToRoute("/repo/content/about/_index.md")).toBe("/about/");
    expect(contentPathToRoute("/repo/content/privacy.md")).toBe("/privacy/");
    expect(contentPathToRoute("/repo/content/blog/2026/2026-09-03-vite-migration.md")).toBe(
      "/2026/09/03/vite-migration/",
    );
    expect(
      contentPathToRoute("/repo/content/blog/2026/post/index.md", {
        date: "2026-06-14T12:00:00+02:00",
        title: "Defining 'Quantum-Ready' for the Supply Chain",
      }),
    ).toBe("/2026/06/14/defining-quantum-ready-for-the-supply-chain/");
  });

  it("parses front matter without changing the Markdown body", () => {
    const page = parseFrontMatter("---\ntitle: Test page\ndraft: false\n---\n\nBody **text**.\n");
    expect(page.data).toMatchObject({ title: "Test page", draft: false });
    expect(page.body.trim()).toBe("Body **text**.");
  });

  it("applies configured content exclusions to hidden and instruction files", () => {
    const patterns = compileContentIgnorePatterns([
      "^\\.",
      "/\\.",
      "(^|/)(AGENTS|CLAUDE|CODEX|COPILOT|GEMINI|PROMPTS)\\.md$",
    ]);
    expect(contentSourceIsIncluded("content/about/_index.md", patterns)).toBe(true);
    expect(contentSourceIsIncluded("content/.drafts/page.md", patterns)).toBe(false);
    expect(contentSourceIsIncluded("content/about/.draft.md", patterns)).toBe(false);
    expect(contentSourceIsIncluded("content/wg/AGENTS.md", patterns)).toBe(false);
    expect(contentSourceIsIncluded("content/CLAUDE.md", patterns)).toBe(false);
    expect(contentSourceIsIncluded("content/wg/CODEX.md", patterns)).toBe(false);
    expect(contentSourceIsIncluded("content/wg/GEMINI.md", patterns)).toBe(false);
  });

  it("registers every content call found in the initialized Markdown catalog", () => {
    const audit = siteContentComponentAudit();
    expect(audit.discovered).toContain("figure");
    expect(audit.discovered).toContain("event-registration");
    expect(audit.unresolved).toEqual([]);
  });

  it("renders new Markdown directives through SSR-safe Preact components", async () => {
    const html = await renderContentMarkdown(
      ':::alert{type="warning"}\nThis is **important**.\n:::\n\n::figure{src="diagram.svg" alt="Diagram"}',
      {
        assetUrl: (name) => `/content-media/test/${name}`,
        assetUrls: () => [],
        data: {},
        eventData: undefined,
        listing: (_kind) => ({ heading: "Test", items: [], page: 1, pageCount: 1 }),
        route: "/test/",
        sourcePath: "content/test.md",
      },
    );
    expect(html).toContain("pk-alert--warn");
    expect(html).toContain("<strong>important</strong>");
    expect(html).toContain('src="/content-media/test/diagram.svg"');
    expect(html).not.toContain(":::alert");
  });

  it("server-renders the home page through shared Preact components", async () => {
    const response = await SELF.fetch("https://app.test/");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toMatch(/<!doctype html>/i);
    expect(response.headers.get("content-security-policy")).toContain("default-src");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(html).toContain("Public Key Infrastructure Consortium");
    // The published navigation: the bar, its mega panels and the search overlay.
    expect(html).toContain("pkic-navbar");
    expect(html).toContain('id="pkic-wg-mega"');
    expect(html).toContain('id="pkic-members-mega"');
    expect(html).toContain('id="pkicSearchPanel"');
    expect(html).toContain("pkic-home-hero");
    expect(html).toContain("pkic-hero-post-card");
    expect(html).toContain("pkic-wg-spotlight");
    expect(html).toContain("pkic-wg-spotlight--pkimm");
    expect(html).toContain("pkic-wg-spotlight-icon");
    expect(html).toContain("support-cta-inner");
    expect(html.indexOf("support-cta-stat")).toBeLessThan(html.indexOf("support-cta-heading"));
    expect(html).not.toContain("pkic-wg-spotlight--ca");
    expect(html).not.toContain("pk-home-announcement");
    expect(html).toContain("Latest from the Blog");
    // The events band on the home page, with its heading and its cards.
    expect(html).toContain("event-card-badge");
    expect(html).toContain("Post-Quantum Cryptography (PQC)");
    expect(html).toContain("Governance");
    expect(html).not.toContain('data-component="working-groups"');
    expect(html).not.toContain("Loading content");
    expect(html).not.toContain("{{&lt;");
  });

  it("generates the main and footer menu hierarchy from migration metadata", () => {
    const navigation = siteNavigation();

    expect(navigation.main.map((item) => item.label)).toEqual([
      "Working Groups",
      "Members",
      "Events",
      "Blog",
      "Sponsors",
      "About us",
    ]);
    expect(navigation.main[0].children.map((item) => item.label)).toEqual([
      "Post-Quantum Cryptography (PQC)",
      "Cryptographic Module (CM)",
      "PKI Maturity Model (PKIMM)",
      "Training and Certification (TC)",
      "CA Working Group",
      "CBOM Profiles",
    ]);
    expect(navigation.main[0].children[4].children).toMatchObject([
      { href: "/wg/ca/ltl/", label: "List of Trust Lists" },
    ]);
    expect(navigation.footer.map((item) => item.label)).toEqual(["Consortium", "Governance", "Resources"]);
    expect(navigation.footer[2].children.at(-1)).toMatchObject({
      external: true,
      href: "https://github.com/orgs/pkic/discussions",
      label: "Discussions",
    });
  });

  it("serves the portal as a private hydration island", async () => {
    const response = await SELF.fetch("https://pkic.org/portal/");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(html).toContain('id="portal-app"');
    expect(html).toContain('class="pk-login__card"');
    expect(html).toContain("The work behind trusted digital assets happens here.");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow, noarchive"');
    expect(html).not.toContain("Loading content");
  });

  it("renders authored event-flow pages as private Vite hydration islands", async () => {
    const response = await SELF.fetch("https://app.test/events/2026/pqc-conference-amsterdam-nl/register/");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(html).toContain('data-module="event-flows/registration-page"');
  });

  it("renders the self-assessment shortcode as a real browser island", async () => {
    const response = await SELF.fetch("https://app.test/wg/pkimm/assessment/");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('data-module="site/self-assessment"');
    expect(html).toContain("data-self-assessment");
    expect(html).toContain('data-version="v2.0.0"');
    expect(response.headers.get("content-security-policy")).not.toContain("pkic.github.io");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
  });

  it("server-renders legacy carousel calls as token-styled Preact galleries", async () => {
    const response = await SELF.fetch("https://app.test/2025/01/30/key-takeaways-of-the-pqc-conference-in-austin/");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("pk-content-gallery");
    const photographs = await publicPageImages(html, ".pk-content-gallery img");
    expect(photographs.length).toBeGreaterThan(1);
    expect(photographs.every((image) => image.src.startsWith("/_assets/") && image.srcset.includes("640w"))).toBe(true);
    expect(html).not.toContain('data-component="photo-gallery"');
  });

  it("server-renders inherited event data through the accessible agenda component", async () => {
    const response = await SELF.fetch("https://app.test/events/2026/pqc-conference-amsterdam-nl/agenda/");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("pk-content-agenda");
    expect(html).toContain('data-module="site/agenda"');
    expect(html).toContain("pk-content-agenda__tabs");
    expect(html).toContain("pk-content-agenda__filter-controls");
    expect(html).toContain("data-agenda-location-trigger");
    expect(html).toContain(">Red hall<");
    expect(html).toContain("105 min");
    expect(html).toContain('data-local-time-format="time"');
    const portraits = await publicPageImages(html, ".pk-content-agenda__speaker .pk-avatar__img");
    expect(portraits.length).toBeGreaterThan(0);
    expect(portraits[0]?.src).toMatch(/^\/_assets\//);
    // Published portraits are bounded renditions chosen by width, never the stored upload.
    const portraitWidths = [...portraits[0]!.srcset.matchAll(/ (\d+)w\b/g)].map(([, width]) => Number(width));
    expect(portraitWidths.length).toBeGreaterThan(0);
    expect(Math.max(...portraitWidths)).toBeLessThanOrEqual(384);
    expect((await SELF.fetch(`https://app.test${portraits[0]!.src}`)).status).toBe(200);
    // Profile dialogs and the Speakers tab hold published portraits until they are shown.
    expect(html).toMatch(/data-deferred-src="\/_assets\//);
    expect(html).not.toMatch(/data-deferred-src(?:set)?="\/api\//);
    const [hero] = await publicPageImages(html, ".pkic-hero-media__image");
    expect(hero?.src).toMatch(/^\/_assets\/.*\.webp$/);
    expect((await SELF.fetch(`https://app.test${hero!.src}`)).status).toBe(200);
    expect(html).toContain('class="pk pk-section-navigation"');
    expect(html).toContain("Post-Quantum Security of IPsec / IKEv2");
    expect(html).not.toContain('data-component="agenda"');
    expect(html).not.toContain("{.callout-warning}");
  });

  it("renders the trust list into the page rather than fetching it in the browser", async () => {
    const response = await SELF.fetch("https://app.test/wg/ca/ltl/");
    const html = await response.text();

    expect(response.status).toBe(200);
    // The directory itself, from the snapshot the build bundled: GitHub
    // refuses the cross-origin read the old island attempted, and the site's
    // own CSP would refuse it too.
    expect(html).toContain("Improve information for");
    expect(html).not.toContain("data-list-of-trust-lists");
    expect(html).not.toContain("The current list is not available");
  });

  it("serves the published member-news page instead of an endless placeholder", async () => {
    const response = await SELF.fetch("https://app.test/news/");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Synthetic member news");
    expect(html).not.toContain("Loading member news");
  });

  it("generates an XML sitemap containing only canonical indexable URLs", async () => {
    const entries = siteMapEntries();
    expect(entries.length).toBeGreaterThan(200);
    expect(entries.some((entry) => entry.route === "/blog/page/2/")).toBe(true);
    expect(entries.some((entry) => entry.route === "/tags/pqc/")).toBe(true);
    expect(entries.some((entry) => entry.route === "/portal/")).toBe(false);
    expect(entries.some((entry) => entry.route === "/design/")).toBe(false);

    const indexResponse = await SELF.fetch("https://app.test/sitemap.xml");
    const indexXml = await indexResponse.text();
    expect(indexResponse.status).toBe(200);
    expect(indexResponse.headers.get("content-type")).toContain("application/xml");
    expect(indexXml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(indexXml).toContain("<loc>https://pkic.org/en/sitemap.xml</loc>");
    expect(indexXml).toContain("<loc>https://pkic.org/ms/sitemap.xml</loc>");

    const response = await SELF.fetch("https://app.test/en/sitemap.xml");
    const xml = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("public");
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<loc>https://pkic.org/blog/</loc>");
    expect(xml).not.toContain("https://pkic.org/portal/");
    expect(xml).not.toContain("https://pkic.org/resources/");

    const malayResponse = await SELF.fetch("https://app.test/ms/sitemap.xml");
    expect(await malayResponse.text()).toContain("https://pkic.org/ms/2025/");
  });

  it("keeps local publication robots independent of the request hostname", async () => {
    const production = await SELF.fetch("https://pkic.org/robots.txt");
    // The fixture is a local release; its indexing policy is fixed at publication time.
    expect(await production.text()).toBe("User-agent: *\nDisallow: /\n");

    const preview = await SELF.fetch("https://app.test/robots.txt");
    expect(await preview.text()).toBe("User-agent: *\nDisallow: /\n");
  });

  it("keeps the generated blog feed and its legacy redirects available", async () => {
    const response = await SELF.fetch("https://app.test/feed/blog/");
    const xml = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/rss+xml");
    expect(xml).toContain("PKI Consortium Launches the CBOM Profiles Working Group");
    expect(xml).toContain("https://pkic.org/2026/06/08/pki-consortium-launches-the-cbom-profiles-working-group/");

    const redirect = await SELF.fetch("https://app.test/blog/feed/", { redirect: "manual" });
    expect(redirect.status).toBe(301);
    expect(new URL(redirect.headers.get("location")!, "https://app.test").toString()).toBe(
      "https://app.test/feed/blog/index.xml",
    );
  });

  it("serves complete author, nested-tag and localized taxonomy RSS through native assets", async () => {
    for (const path of [
      "/feed/authors/bruce-morton/index.xml",
      "/feed/tags/ca/browser-forum/index.xml",
      "/ms/feed/tags/pqc/index.xml",
    ]) {
      const response = await SELF.fetch(`https://app.test${path}`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-type"), path).toContain("application/rss+xml");
      const xml = await response.text();
      expect(xml, path).toContain("<rss");
      if (path.includes("bruce-morton")) expect((xml.match(/<item>/g) ?? []).length).toBe(30);
      if (path.startsWith("/ms/")) expect(xml).toContain("<language>ms</language>");
    }
  });

  it("keeps the migrated public directories reachable through their existing routes", async () => {
    for (const path of ["/about/", "/events/", "/members/", "/wg/"]) {
      const response = await SELF.fetch(`https://app.test${path}`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-type"), path).toContain("text/html");
    }
  });

  it("renders internal navigation destinations instead of emitting dead links", async () => {
    const descendants = (items: ReturnType<typeof siteNavigation>["main"]): typeof items =>
      items.flatMap((item) => [item, ...descendants(item.children)]);
    const navigation = siteNavigation();
    const hrefs = descendants([...navigation.main, ...navigation.footer])
      .map((item) => item.href)
      .filter((href): href is string => Boolean(href?.startsWith("/")));

    for (const href of hrefs) {
      const response = await SELF.fetch(`https://app.test${href}`, { redirect: "manual" });
      expect([200, 301, 302, 308], href).toContain(response.status);
    }
  });

  it("renders the blog index from the complete Markdown catalog", async () => {
    const response = await SELF.fetch("https://app.test/blog/");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("pkic-page-hero--blog");
    expect(html).toContain("blog-card");
    const cards = await publicPageImages(html, ".blog-card img");
    expect(cards.some((image) => /Quantum-Ready/.test(image.alt) && image.srcset.includes("640w"))).toBe(true);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("PKI Consortium Launches the CBOM Profiles Working Group");
    expect(html).toContain("/2026/06/08/pki-consortium-launches-the-cbom-profiles-working-group/");
    expect(html.match(/class="blog-card"/g)).toHaveLength(10);
    expect(html).toContain("blog-author-avatars-bubbles");
    expect(html).toContain("blog-author-avatars-names");
    expect(html).toContain("pk-pager__button");
  });

  it("renders a themed public hero and shared prose treatment", async () => {
    const response = await SELF.fetch("https://app.test/about/");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("pkic-page-hero--about");
    expect(html).toContain('id="content"');
    expect(html).toContain("About the PKI Consortium");
    expect(html).toContain("pk-figure-aside");
    expect(html).not.toContain('data-module="member-flows/leadership-widget"');
  });

  it.each([
    ["chair only", ["role-group_lead"]],
    ["vice chair only", ["role-group_deputy_lead"]],
    ["chair and vice chair", ["role-group_lead", "role-group_deputy_lead"]],
    ["no current leaders", []],
  ])("publishes About leadership with %s", async (_description, roles) => {
    const publication = sitePublicationSnapshotSchema.parse(fixturePublication);
    const forum = publication.groups.pkic!;
    const assignments = [...forum.leadership];
    forum.leadership = assignments.filter((leader) => roles.includes(leader.roleId));

    const content = await loadSiteContent("/about/", { publication });
    expect(content?.html).toContain("Chair and Vice Chair");
    for (const leader of assignments) {
      if (roles.includes(leader.roleId)) expect(content?.html).toContain(leader.person.name);
      else expect(content?.html).not.toContain(leader.person.name);
    }
    expect(content?.html).not.toContain('data-module="member-flows/leadership-widget"');
  });

  it.each(["all-members", "missing"])(
    "rejects publication when the About group is %s instead of pkic",
    async (slug) => {
      const publication = sitePublicationSnapshotSchema.parse(fixturePublication);
      const forum = publication.groups.pkic!;
      delete publication.groups.pkic;
      if (slug !== "missing") {
        forum.group.slug = slug;
        publication.groups[slug] = forum;
      }

      await expect(loadSiteContent("/about/", { publication })).rejects.toThrow(
        /Leadership group "pkic" referenced in .*about\/_index\.md \(\/about\/\) is missing from the publication snapshot/,
      );
    },
  );

  it("renders structured YAML components without exposing migration syntax", async () => {
    const response = await SELF.fetch("https://app.test/events/2026/pqc-conference-amsterdam-nl/sponsors/");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("stat-grid");
    // Bento changes tile presentation while retaining the shared card-row layout.
    expect(html).toContain("pkic-card-bento");
    expect(html).toContain("bento-title");
    expect(html).toContain("pk-content-callout--warning");
    expect(html).not.toContain("{.callout-warning}");
    expect(html).not.toContain("{{&lt;");
  });

  it("keeps the navigation search destination functional and private from indexing", async () => {
    const response = await SELF.fetch("https://app.test/search/?q=quantum+ready");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(html).toContain("Use the search field in the navigation bar");
    expect(html).toContain('id="pkicSearchResults"');
  });

  it("renders published pages outside the former migration allowlist", async () => {
    const routes = publishedSiteRoutes();
    expect(routes.length).toBeGreaterThan(200);
    expect(new Set(routes).size).toBe(routes.length);
    const response = await SELF.fetch("https://app.test/bylaws/");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("substantial consensus");
  });

  it("builds every working-group sub-page from its group index", async () => {
    const sections = ["focus", "deliverables", "members", "resources", "blog"];
    for (const section of sections) {
      const page = await loadSiteContent(`/wg/pqc/${section}/`);
      expect(page?.workingGroup?.section).toBe(section);
      expect(page?.workingGroup?.wgId).toBe("PQC");
      expect(page?.workingGroup?.accent).toBe("blue");
      // At most one tab is current. A group whose deliverables have pages of
      // their own gets those tabs instead of a Deliverables tab, so that one
      // sub-page is reachable without being a tab — as it was under Hugo.
      const current = page?.workingGroup?.nav.filter((item) => item.current) ?? [];
      expect(current.length).toBeLessThanOrEqual(1);
      if (section !== "deliverables") expect(current).toHaveLength(1);
    }

    const focus = await loadSiteContent("/wg/pqc/focus/");
    expect(focus?.workingGroup?.cards.length).toBeGreaterThan(0);
    expect(focus?.workingGroup?.cards[0]?.title).toBeTruthy();

    const resources = await loadSiteContent("/wg/pqc/resources/");
    expect(resources?.workingGroup?.cards.every((card) => card.href)).toBe(true);

    // A group that declares no resources gets no Resources tab.
    const withoutResources = await loadSiteContent("/wg/cbom/focus/");
    const labels = withoutResources?.workingGroup?.nav.map((item) => item.label) ?? [];
    expect(labels).toContain("Members");
    expect(labels).toContain("Blog");
  });

  it("preserves content redirects and aliases", async () => {
    const discussion = await SELF.fetch("https://app.test/discussions/", { redirect: "manual" });
    expect(discussion.status).toBe(301);
    expect(discussion.headers.get("location")).toBe("https://github.com/orgs/pkic/discussions");

    const alias = await SELF.fetch("https://app.test/resources/", { redirect: "manual" });
    expect(alias.status).toBe(301);
    expect(new URL(alias.headers.get("location")!, "https://app.test").toString()).toBe("https://app.test/");

    const relativeAlias = await SELF.fetch("https://app.test/call", { redirect: "manual" });
    expect(relativeAlias.status).toBe(301);
    expect(new URL(relativeAlias.headers.get("location")!, "https://app.test").toString()).toBe(
      "https://app.test/events/2026/pqc-conference-amsterdam-nl/propose/",
    );

    expect(siteRedirectEntries().some((entry) => entry.from === "/call/")).toBe(true);
  });

  it("redirects a canonical content path to its trailing-slash form", async () => {
    const response = await SELF.fetch("https://app.test/about?source=test", { redirect: "manual" });
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!, "https://app.test").toString()).toBe(
      "https://app.test/about/?source=test",
    );
  });

  it("renders dated blog articles at their Hugo-compatible permalink", async () => {
    const response = await SELF.fetch(
      "https://app.test/2026/06/08/pki-consortium-launches-the-cbom-profiles-working-group/",
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Cryptographic Bill of Materials");
  });

  it("bylines a post from its own front matter and thanks sponsors through the shared D1 display", async () => {
    const response = await SELF.fetch("https://app.test/2013/03/21/ietf-86-web-pki-working-group/");
    const html = await response.text();

    expect(response.status).toBe(200);
    // The affiliation recorded in the post, not a lookup in today's directory.
    const source = await loadSiteContent("/2013/03/21/ietf-86-web-pki-working-group/");
    expect(source?.blog?.authors.some((author) => author.headshot === "/images/members/entrust/bruce-morton.jpg")).toBe(
      true,
    );
    const [portrait] = await publicPageImages(html, ".blog-author-card .pk-avatar__img");
    expect(portrait?.src).toMatch(/^\/_assets\/.*\.webp$/);
    expect((await SELF.fetch(`https://app.test${portrait!.src}`)).status).toBe(200);
    expect(html).toContain("/images/members/entrust/entrust.svg");
    // Profile links use the shared link vocabulary rather than a card of their own.
    expect(html).toContain("pk-link-list");
    expect(html).not.toContain('data-module="member-flows/sponsors-wall"');
    expect(html).not.toContain("blog-sidebar-tier");
  });

  it("lays a working group's introduction beside its leadership and separates Join from Back", async () => {
    const landing = await (await SELF.fetch("https://app.test/wg/pkimm/")).text();
    expect(landing).toContain('class="wg-intro-layout"');

    const focus = await (await SELF.fetch("https://app.test/wg/pkimm/focus/")).text();
    expect(focus).toMatch(/class="[^"]*\bwg-page-actions\b/);
  });

  it("returns a rendered not-found page for an unknown route", async () => {
    const response = await SELF.fetch("https://app.test/not-a-real-page/");
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("Page not found");
  });
});
