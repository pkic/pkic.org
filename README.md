# pkic.org website

## Test the portal locally

One command gives you a complete local copy of the website and portal with synthetic data. You need Git, Node.js 24 or newer, and pnpm (`corepack enable` provides the version this repository pins).

1. Clone the repository and install its dependencies:

   ```sh
   git clone https://github.com/pkic/pkic.org.git
   cd pkic.org
   pnpm install
   ```

2. Start the local test environment:

   ```sh
   pnpm dev:test
   ```

3. When it prints "Local test environment is ready", open the URLs it shows:
   - the portal at `http://localhost:8788/portal/`
   - the captured email inbox at `http://127.0.0.1:8799/`
4. To sign in, request a sign-in link in the portal for `admin@pkic.org`, the seeded administrator, or for any other address to see what a new visitor sees. Open the captured email inbox and follow the link in the newest message.

The first run takes a few minutes. It creates `.local-test/` (ignored by Git), applies every database migration to a new local database, seeds synthetic data only (the administrator, the sample PQC conference, its forms, and the default email templates), generates local secrets, and publishes the site from that database once. Later runs take under two minutes. You do not need a `.dev.vars` file. All outgoing email goes to the captured inbox; nothing is delivered, and no production data is used. `pnpm dev` runs the same environment.

The server hot-reloads: a change to the Worker applies on the next request, and a change to the portal rebuilds in about a second, so reload the page to see it. Public pages are prerendered once at startup, so restart to see a change to them or to their data.

Press Ctrl+C to stop. Run `pnpm dev:test` again to resume with the same data; new migrations from a pulled branch are applied on start. Options:

- `--build` serves the bundled Worker and the fully built site instead, as they are deployed. Use it to check prerendered pages, bundle size, or a release before a push, not for everyday changes; it rebuilds everything on every start and does not reload.
- `--fast` (with `--build`) builds only what you need to test the portal and the event pages. Pages show original images instead of optimized variants, and social sharing images are omitted. Diagrams render in every mode through the cached build-time renderer; an uncached diagram starts its headless browser.
- `--reset` deletes `.local-test/` and starts over with fresh data.
- `--port <port>` and `--inbox-port <port>` change the app port (8788) and inbox port (8799) when they are in use.
- `--state <directory>` keeps the environment in another directory.
- `--host 0.0.0.0 --base-url http://<machine-ip>:8788` makes the portal and captured inbox reachable from another device on your network. Email links use that base URL.

By default, the environment listens on this computer only. If you already have a `.dev.vars` file, it is loaded too, but the email, sign-in origin, and secret settings above always override it.

`pnpm dev:test` is the local environment for everyone. Operators who are authorized to hold a production database backup can instead rehearse migrations against it with `pnpm dev:rehearsal`; see [CONTRIBUTING.md](CONTRIBUTING.md#rehearse-against-a-database-backup).

## Make and preview changes

You can make simple changes in the GitHub editor. For more advanced changes you might want to run a local copy of the website.

Some basic git knowledge is required, please check https://guides.github.com/ to get started from scratch. An editor such as [Visual Studio Code](https://code.visualstudio.com/) can help you to [simplify most of these tasks](https://code.visualstudio.com/docs/editor/github) and help you with editing the content.

1. Install Node.js 24 or newer and pnpm.
2. [Create a fork](https://guides.github.com/activities/forking/#fork) of this repository
3. [Clone your fork](https://guides.github.com/activities/forking/#clone) and run `pnpm install`
4. Run `pnpm dev` (the [local test environment](#test-the-portal-locally)) and open `http://localhost:8788/` in your browser to preview your local version
5. Make changes until you are satisfied; the Worker and portal reload automatically, public pages after a restart
6. [Commit and push your changes](https://guides.github.com/activities/forking/#making-changes)
7. [Create a pull request](https://guides.github.com/activities/forking/#making-a-pull-request)

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

Remote builds use the PKIC account selected in `wrangler.jsonc` and require Wrangler credentials with access to the target bindings. `CLOUDFLARE_ENV` selects the `local`, `preview`, or `production` publication; Workers Builds select preview for branches and production for `main`. A preview publication builds the production Worker config and reads the shared preview resources declared in its `previews` block. Publication requires no additional database migration or source-write triggers. Deploying application code does not apply D1 migrations.

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

The content lives in `content/` and is written in Markdown because it is a simple content format. We do not allow HTML, to keep content uniform and structured. The Astro publication renders it with the site Markdown processor (`site/markdown-processor.ts`); see the [basic Markdown syntax](https://www.markdownguide.org/basic-syntax/).

Where Markdown falls short, use a content component. Components keep the shortcode syntax the pages were written in, `{{< name key="value" >}}` (or `{{< name >}}…{{< /name >}}` around content), or the equivalent directive form `:::name{key="value"}`. They are not Hugo shortcodes: each name maps to a renderer registered in `functions/_lib/services/site-components.tsx`, and the build fails on a name that has no renderer. Reuse an existing component, such as `figure`, `button`, `alert`, `cards`, or `youtube`, or add a renderer there.

A fenced code block marked `mermaid` is rendered as an SVG [Mermaid](https://mermaid.js.org/) diagram during publication, including hot reload and `--fast`. Readers do not need a Mermaid download or JavaScript to see it.

A paragraph or blockquote ending in `{.callout-info}` or `{.callout-warning}` is shown as a callout:

```md
> **Warning**
> This is an important message
> {.callout-warning}
```

## Update content from other repositories

Some content is managed in external repositories through git submodules, include the remote remote branch in your local preview run the following command.

```bash
git submodule init
git submodule update --remote
```

The update command can be run to update your local copy when the remote branch changes. Submodules are managed in the file .gitmodules.

## Website contributions

Every public page can offer contextual feedback through the same contribution component. `data/content-contributions.yaml` defines the website repository, contribution destinations for externally maintained source trees, and page-specific overrides. Ordinary authored pages edit their actual Markdown source in `pkic/pkic.org`; PKIMM, PQCCM, and other submodule content routes to its owning repository. Custom public URLs do not change the source filename. Generated pages offer feedback without inventing an editable file. Private portal pages omit contribution controls.

The persistent links work without JavaScript. Selecting text adds the wording, nearest section or item, and page link to the feedback. Generic GitHub issues use a prefilled title/body; a configured `feedbackTemplate` can opt a particular source into an existing issue form. PQCMM's YAML feedback form is one such configuration, not the website's default. Known source versions/revisions can be supplied independently of the editing branch; absent provenance is left unspecified.

A branch name never enables publication or contribution routing by itself. Model draft/release publication is separate from this website-wide contribution layer. Contributors describe the change without deciding its release classification. Existing release files and tags are not editing targets; maintainers decide the appropriate draft, maintenance branch, and release milestone.

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

### Model versions and parallel drafts

`data/model-versions.yaml` registers model releases and drafts independently of website contribution routing. A registered draft has a stable `id`, a provisional `version`, its own `root` URL, an editable `branch`, and an exact source `commit` plus SHA-256 digest. The website generates the complete model page structure at build time, verifies the digest and internal version, and labels every draft page as an unreleased proposal. Neither branch creation nor a version number publishes a release. No visitor-side GitHub API requests are needed.

Two drafts can be reviewed side by side, for example `/wg/pqc/pqcmm/versions/drafts/1.1.0/` and `/wg/pqc/pqcmm/versions/drafts/2.1.0/`. Registered alias paths cannot be reused: `/wg/pqc/pqcmm/drafts/2.0.0/` currently redirects to the 1.1.0 draft. A version change is a review decision: preserve the draft id and PR history, update its expected version and source pin, and add the previous overview path to `aliases` if its URL changes. The existing released overview stays the default. Released registry entries remain available when newer drafts or releases are added.

Expected draft versions are provisional. Separating a proposal for review does not determine its release classification: assess whether each change clarifies an existing obligation or introduces a new one before choosing the release version. Record the reason for the change and its compatibility impact separately.

The latest release uses the stable model root and its existing child URLs. Drafts and historical releases show a compact version notice below the section navigation, with a link to the equivalent current page. Draft notices link to the pinned source commit so a review can identify the exact revision; version references in draft pages include the `-draft` suffix. The notice and navigation remain visible together while scrolling; the current release has no notice. Drafts and archives have the same page structure and navigation; changing versions preserves the equivalent page. Adoption and assessment guidance is maintained once in the website and rendered within the selected edition; model criteria, questions, and evidence come from that edition’s pinned YAML. Drafts and archived pages use `noindex, follow`, while the current release remains indexable. Draft aliases stay within the draft namespaces; published editions may retain retired draft URLs as permanent redirects. A draft cannot claim a released-version address. Shared guidance renders without fetching model YAML; only level-detail pages require the pinned model payload.

Released versions have their own readable archive paths, such as `/wg/pqc/pqcmm/versions/1.0.1/`, with the same commit and digest verification as drafts. Preserve released registry entries when adding a newer release; change `defaultVersion` only to a registered release. Version History exposes the complete release history. The shared version menu shows the latest release, the selected historical release, and drafts. Published snapshots and tags are retained; they are never overwritten to apply a correction.

The canonical model repository keeps released model content/version on `main`; independently versioned tooling schemas and profiles can advance there without selecting the next model release. Model and assessment proposals stay on draft branches until release preparation. Website registration follows that distinction: `defaultVersion` remains the approved release pinned to its tagged source, while draft entries pin the proposed content on its own branch. Neither a schema version nor the model repository's moving `main` is used to select a new default automatically.

### Draft updates during website publication

The shared model draft branch is the contribution destination; its single release draft PR compares the accumulated proposal with `main`. The website registry points to that branch, not to individual contribution PRs. Normal website builds resolve registered draft pins into a build snapshot before generating pages. No cross-repository publishing credential, extra update PR, scheduled push, or source-repository release tag is required. A model draft merge does not itself deploy the website; the new revision appears on the next normal website build/deployment.

Only an exact commit with successful push validation in the source repository's `validate.yml` is eligible. Pending or failed validation retains the previous pin. The updater changes only draft commit/digest pins, verifies the rendering contract and the registered model version, and writes the result to an ignored build snapshot rather than modifying the checked-in registry. Released entries, aliases, version labels, branch registrations, and `defaultVersion` are never changed automatically. Invalid content, a changed expected model version, or a source lookup error fails the build rather than publishing unverified content. A version reclassification requires a reviewed registry change. No-op refreshes preserve the registry bytes.

The generated pages carry the exact resolved source revision; visitors never fetch GitHub content. The deployment artifact is the snapshot of that draft revision. To reproduce it, use the source revision and digest recorded in the generated page metadata rather than resolving the moving branch again. Direct `pnpm run build:astro` builds retain the checked-in pins for reproducible local tests; normal `pnpm run build` / preview / production builds run the validated refresh first. Adding a new draft remains an explicit registry review, and released pages stay pinned to their tagged source.

PQCMM version choices use the same working-group model switcher as PKIMM, inside the model navigation’s **Show contents** disclosure. Release/draft selection preserves an equivalent model level and falls back to the version overview where needed. There is no separate version-tabs implementation.
