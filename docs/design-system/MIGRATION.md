# Migrating a surface off Bootstrap

Phase 5. The route to zero is per-surface: migrate a surface, add it to the
gate's scope, and it can never regress. There is no big-bang step and no
moment where the site is half-converted globally.

## Migrate the shared components first

The fastest route to zero is not the heaviest file. It is the handful of
components that every surface renders:

| Component | Surfaces that render it |
| --- | --- |
| `components/ErrorAlert` | 71 |
| `components/Spinner` | 56 |
| `components/Badge` | 53 |
| `components/ConfirmDialog` | 49 |
| `components/ApiDataTable` | 45 |
| `components/EmptyState` | 17 |
| `components/Tabs` | 15 |
| `components/Pager` | 12 |

Rewriting one of those internals converts every one of its consumers without
touching a single call site. All of the above except `EmptyState` and `Tabs`
are done; each took one small file and removed hundreds of references.

Three of them are not duplicates of a design-system primitive and should not
be deleted, because they own something the system cannot:

- `components/Badge` owns the product's status vocabulary — ninety statuses
  mapped to six tones. A `Badge` that knew what `ec_review` means could not be
  reused anywhere else.
- `components/Table` translates the portal's column API and the server's
  opaque sort strings (`created_desc`) into the design system's shape.
- `components/ApiDataTable` is the server-collection controller: URL-addressed
  list state, paging, search and sort, resolved into one bounded request.

## Plan against the real distribution

```bash
pnpm run report:bootstrap                              # by directory
node scripts/check-design-isolation.mjs --by-file      # by file, ranked
```

The work is very unevenly spread — at the time of writing, 317 files hold
8,797 references and the 25 heaviest carry 31% of them. Take whole surfaces,
heaviest first, rather than sweeping alphabetically.

## The one rule that is easy to get wrong

**Component CSS ships in lazy chunks, so class names are not globally
available.** `pk-alert` is only styled on a page that has imported `Alert` (or
its stylesheet). This is deliberate — it is what keeps a page from downloading
CSS for components it never renders — but it means:

- A **Preact surface** gets the styles automatically by importing the
  component: `import { Alert } from "../ui/Alert"`.
- A **vanilla-JS or Hugo surface** that writes the class names into markup must
  import the stylesheet itself:
  ```js
  import "../ts/ui/Alert.css";
  ```
  Vite then emits that CSS into the importing module's chunk.

A migration that swaps class names without doing this produces unstyled markup
that looks fine in review — because Bootstrap is still loaded on the page —
and breaks the moment the surface drops `main.scss`.

**Hugo templates are the exception.** A server-rendered page linked from the
head cannot wait for a lazy chunk without flashing unstyled content, so the
primitives whose class names appear in Hugo markup ship with the entry
stylesheet instead: currently `Button`, `Badge` and `Field` (which carries
`pk-input` and the checkbox, radio and validation styles). Anything outside
that list — `pk-panel`, `pk-alert`, `pk-table` — must not be written into a
Hugo template, because its CSS will not be there. Keep the list short and add
to it only when a layout genuinely needs the class.

## Class mapping

Bootstrap on the left, the design system on the right. Where the right-hand
column names a component, prefer the component over the class: it carries the
accessibility contract with it.

| Bootstrap | Use instead |
| --- | --- |
| `btn`, `btn-primary`, `btn-secondary`, `btn-link` | `Button` with `variant` |
| `btn-danger`, `btn-outline-danger` | `Button variant="danger"` / `"danger-quiet"` |
| `btn-sm`, `btn-lg` | `Button size="sm"` / `"lg"` |
| `spinner-border` | `Spinner` |
| `card`, `card-body`, `card-title` | `Panel`, `PanelBody`, `PanelHeader` |
| `alert`, `alert-danger`, `alert-warning` | `Alert` with `tone` |
| `badge`, `text-bg-*` | `Badge` with `tone` |
| `table`, `table-striped`, `table-hover` | `DataTable` |
| `form-control`, `form-select` | `TextInput`, `Textarea`, `Select` inside a `Field` |
| `form-label`, `form-text`, `invalid-feedback` | `Field`'s `label`, `help`, `message` |
| `is-invalid`, `is-valid` | `Field`'s `state` (`invalid` / `ok` / `advisory`) |
| `form-check`, `form-check-input` | the checkbox and radio styles in `Field.css` |
| `nav`, `nav-tabs`, `nav-link` | `Tabs` |
| `breadcrumb` | `Breadcrumb` |
| `pagination`, `page-item` | `Pager` |
| `dropdown`, `dropdown-menu` | `Menu` |
| `modal`, `modal-dialog` | `Dialog` |
| `toast` | `Toast` |
| `progress`, `progress-bar` | `Meter` |
| `visually-hidden` | `pk-sr-only`, or the pattern already in the primitives |
| `form-check`, `form-check-input`, `form-check-label` | `pk-check` **and** `pk-check__input` **and** `pk-check__label` — all three |
| `<tr onClick>` | `rowAction` on the table, never a handler on the row |
| a chart's colours | `assets/ts/ui/chart.ts`, which reads tokens |
| `row`, `col-*`, `g-*` | CSS grid or flex on the surface, with `--pk-*` gaps |
| `d-flex`, `justify-content-*`, `align-items-*` | plain flex declarations |
| `mb-*`, `mt-*`, `p-*` | `gap` on the parent, using `--pk-1` … `--pk-8` |
| `text-muted` | `color: var(--pk-ink-muted)` |
| `text-primary` | `color: var(--pk-accent-ink)` |
| `fw-bold`, `small`, `lead` | `font-weight` / `font-size` from the type scale |
| `--bs-*` custom properties | the matching `--pk-*` token |

Spacing utilities have no direct equivalent on purpose. `mb-3` on twelve
elements is twelve chances to disagree; a `gap` on their parent is one
decision. Migrating a surface is the moment to make that swap.

## Procedure

1. **Read the surface** and list what it actually needs. Most files use far
   fewer distinct patterns than their reference count suggests.
2. **Replace components first**, utilities second. A `card` that becomes a
   `Panel` takes a dozen utility classes with it.
3. **Wrap the surface's root in `.pk`** so the base layer applies. Without it
   the surface still inherits Bootstrap's reboot for bare elements.
4. **Import any CSS you reference by class name** (see the rule above).
5. **Run the gates** — `pnpm run check:static` — and the surface's own tests.
6. **Check it in a browser at 375, 768 and 1280.** The gate cannot see layout.
7. **Add the path to `scanned`** in `scripts/check-design-isolation.mjs`. The
   gate now demands zero for it forever.
8. **Only when every surface on a page is migrated**, give the page a shell
   that omits `main.scss`. `layouts/design/baseof.html` is the worked example.

## Order of attack

The portal first. It is a single Hugo shell, so once its sections are
migrated it can take its own stylesheet and run framework-free while the
public layouts are still on Bootstrap — the early, low-risk exit.

Public layouts follow, then `assets/scss` shrinks as the partials it holds stop
being referenced. `go.mod` loses the Hugo Module last, once
`report:bootstrap` reads zero.

## Classes that JavaScript owns

Some classes are not styling — they are state that a script toggles. Replacing
one of those in the template without changing the script silently breaks the
surface, and nothing in the build or the test suite will say so.

This happened once already: `invite-decline.html` swapped `d-none` for the
`hidden` attribute while `invite-decline.tsx` was still calling
`classList.add("d-none")`, so its error messages and pivot panels could no
longer be shown or hidden at all.

Before removing any class, grep for it:

```bash
grep -rn "classList.*\"the-class\"" assets/ts assets/js
```

If a script touches it, migrate both sides in the same change. For visibility
specifically, prefer the platform: `el.hidden = true` works with the `hidden`
attribute the markup already uses, needs no class at all, and is what the
migrated modules now do.

## Classes the end-to-end tests own

The second place breakage hides. Playwright specs locate elements by class —
`page.locator(".card")`, `input.form-control-sm`, `.page-item` — and a spec
written that way keeps passing right up until someone migrates that surface,
then fails somewhere that looks unrelated. Neither the unit suite nor the
isolation gate can see it, because the dependency runs from a test file to
markup in a different tree entirely.

```bash
node scripts/check-e2e-selectors.mjs            # list every one
node scripts/check-e2e-selectors.mjs card btn   # just the ones you are removing
```

If a class you are about to delete appears, fix the spec in the same change —
preferably by switching it to a role or an accessible name, which will not
break the next time either.

## `.pk` is not always safe to add yet

Step 3 of the procedure says to wrap the surface's root in `.pk`. That is
right when the surface's own styling has moved with it, and wrong when it has
not, because the layer order that makes this migration work cuts both ways:

```
@layer legacy, tokens, base, components, utilities;
```

`base` beats `legacy` at any specificity. So `.pk` on a surface whose CSS is
still in `main.scss` hands the base layer authority over that surface's
elements, and the base layer has opinions:

- `.pk :where(button, input, select, textarea) { font: inherit; color: inherit }`
  takes the colour off every control the legacy stylesheet coloured.
- `.pk :where(ul, ol)` restores the list marker and indent a legacy
  `list-style: none` had removed.
- `.pk a { color: var(--pk-accent-ink) }` recolours every link.

The navigation bar is the worked example: its ~980-line stylesheet is still
legacy, so adding `.pk` to it would have rendered dark ink on a black bar and
put bullets back in the search facets. The class went on the parts whose
styling had moved, and not on the parts whose had not.

The rule, then: **add `.pk` when the surface's styles come with it.** If a
template is migrating its class names but its appearance still comes from
`assets/scss`, migrate the stylesheet in the same change, or leave the root
alone and say so. A surface that looks broken is worse than one that is
honestly half-done.

## Three things the gate cannot see

**A `pk-` class you got half right.** `class="pk-check"` on a label with no
`pk-check__input` on the input inside it passes every check — both classes
exist — and renders an operating-system default checkbox. The same is true of
`pk-stat-card` without its parts, or `pk-table` without `pk-table__scroll`.
When you adopt a block class, adopt its elements.

**A control that only a mouse can reach.** `onClick` on a `<tr>`, a `<div>`
or a `<span>` type-checks, lints, renders and works — for anyone with a
mouse. Fourteen portal list surfaces were built that way. If something is
activated, it is a `<button>` or an `<a>`; the design system's `rowAction`
and the `pk-stretched` utility exist so a whole row or card can still be the
target.

**A table, chart, region or icon with no name.** A `<table>` without a
`<caption>` is announced as "table"; four of them on a page are announced as
four tables. An SVG with `aria-hidden` and no alternative says nothing at
all. `DataTable` requires `caption`; the chart builders require `caption` and
emit a hidden data table beside the picture.

## What not to do

- Do not add a tolerated-violations baseline. The gate demands zero for
  everything in scope; a surface joins the scope when it is clean.
- Do not migrate a file halfway. A half-migrated file passes review and fails
  the moment its page drops Bootstrap.
- Do not reach for `!important`. If a design-system rule is losing, the surface
  is missing its `.pk` root or the CSS import, not a specificity fight.
