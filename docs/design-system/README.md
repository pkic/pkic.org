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
| `pnpm run check:field-structure` | Every field part sits inside the element that styles it. |
| `pnpm run report:bootstrap` | Prints what is left to remove. |
| `pnpm run report:field-structure` | Prints field-structure violations without failing. |

All are wired into `check:static`.

The isolation gate's scope is the list of surfaces that have **adopted** the
system and must stay at zero. A surface joins the list once it is clean, and
can then never regress. It is not a baseline of tolerated violations: the gate
always demands zero for everything in scope.

The field-structure gate exists because a surface can pass every other check
and still not use the system. A `pk-field__label` or `pk-field__message` that
is not inside a `pk-field` is a part with no whole: the state modifiers set
`--state-*` on the field, so a loose label and message can be styled but can
never show the tick, the caution or the cross. Every form on the site was in
that condition — the classes were right and the nesting was not.

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

## Bootstrap is gone

`pnpm run report:bootstrap` reads zero. It started at:

```
  6642  assets/ts
  1837  layouts
   249  assets/scss
    69  assets/js
  8797  total
```

and the true figure was higher — the first detector missed about a thousand
references, and later ones missed classes assigned at runtime, built as
strings, or composed across template interpolation. Each gap was closed as it
was found, and each is documented in the gate itself.

`go.mod` no longer requires `hugo-mod-bootstrap-scss`, `main.scss` imports no
Bootstrap, and the compiled stylesheet went from 596 KiB raw / 81 KiB gzip to
305 / 47 — a little under half. The budget in
`scripts/lib/frontend-bundle-budget.mjs` came down with it, so the space does
not quietly fill back up.

What replaced it is in `assets/design` (tokens, base, utilities) and
`assets/ts/ui` (the primitives), delivered as described under **Delivery**
above. `scripts/check-design-isolation.mjs` holds every migrated surface at
zero and can never let one regress.

### Keeping it gone

The gate is the guarantee, and it is worth knowing what it actually checks,
because most of what it catches now is not a class in a `class=` attribute:

- a Bootstrap class assigned at runtime (`className =`, `classList.add`)
- a `pk-` class no stylesheet defines — a name that reads perfectly and
  renders nothing
- a class name composed across Hugo interpolation, where `{{ }}` splits the
  token
- an inline `style` attribute
- a colour, type size, corner radius or duration written as a literal in CSS

`scripts/adopt-design-surfaces.mjs` is how a surface joins that scope. It runs
the real gate against the candidate and refuses anything that is not already
at zero, so the list can never become a list of intentions.

## Seeing it

Three checks look at a rendered page, because the gates above read source and
source cannot tell you that a page scrolls sideways.

| Command | What it looks at |
| --- | --- |
| `pnpm exec playwright test design-system-responsive` | `/design/` — every primitive at 375, 768 and 1280, in both themes and both densities |
| `pnpm exec playwright test portal-responsive` | five portal screens, signed in, at the same three widths |

Both assert the same three things, and each is a defect this repository has
actually shipped: nothing pushes the page sideways, nothing is operable by
mouse only, and every table, control and region has a name.

They earned their place immediately. Between them they found a table's
visually hidden header spans escaping their scroll container and stretching
the document 222px; every default-size Avatar rendering as a 300-pixel circle,
because the component emits a size modifier only for its non-default variants
and the base class read a custom property nothing defined; and — after
Bootstrap came out — an 8-to-24-pixel sideways scroll on every portal page at
every width, because Bootstrap's reboot had been supplying
`box-sizing: border-box` for the whole document and the design system's reset
was scoped to `.pk`. None of the three is visible in source.

## The preview

`/design/` renders every primitive with live theme, density, radius and accent
controls. It is noindex, unlisted, and never linked from navigation.

The controls write to the document element rather than to a React context,
because that is how a real surface will set them: the portal stamps
`data-theme` and `data-density` on its shell and sets `--pk-accent` from the
group record. If a component needs its own copy of any of those, the component
is wrong.
