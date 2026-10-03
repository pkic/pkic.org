# pkic.org website

## Make and preview changes

You can make simple changes in the GitHub editor. For more advanced changes you might want to run a local copy of the website.

Some basic git knowledge is required, please check https://guides.github.com/ to get started from scratch. An editor such as [Visual Studio Code](https://code.visualstudio.com/) can help you to [simplify most of these tasks](https://code.visualstudio.com/docs/editor/github) and help you with editing the content.

1. Install Node.js 24 or newer and pnpm.
2. [Create a fork](https://guides.github.com/activities/forking/#fork) of this repository
3. [Clone your fork](https://guides.github.com/activities/forking/#clone)
4. Create local worker secrets for Wrangler by copying `.dev.vars.example` to `.dev.vars` and setting at least `INTERNAL_SIGNING_SECRET`. The local rehearsal also loads this file, then overrides its email transport and local identity settings so messages are captured locally instead of delivered.
5. Apply the local database migrations with `pnpm run migrate:local`, then run `pnpm run dev`. Astro publishes member pages from local D1/R2; Vite runs the Cloudflare Worker and the remaining public routes.
6. Open `http://localhost:8788/` in your browser to preview your local version
7. Make changes until you are satisfied; the preview will update automatically
8. [Commit and push your changes](https://guides.github.com/activities/forking/#making-changes)
9. [Create a pull request](https://guides.github.com/activities/forking/#making-a-pull-request)

Backend development, validation, database behavior, and deployment are covered
in [CONTRIBUTING.md](CONTRIBUTING.md).

## Static publication

`pnpm run build` assembles the complete Vite Worker assets and the Astro publication into one deployment. The publication reads approved public data through native D1/R2 bindings. Originals stay in R2; optimized, content-hashed images ship with the static HTML and Pagefind index.

Raster images in published HTML receive static AVIF and WebP variants with width descriptors, responsive sizing, and intrinsic dimensions. Hero images load eagerly with high priority; other images load lazily. Trusted SVGs and authored animations retain their original formats. R2 image variants are generated directly from their source bytes, without exposing private object keys or transforming images during browsing.

Public Open Graph cards are pre-generated as 1200×630 JPEGs using Satori and Sharp. Community, member, working-group, event, webinar, article, author, and general-page variants reuse the page's content and approved publication snapshot. Local logos, photos, leaders, and sponsors are embedded before rendering, so social previews need no API requests or Browser Rendering. White logos receive a dark panel. Long titles scale down within readable limits, then ellipsize if needed; metadata retains the complete title. Private and non-indexed pages receive no card. Previously published `/og/.../og.jpg` URLs receive static redirects to the generated images; the old runtime renderer and Browser Rendering binding are removed.

Card images have immutable content-addressed URLs under `/_published/social/`; `cards.json` records coverage, dimensions, title measurements, truncation, and byte sizes. Images and metadata belong to the same complete release, including clean redeployments and removal of withdrawn pages. Rendering is cached under `node_modules/.astro/publication-social` using content, image bytes, fonts, layout, and dependency revisions; `PKIC_PUBLICATION_SOCIAL_CACHE` can select a persistent local cache directory. The build verifies local image availability and enforces a 700 KB maximum per card.

Image derivatives are cached by source content and encoding policy under `node_modules/.astro/publication-images`, inside the Astro directory retained by Cloudflare Workers Builds when build caching is enabled. `PKIC_PUBLICATION_IMAGE_CACHE` can select a persistent cache for another build runner. A cold or clean build regenerates the derivatives; cached files never substitute for rebuilding the complete release.

Production JavaScript and CSS are minified by Vite, HTML is compressed by Astro, and copied and inline SVGs are optimized by SVGO. SVG optimization preserves accessible titles and descriptions, `viewBox`, and IDs used by gradients, fragment links, styles, or scripts.

Local database changes become visible on published pages after `pnpm run publish:local`. Local R2 must contain any images referenced by the approved data. A synthetic standalone preview is available through `pnpm run test:e2e:astro`; synthetic snapshots are rejected for preview and production builds.

Remote builds use the PKIC account selected in `wrangler.jsonc` and require Wrangler credentials with access to the target bindings. `CLOUDFLARE_ENV` selects `local`, `preview`, or `production`; Workers Builds select preview for branches and production for `main`. Publication requires no additional database migration or source-write triggers. Deploying application code does not apply D1 migrations.

Public content routes, feeds, and discovery files are generated by Astro and served through Cloudflare Static Assets. Vite builds the Worker and interactive application. Automatic publication after database edits and serialized release activation remain separate work.

Member news uses the existing scheduled feed cache and shared public read model. Publications include `/news/`, static pagination, recent news on each member profile, `/news/feed.xml`, and bounded JSON pages under `/_published/news/`. Existing `/news/feed/` addresses redirect to the XML feed. JSON receives a short revalidation cache policy; only content-hashed images receive immutable caching. Feed retrieval and publication remain separate: independent background updates to public objects and conditional feed polling are not yet enabled.

Compare public URL coverage before a migration release with `pnpm exec node scripts/compare-sitemaps.mjs https://pkic.org/sitemap.xml CANDIDATE_SITEMAP_URL REPORT_JSON`. The audit follows child sitemaps, compares paths independently of deployment hosts, and reports missing, added, duplicate, and possibly respelled URLs. Missing URLs remain failures until their preservation, redirects, or intentional removal is verified; encoding and trailing-slash differences are never silently accepted.

## Adding a new member

Applicants use the [membership application](https://pkic.org/join/) and confirm their email. Authorized staff review applications in the portal under **Applications**; approval creates the member and its associated identity. Staff can grant an existing person individual membership from **Members → Grant membership** when the application process does not apply. Manage organization details and logos in the portal under **Organizations**.

Do not create a new `data/members/*.yaml` file or commit a logo to `assets/images/members` for an ongoing member change. Those files are legacy import material for the database cutover.

## Adding a new author

- Keep a post's `authors` and `authorProfiles` front matter accurate. Member and representative records are managed in the portal.
- For authors who are not associated with a member, add a listing in `data/authors.yaml` when the public author catalog needs one.

## Formatting content

The content lives in `content/` and is written as markdown because of it's simple content format. We do not allow the usage of HTML, this to enforce uniform and structured content, but there are times when Markdown falls short. For some of these reusable cases you can use built-in [shortcodes](https://gohugo.io/content-management/shortcodes/) or use/create a custom [shortcode](https://gohugo.io/templates/shortcode-templates/).

- [Basic Markdown Syntax](https://www.markdownguide.org/basic-syntax/)
- [Diagrams](https://gohugo.io/content-management/diagrams/)
  - [GoAT](https://github.com/bep/goat) (rendered on server)
  - [Mermaid](https://mermaid-js.github.io/) (rendered using JavaScript on client)

You can add attributes (e.g. CSS classes) to Markdown blocks, e.g. tables, lists, paragraphs etc.

A blockquote with a CSS class:

```md
> **Warning**
> This is an important message
> {.callout-warning}
```

All [Bootstrap](https://getbootstrap.com/docs/) styles are available, to change the default table style you can use for example the following attributes:

```md
| table header | column |
| ------------ | ------ |
| first row    |        |
| second row   |        |

{.table .table-bordered .table-striped .table-hover}
```

## Update content from other repositories

Some content is managed in external repositories through git submodules, include the remote remote branch in your local preview run the following command.

```bash
git submodule init
git submodule update --remote
```

The update command can be run to update your local copy when the remote branch changes. Submodules are managed in the file .gitmodules.

## Astro static publication audit

The opt-in Astro audit builds the public catalog with a synthetic snapshot and exercises the shared Preact presentation components, static content, discovery, and browser-side Pagefind search. The normal deployment build assembles the Vite Worker and Astro output into one release.

Build with a synthetic public snapshot:

```sh
PKIC_PUBLICATION_SNAPSHOT=tests/fixtures/site-publication.json pnpm run build:astro
node scripts/publication/preview-astro.mjs
```

The output is `dist/astro`. Public browsing reads HTML, media, and Pagefind files without API requests. The portal loads its existing application after a sign-in action or a private hash route. Publication uses the official Astro Preact integration with React compatibility, sitemap and RSS integrations, and image processing through Sharp. Blog and author feeds are generated from the public content catalog; member news uses the publication snapshot.

Run `pnpm run test:e2e:astro` to rebuild with the synthetic snapshot and exercise desktop and mobile browsing, search, sign-in, and reading without JavaScript. The responsive page sweep, theme/layout matrices, and detailed publication audits run only in this opt-in suite. Routine browser CI runs `pnpm run test:e2e:ci`: eleven critical journeys covering magic-link authentication, explicit registration and membership consent, identity selection, proposal submission and speaker invitation, persisted photo uploads, public search, mobile navigation, and read-only authorization. It reuses the prepared synthetic release and performs no extra publication builds. Run `pnpm run test:e2e` on demand for the complete browser suite, such as before a release or when a change affects workflows outside the critical set. Component rendering, draft cancellation, validation, and local UI states stay in frontend Vitest; Worker integration tests cover persistence and domain rules. Both continue to run in routine CI.

Repeated native publication variants run separately with `pnpm run test:e2e:publication`: leadership current/past releases, membership form publication, and rich organization Markdown. The full browser suite still verifies leadership and editor authentication, edits, cancellation, and persistence. The full browser suite retains a real member-directory D1-to-publication journey and publication required by event-creation and waitlist journeys. Component presentation and local interaction assertions belong in the frontend Vitest suite; real viewport geometry, computed contrast, focus, and browser integrations remain browser checks.

Contrast checks are also opt-in so they do not extend the default browser gate. For a quick sweep across representative public layouts in light and dark mode, run `pnpm run test:e2e:contrast`; use `PKIC_CONTRAST_ALL=1 pnpm run test:e2e:contrast` to check every generated page. Both commands rebuild the synthetic publication before testing. To audit an existing current build without rebuilding, run `pnpm exec playwright test --config playwright.contrast.config.ts`.

Publication snapshots must pass the shared public snapshot schema and carry a SHA-256 content fingerprint. The backend snapshot and media services prepare approved public data; the exporter rechecks the public projection and selected media keys before accepting an export. This is an optimistic change check, not a database transaction spanning the build. Publication coordination, selection of a persistent approved snapshot, deployment activation, and final deployed route verification are still required before switching production. No remote migration is part of the Astro build.
