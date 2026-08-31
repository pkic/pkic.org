# Migrating a surface off Bootstrap

Phase 5. The route to zero is per-surface: migrate a surface, add it to the
gate's scope, and it can never regress. There is no big-bang step and no
moment where the site is half-converted globally.

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
| `visually-hidden` | the clip-path pattern already in the primitives |
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

## What not to do

- Do not add a tolerated-violations baseline. The gate demands zero for
  everything in scope; a surface joins the scope when it is clean.
- Do not migrate a file halfway. A half-migrated file passes review and fails
  the moment its page drops Bootstrap.
- Do not reach for `!important`. If a design-system rule is losing, the surface
  is missing its `.pk` root or the CSS import, not a specificity fight.
