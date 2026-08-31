# The PKIC design system

One definition of colour, type, space, shape and motion, consumed by the
portal, the public site, the deck, and every rendered document. This file is
the contract; `assets/design/AGENTS.md` is the short version for anyone
editing tokens.

## Where things live

| Path | What it is |
| --- | --- |
| `assets/design/palette.ts` | Raw brand colours. **No component may read these.** |
| `assets/design/tokens.ts` | The semantic tokens components do read, for both themes. |
| `assets/design/emit-css.ts` | Renders the module as CSS. Shared by the build and the tests. |
| `assets/design/tokens.generated.css` | Generated, committed, drift-checked. |
| `assets/design/base.css` | Element defaults in `@layer base`, scoped to `.pk`. |
| `assets/ts/ui/` | The primitives. One `.tsx` plus one co-located `.css` each. |
| `assets/ts/ui/chart.ts` | SVG chart builders. Emit a hidden data table beside every plot. |
| `assets/ts/ui/preview/` | The live preview at `/design/`. |

## The cascade

```
@layer legacy, tokens, base, components, utilities;
```

Declared once, in the generated token sheet and in the site stylesheet, so the
order holds however the browser interleaves them.

`legacy` contains **everything** authored before this system, Bootstrap
included — `layouts/partials/site-stylesheet.html` wraps the compiled
`main.scss` in it. A layered rule loses to any rule in a later layer no matter
how specific it is, which is the whole point: a design-system component never
has to out-specify Bootstrap's reboot, its element rules, or its utilities.
Nothing in `assets/ts/ui` contains an `!important`, and nothing needs one.

The wrapping happens after Sass compilation, not inside `main.scss`. libsass
scopes functions declared in a nested `@import`, so putting Bootstrap's import
inside an `@layer` block breaks its own `to-rgb()` call.

## The two rules that make it a system

**1. Components read semantic names, never palette names.** A component asks
for `--pk-surface`; the theme decides what that is. This is what lets dark mode
exist without a second set of components.

**2. The accent takes one input.** Set `--pk-accent` to a hue and these derive
from it, differently per theme:

| Token | Use |
| --- | --- |
| `--pk-accent` | Dots, rails, glows, borders, meters |
| `--pk-accent-strong` | A fill that always carries white text |
| `--pk-accent-ink` | Text and icons on a surface |
| `--pk-accent-soft` | A tint behind `--pk-accent-ink` |
| `--pk-grad-tonal` / `--pk-grad-duo` | Derived gradients, never a hand-picked pair |

Thirteen hues are available. There is no per-hue lookup table, and adding one
would be a regression — the derivation is what keeps every hue legible on both
grounds.

**State tones are independent of the accent.** On a green-accented product an
accent-derived "success" makes a primary button and a healthy status
indistinguishable. `--pk-ok`, `--pk-warn`, `--pk-danger` and `--pk-info` are
their own scale and stay that way.

## Delivery

The entry (`assets/ts/loader.ts`) imports the tokens and the base layer, so
they land in one small entry stylesheet that every page links from the head —
currently about 9.5 KiB raw, 2.9 KiB gzip.

Component CSS deliberately does **not** go through the entry. Each component
imports its own file, Vite emits it into that component's lazy chunk, and the
browser fetches it only when the component is actually reached.

## Adding a primitive

`assets/ts/ui/Button.tsx` and `Button.css` are the exemplar; copy them.

- One `.tsx` plus one co-located `.css` that it imports.
- All CSS inside `@layer components`.
- Block `pk-<name>`, element `pk-<name>__<part>`, modifier `pk-<name>--<variant>`.
- Variants typed as string-literal unions, so an invalid variant is a compile
  error rather than a silently unstyled control.
- Variants resolve through **modifier classes**, never an inline `style`
  attribute — the repository forbids those, and a class keeps the definitions
  in the stylesheet with the rest of the component.
- Tests go in `tests/frontend/ui-*.test.tsx` using the raw Preact render
  harness. `@testing-library` is not installed and should not be added.

Test what a visual specimen cannot show: what the control exposes to assistive
technology, and what it does under keyboard.

## Static-first constraints (phase 3)

The endgame in the phase plan is that the same components serve the
authenticated portal client-side and the public pages server-side, rendered by
the application rather than the build. That only stays possible if every
component is written for it from the start — retrofitting it means rewriting
the library.

Four rules, each with a test behind it rather than a promise:

1. **No DOM access during render.** No `window`, `document`, `matchMedia` or
   `localStorage` at module scope or in the render path. Reach for them in an
   effect, which never runs on a server, and guard them even there:
   `matchMedia` is absent in jsdom and in a Worker.
   *Enforced by* `tests/frontend/design-ssr.test.tsx`, which renders every
   primitive in a plain Node environment with no DOM globals at all.

2. **Render purely from typed props.** A component takes its data as
   parameters and fetches nothing. The same component then works with data
   baked in at render time or fetched at runtime, which is what lets a page be
   pre-rendered and hydrated.

3. **Styles are plain CSS files addressable by URL.** No CSS-in-JS, no
   build-coupled styling, and no inline `style` attributes — a server-rendered
   page links the same stylesheets the client does.
   *Enforced by* the SSR suite, which asserts no primitive emits a `style`
   attribute, and by `scripts/check-design-isolation.mjs`.

4. **The accessibility contract survives serialization.** ARIA relationships
   are attributes, not runtime wiring, so they must be present in the markup
   before any JavaScript runs.
   *Enforced by* the SSR suite, which asserts `aria-invalid`,
   `aria-describedby`, `aria-sort` and `<caption>` appear in the rendered
   string.

Interactivity is the one thing that legitimately needs the client: a Menu that
never opens and a Dialog that never traps focus are correct server output. The
markup must be right; the behaviour attaches on hydration.

## Gates

| Command | What it protects |
| --- | --- |
| `pnpm run check:tokens` | The generated CSS matches the module. |
| `pnpm run check:design-isolation` | No Bootstrap classes, no `--bs-*`, no hard-coded colours, type sizes, radii or durations in adopted surfaces. |
| `pnpm run report:bootstrap` | Prints what is left to remove. |

All are wired into `check:static`.

The isolation gate's scope is the list of surfaces that have **adopted** the
system and must stay at zero. A surface joins the list once it is clean, and
can then never regress. It is not a baseline of tolerated violations: the gate
always demands zero for everything in scope.

The gate is deliberately narrow about sizes. A gap or an icon's width is
legitimately local; a type size, a corner radius or a duration is not, because
those are what make separate components look like one system. A gate that
cries wolf gets switched off.

## The layer between the system and the surfaces

`assets/ts/components/` holds a small number of components that every surface
renders and that the design system deliberately does not know about:

- **`Badge`** maps the product's ninety status names onto the system's six
  tones. The system owns what a tone looks like; this owns what `ec_review`
  means.
- **`Table`** translates the portal's column shape and the server's opaque
  sort strings into `ui/DataTable`'s.
- **`ApiDataTable`** is the one server-collection controller: URL-addressed
  search, sort, paging and reload, resolved into one bounded request.
- **`Pager`** translates offsets, which the endpoints take, into page numbers,
  which readers click.
- **`ConfirmDialog`** turns a promise-based `confirmAction()` into a `Dialog`.

These are translations, not second implementations. Anything that is a second
implementation — the old row menu, the old modal, the old chart renderers —
has been deleted rather than kept beside the system's version.

## Removing Bootstrap (phase 5)

`pnpm run report:bootstrap` is the countdown. At the time the system landed:

```
  6642  assets/ts
  1837  layouts
   249  assets/scss
    69  assets/js
  8797  total
```

The route to zero is per-surface, not global. Migrate a surface onto the
primitives, add its path to `scanned` in `scripts/check-design-isolation.mjs`,
and it is held at zero from then on. The portal is the natural first target: it
is a single Hugo shell, so it can drop `main.scss` entirely once its sections
are migrated, and run framework-free while the public layouts are still being
reworked.

Only then does the Hugo Module import leave `go.mod`.

## The preview

`/design/` renders every primitive with live theme, density, radius and accent
controls. It is noindex, unlisted, and never linked from navigation.

The controls write to the document element rather than to a React context,
because that is how a real surface will set them: the portal stamps
`data-theme` and `data-density` on its shell and sets `--pk-accent` from the
group record. If a component needs its own copy of any of those, the component
is wrong.
