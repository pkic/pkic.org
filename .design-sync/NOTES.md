# design-sync notes — PKI Consortium design system

## Repo shape

- Not a published component library. This is a Hugo + Cloudflare Workers app;
  the design system is an in-repo layer with no `dist/` and no build script that
  emits one. The converter runs in synth-entry mode from `srcDir`.
- **The design system is `assets/ts/ui/` + `assets/design/`** — nothing else.
  `assets/ts/components/` is a deliberate *product adapter* layer on top of it
  (status vocabularies, offset↔page translation, the portal's column API). It is
  correctly NOT part of the system and must never be synced: its components
  encode PKI Consortium's words (`ec_review`, `budget_exhausted`), which a
  reusable system cannot own. Each adapter file documents this in its header.
- There is no Storybook. `assets/ts/ui/preview/` (851 lines: `sections-basics`,
  `sections-data`, `sections-overlays`) is the in-repo usage-example surface and
  is the primary source to port authored previews from.

## Preact → React (the load-bearing decision)

The DS is Preact; claude.ai/design renders with React. Verified by probe:

- **Preact vnodes do NOT render in React 19.** `preact/compat` sets
  `$$typeof = Symbol(react.element)`; React 19 expects
  `Symbol(react.transitional.element)` and throws "Objects are not valid as a
  React child". So vendoring preact-as-React is not an option.
- **`class=` DOES work under React 19.** It renders `class="..."` correctly and
  only logs a dev warning ("Invalid DOM property `class`"). The DS's `class=`
  idiom needs no rewriting. Expect that warning in preview consoles — it is
  benign, not a render failure.

Resolution: alias `preact` → React at bundle time via `.design-sync/shim/*.ts`,
wired through `cfg.tsconfig` = `.design-sync/tsconfig.sync.json` (which also
flips `jsxImportSource` from `preact` to `react`). The converter's
`tsconfig-paths` plugin exact-matches non-wildcard `paths` keys, so no lib fork
is needed. Verified end-to-end: 11/11 real `ui/` components server-rendered
through `react-dom/server` with correct classes and ARIA.

`ui/` imports **only** `preact` and `preact/hooks`; no signals, no wouter, no
router. Runtime imports are just `Fragment` (2 files) and `createElement`
(Kicker). Everything else is `import type`, erased by esbuild. All six hooks
used (useState/useEffect/useRef/useCallback/useId/useLayoutEffect) map 1:1.

## Build invocation (this repo is not an installed package)

The DS lives in its own repo, so `<node_modules>/<pkg>` does not exist. Rather
than `--entry` (which also pins the bundle entry and suppresses the
synthesize-from-src path discovery needs), symlink the repo into the staged
scripts' node_modules:

    ln -sfn ../.. .ds-sync/node_modules/pkic-org-events-backend

That one symlink resolves three things at once: `PKG_DIR`, `@types/react`
(found via the `/node_modules/` segment in the path), and `cfg.tokensPkg`
(which only resolves under node_modules, and is how `assets/design/*.css`
reaches the `styles.css` closure).

    node .ds-sync/package-build.mjs --config .design-sync/config.json \
      --node-modules ./.ds-sync/node_modules --out ./ds-bundle
    node .ds-sync/package-validate.mjs ./ds-bundle

- **Any `npm i` inside `.ds-sync/` deletes that symlink** (npm prunes
  node_modules entries it does not own). Recreate it after every install, or the
  next build dies with ENOENT on `pkic-org-events-backend/package.json`.
- `.ds-sync/` needs `react`, `react-dom`, and `playwright@1.62.1` installed on
  top of the skill's `esbuild ts-morph @types/react` — the repo has none of them
  (it is a Preact app). Pin playwright to the repo's version: it resolves
  chromium revision 1234, which is already in the shared browser cache.
- `PLAYWRIGHT_BROWSERS_PATH=/Volumes/ScanDisk/caches/ms-playwright` on this
  machine, so `~/.cache/ms-playwright` is empty and looks like a missing install.

## The .d.ts tree is generated, and it matters more than it looks

`cfg.buildCmd` = `node .design-sync/emit-types.mjs`. **Run it before every
build.** Without it all 36 `<Name>Props` interfaces emit as
`[key: string]: unknown` — and that interface is the contract the design agent
codes against, so an empty one means it never learns `variant`, `tone`, `size`
or `loading` exist and guesses the API on every design it builds.

Why it is needed: the converter's prop extractor only ever loads `.d.ts` files
into its ts-morph project. With no `dist/`, there were none, so every contract
silently degraded to the empty index signature while the build still exited 0.

The script emits declarations from `assets/ts/ui` into `types/` (gitignored)
and then rewrites Preact type references to React ones. **Both halves are
required.** Left as Preact types, the extractor cannot recognize them as DOM
types, so its inherited-prop filter does not fire and each contract is buried
under ~90 leaked HTML attributes — in both `class` and `className` casings,
wrapped in `JSX.SignalLike<>` — plus references to `SignalLike`/`VNode`/
`Booleanish` that the emitted file never imports. After the rewrite each
contract is the component's own props plus `children`/`className`/`id`/`style`.

- **The script fails if tsc emits into `assets/`.** A file outside `rootDir`
  makes tsc report TS6059 and then write that declaration next to its source
  instead of under `outDir` — and because this script deliberately swallows
  tsc's errors, that lands silently. It happened once (three strays under
  `assets/`, untracked but not gitignored, so they would have been committed);
  a stray `.d.ts` beside its `.ts` shadows the real module in
  `tsconfig.frontend.json` resolution and rots as the source moves on. The
  guard is verified by temporarily setting `rootDir` back to
  `../assets/ts/ui`, which reproduces it.
- tsc reports ~200 type errors during this step and that is expected: React's
  JSX types reject the `class=` attribute this DS uses throughout. The errors
  are confined to component bodies, never the exported Props interfaces, and
  tsc emits declarations anyway. The script swallows them deliberately.
- `Checkbox`, `Radio` (both take a shared `ChoiceProps`) and `StateIcon`
  (inline parameter type) have no `<Name>Props` interface to find, so they are
  hand-written in `cfg.dtsPropsFor`. **If their real props change, that config
  goes stale silently** — nothing cross-checks it.

## Fonts

`--pk-font` is "Roboto"; the app serves it from `static/fonts/` with @font-face
rules in `assets/scss/fonts.scss` that use absolute `/fonts/...` URLs Hugo
resolves. Those do not resolve in a bundle, so `.design-sync/fonts.css`
re-declares the same two subsets against the same woff2 files by relative path,
wired via `cfg.extraFonts`. No second copy of the font in the repo.

`--pk-font-mono` names "Roboto Mono", which the repo does not ship — the app
itself falls back to `ui-monospace`. `cfg.runtimeFontPrefixes` suppresses the
`[FONT_MISSING]` warning so the bundle matches production rather than pretending
to a font the product never had.

## Authoring previews — calibration from the first six

Learned by getting Button, Alert, Meter, TextInput, Textarea and RowActions to
grade `good`. Anything authoring the remaining components needs all of it.

- **The utility vocabulary is tiny and easy to invent wrongly.** It is exactly
  `pk-container` (`--narrow`/`--wide`), `pk-stack` (`--tight`/`--snug`/
  `--loose`), `pk-cluster` (`--between`/`--center`/`--start`/`--end`),
  `pk-grid` (`--tight`/`--roomy`), plus `pk-small`, `pk-muted`, `pk-strong`,
  `pk-nowrap`, `pk-center`, `pk-section`, `pk-sr-only`. There are **no gap
  classes** — `pk-row`, `pk-gap-sm` and `pk-wrap` were all invented on the
  first attempt and silently did nothing. Spacing is tuned by setting the
  `--pk-gap` custom property, or by a `pk-stack--*` modifier.
- **Wrap every preview cell in `class="pk"`.** `.pk` is the root scope in
  `base.css` that carries the DS font and color; outside it a card renders in
  browser defaults and looks unstyled.
- **Write `class`, not `className`.** The components destructure `class` (the
  Preact idiom the source is written in). `className` lands in `...rest` and is
  spread onto the DOM node instead, so it fights the component's own classes.
  Note the emitted `.d.ts` advertises `className` — that comes from the
  converter's keep-list, not from the component. See `conventions.md`.
- **Check the real prop names against the emitted `.d.ts` before writing.**
  `PersonCell` takes `email`, not `secondaryLine`; guessing cost a rebuild.
- **`Meter`'s `label` is the accessible name only** — it paints nothing. Pair
  each meter with its own visible label or the preview teaches an unlabeled bar.
- **Pick the `pk-stack` gap deliberately.** `--tight` (`--pk-1`) is only right
  for items carrying their own background or border (stacked `Alert`s,
  `PersonCell` rows in one panel body). Two `Panel`s at `--tight` abut into what
  reads as a single surface, and two `EmptyState`s read as one state with a
  stray extra title. Use plain `pk-stack` (`--pk-4`) for sibling Panels and
  anything where the gap is the only separator; `--loose` (`--pk-5`) for
  untinted, unbordered blocks. This hit six of nine files in one batch.
- **A small primitive swept over `sm/md/lg` needs a visible size caption.**
  `Avatar` and `Spinner` sizes differ by a few pixels; a bare row reads as
  identical circles and fails the Plausible test even though the markup is
  right. Pair each with a `pk-muted pk-small` caption naming the size.
- **Components that only exist inside a parent must be previewed there.**
  `RowActions` is a table row's trailing cell; alone in a card it is a stray
  `⋯` glyph. Composed with `PersonCell` in a `pk-cluster--between` row it reads
  correctly.

## Per-component quirks found while authoring

- **`StateIcon` has no intrinsic size and no color of its own.** It renders a
  bare `<svg viewBox="0 0 16 16">` with no width/height and takes no `style`
  prop, so standalone it falls back to the SVG default box; its color comes only
  from a `pk-field--ok|advisory|invalid` ancestor. It must be given a DS sizing
  class (`pk-field__message-icon`, 0.9rem, or `pk-field__state`, 1.05rem and
  absolutely positioned) inside the real `pk-field` composition. A bare instance
  renders grey and mis-sized.
- **`Select`'s disabled variant drops the custom chevron** — the component's own
  styling, not a preview defect.
- **`FileInput`'s `placeholder` renders in muted ink.** Using it to stand in for
  an already-stored filename reads correctly but shows that filename at
  placeholder contrast.
- **`Meter`'s `label` is an accessible name only** (see the authoring section).

## Overlays: harness artifacts and the open-state pattern

- **`Dialog` and `Menu` carry `cardMode: "single"` in `cfg.overrides`** and must
  keep it. In the default grid card, three open `<dialog>`s stack in the browser
  top layer over one shared backdrop (only the last is visible), and `Menu`'s
  `position: fixed` popup is clipped by each grid cell's `overflow: hidden`.
  These knobs are excluded from the grade key, so setting them never invalidates
  a grade.
- **`Menu` has no `open` prop** — open state is internal `useState`. Its preview
  wraps each cell in a small `Opened` component that `.click()`s
  `.pk-menu__trigger` once on mount, so the sheet shows the real popup through
  the real code path. `ServerSearchSelect` and `UserPicker` share that popup
  policy (see `assets/ts/ui/popup-placement.ts`) and will need the same
  treatment if they are ever synced. If the DS grows a `defaultOpen` prop,
  switch these previews to it.
- **A fixed-position popup measures against the CARD, not the viewport.**
  `emit.mjs` wraps a single-story render in `.ds-single { transform:
  translateZ(0) }`, which makes that element the containing block for
  `position: fixed` descendants. A trigger pinned to the card's right edge gets
  a shrink-to-fit popup squeezed to ~130px with wrapped labels — something the
  product never renders. Compose anchored-popup previews so the trigger sits
  well inside the card (e.g. within `pk-grid pk-grid--roomy`). `showModal()`
  dialogs are unaffected: the top layer ignores the ancestor transform.

## Findings for the design-system owner (not sync problems)

Surfaced while authoring previews; both are in the DS itself, not the sync.

- **`.pk-stat-card--link:hover { border-color: var(--pk-accent) }` is a dead
  rule.** `.pk-stat-card` is only `display:flex; flex-direction:column` and
  never draws a border, so the hover affordance on a linked stat card is
  invisible. A linked card is also pixel-identical to an unlinked one
  (`.pk-stat-card__link` is `color: inherit; text-decoration: none`), so `href`
  paints nothing. Worth a look in `assets/ts/ui/StatCard.css`.
- **The emitted `DataTable.d.ts` drops the generic** — the interface is
  `DataTableProps<Row>` but the contract declares `ComponentType<DataTableProps>`,
  so `<DataTable<Row>>` is unwritable against the emitted types. Same family as
  the `class`/`className` artifact. Annotate the row type on each `cell`/`rowKey`
  callback instead. If this becomes painful, `cfg.dtsPropsFor.DataTable` can
  carry a hand-written body.
- **`pk-table-list` is the canonical list frame** and lives in
  `assets/ts/ui/DataTable.css`, not `utilities.css` — so a utility-vocabulary
  scan of `utilities.css` alone misses it. It is what makes `Toolbar`,
  `BulkBar`, `DataTable` and `Pager` compose into one bordered band. Now
  documented in `conventions.md`.

## The record-page basis (added from the "Member profile" design)

`templates/member-profile/` in the Claude Design project is the reference. It
was implemented as three shared `ui/` components plus four variants of existing
ones, rather than as page markup, so the organization record and every other
subject page compose the same parts:

- **`ProfileHeader`** — the identity block. Subject-agnostic on purpose: a
  person or an organization, `media` taking an `Avatar` or a logo tile. It is
  NOT a variant of `PageHeader`; that names a *place* in the portal, this names
  the *subject a record is about*. The trail stays a separate `Breadcrumb` so
  the header carries no navigation.
  **`headingLevel` defaults to 2**, matching `PageHeader` — the portal shell
  owns the page's `<h1>`. Defaulting it to 1 broke
  `tests/frontend/portal-system-users.test.tsx`, which asserts the record's
  name is an `<h2>`; that test is right and guards the document outline.
- **`AffiliationRow`** — one tie between subjects, read from either side
  (organizations of a person, people of an organization). `past` is the whole
  ended-tie treatment: dimmed, mark desaturated, dates left to say when.
- **`ExpandFooter`** — the "+N" control across a panel's foot.

Variants added to existing components rather than hand-rolled on the page,
because the design expressed each with inline styles that duplicated something
the system already had:

- `Meter` gained `size="sm"` (in-cell: fixed track, figure beside it).
- `Chip` gained `count` and `strength` (a quantized five-step tint — **not** an
  inline `color-mix`, matching `Meter`'s `data-fill` ladder; this system keeps
  magnitude in the stylesheet).
- `Avatar` gained `status` (ring + label; `neutral` is the past tense of
  `accent`) and size `xl` (5.75rem, the portrait size a header needs).
- `StatCard` gained `density="compact"`, which uses `column-reverse` rather
  than reordered markup so the tile is announced label-then-value at both
  densities.

Applied to the contact view in
`assets/ts/member-flows/portal/sections/system-users/UserDetail.tsx`. The same
header is what an organization record should adopt next.

**`check:design-isolation` rejected `font-size: 0.7rem`** copied from the
design's inline styles — design-system CSS reads tokens only. Expect that gate
to catch any value carried over verbatim from a `.dc.html` template.

## Known render warns

- `Meter` `ok` and `accent` tones both render green — the brand accent *is*
  green. A legitimate "variants render identically" case, not a bug.
- Several primitives are genuinely small (`Kicker`, `Badge`, `Avatar`,
  `StateIcon`); `[RENDER_THIN]` on them before a preview is authored is
  expected.

## Known gaps

- Five style-only primitives ship CSS with no component: `Chart`, `Content`,
  `OverlayEditor`, `Table`, `ThemeToggle`. Server-rendered Hugo markup writes
  those class names. A design agent cannot use a bare stylesheet — these need
  either thin components or an explicit class contract in `conventions.md`.

## Roboto Mono: resolved — the project matches production

Claude Design reported "Roboto Mono missing" (because `--pk-font-mono` names
it) and 16 `fonts/RobotoMono-*.ttf` were uploaded into the project by hand.
**They have been deleted, deliberately.**

The repo does not ship Roboto Mono either — production falls back to
`ui-monospace`. Serving it only inside Claude Design would make designs render
monospace text the live site never shows, which is the exact divergence this
sync exists to prevent, pointing the wrong way. `cfg.runtimeFontPrefixes`
keeps `[FONT_MISSING]` suppressed for that family, so the warning is expected
and correct: the family is intentionally not shipped.

The usage is narrow — `--pk-font-mono` appears only in `assets/design/base.css`,
`assets/ts/ui/Content.css` and `assets/ts/ui/OverlayEditor.css` (code and prose).

**If Roboto Mono is ever genuinely wanted**, adopt it properly: add one variable
`.woff2` under `static/fonts/`, add an `@font-face` to `.design-sync/fonts.css`,
and drop the `runtimeFontPrefixes` entry — so the site and Claude Design agree.
Do not re-upload static `.ttf` files into the project: they bypass the repo, get
deleted by the next reconciliation, and the DS ships `woff2` everywhere else
(both Roboto subsets together are ~72KB).

## Re-sync risks

- The shims mirror React's hook/element API by hand. If `ui/` starts using a
  Preact API with no React equivalent (`useErrorBoundary`, `toChildArray`,
  `options`, or `@preact/signals`), the shim silently fails to export it and the
  bundle breaks at build time. Re-check `ui/`'s non-relative imports each sync.
- `cfg.srcDir` pins `assets/ts/ui`. A new primitive added elsewhere is invisible
  to the sync.
- No `dist/` means `.d.ts` contracts come from source via ts-morph against
  *Preact* types (`ComponentChildren`, `JSX.*`). Watch for `[DTS_PARSE]`; the
  fix is `cfg.dtsPropsFor.<Name>`.
- **Files added to the project by hand do not survive.** The close-out
  reconciliation deletes anything under `components/`, `_preview/`, `tokens/`,
  `fonts/`, `_vendor/` or `guidelines/` that the build does not produce. Assets
  the design system needs must enter through the repo and config (e.g.
  `cfg.extraFonts`), never by uploading into the project.
- **The four preview batches were authored by parallel subagents.** Their
  learnings are folded into this file and their learnings files deleted; the
  previews themselves are committed under `.design-sync/previews/` and carry
  forward at zero cost as long as they and the preview-affecting config are
  unchanged. The final capture printed `carried forward` for all 36 with zero
  `grade cleared`, which is the proof the next sync is fast.
- **Grades live only in the uploaded `_ds_sync.json`**, not in git. If that
  anchor is lost or the project is recreated, all 36 components re-verify.
