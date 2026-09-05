# Building with the PKI Consortium design system

## Wrap everything in `.pk`

`.pk` is the scope class that carries the system's typography and text color. A
component rendered outside it inherits browser defaults and looks unstyled — this
is the single most common way to get a broken-looking screen.

```jsx
<div class="pk pk-canvas">
  <div class="pk-container pk-stack">
    <PageHeader title="Post-Quantum Cryptography" />
    <Panel>…</Panel>
  </div>
</div>
```

`.pk` sets font and ink; add `.pk-canvas` on the outermost element when you want
the page ground painted too. Light and dark both work with no setup: the theme
follows `prefers-color-scheme`, and `data-theme="dark"` or `data-theme="light"`
on the root element forces one. Never hard-code a color — every token has a value
in both themes, and a literal hex will be wrong in one of them.

## Write `class`, not `className`

These components destructure a `class` prop. `className` is **not** read by them —
it falls through to the DOM node and fights the component's own classes.

```jsx
<Button variant="primary" class="pk-stretched">Publish charter</Button>   ✅
<Button variant="primary" className="pk-stretched">Publish charter</Button>  ❌
```

The generated `<Name>.d.ts` files list `className` on every component. That is an
artifact of the type extraction, not the component's API. Use `class`.

## Style with tokens, not values

Every color, space, size, radius and duration is a CSS custom property. Use them
directly in your own layout glue:

| Family | Names |
|---|---|
| Space | `--pk-1` … `--pk-8` (0.25rem → 4rem) |
| Surface | `--pk-canvas`, `--pk-surface`, `--pk-surface-raise`, `--pk-surface-sunk`, `--pk-overlay`, `--pk-stripe` |
| Text | `--pk-ink`, `--pk-ink-muted`, `--pk-ink-faint`, `--pk-ink-inverse` |
| Rules | `--pk-line`, `--pk-line-soft`, `--pk-line-strong` |
| Accent | `--pk-accent`, `--pk-accent-strong`, `--pk-accent-soft`, `--pk-accent-ink`, `--pk-accent-on` |
| State | `--pk-ok`, `--pk-warn`, `--pk-danger`, `--pk-info`, each with `-soft` and `-ink` |
| Type | `--pk-font`, `--pk-font-mono`, `--pk-text-2xs` … `--pk-text-3xl` |
| Shape | `--pk-radius-sm`, `--pk-radius`, `--pk-radius-lg`, `--pk-radius-pill` |
| Motion | `--pk-dur-fast`, `--pk-dur`, `--pk-dur-slow`, `--pk-ease` |

State tones are independent of the accent on purpose: the accent is green, so an
accent-derived "success" would be unreadable as a status.

## The utility set is deliberately tiny

There are no `mb-3`-style utilities and **no gap classes**. The complete layout
vocabulary:

- `pk-container` (`--narrow`, `--wide`) — a measured reading column
- `pk-stack` (`--tight`, `--snug`, `--loose`) — vertical rhythm
- `pk-cluster` (`--between`, `--center`, `--start`, `--end`) — horizontal group, wraps
- `pk-grid` (`--tight`, `--roomy`) — responsive grid

Text and state helpers: `pk-small`, `pk-muted`, `pk-strong`, `pk-lede`,
`pk-nowrap`, `pk-center`, `pk-section`, `pk-sr-only`, `pk-skeleton`, `pk-required`.

Spacing is tuned by setting `--pk-gap` on the parent, not by picking a different
class — so twelve children can't disagree about their spacing:

```jsx
<div class="pk-stack" style={{ "--pk-gap": "var(--pk-6)" }}>…</div>
```

Anything not in this list does not exist. Invent a class name and it silently
does nothing.

## A record page — the shape every subject uses

A page about a *subject* — a person, an organization, a working group — opens
with `ProfileHeader`, not `PageHeader`. `PageHeader` names a **place** in the
product (a title, a trail, that screen's actions). `ProfileHeader` names the
**subject the record is about**, and it is deliberately subject-agnostic so a
member record and an organization record share one header instead of growing
two that drift:

```jsx
<Breadcrumb items={[{ label: "Users", href: "#/users" }, { label: name }]} />
<ProfileHeader
  media={<Avatar name={name} src={headshotUrl} size="xl"
                 status={{ label: "Board member", tone: active ? "accent" : "neutral" }} />}
  title={name}
  pill="Open to opportunities"
  lede="Solution architect at Digitorus · Chair, CBOM Profiles Working Group"
  facts={["Utrecht, Netherlands", "Member since June 2024"]}
  actions={<Button variant="primary" size="sm">Message</Button>}
/>
```

The trail stays its own `Breadcrumb`: navigation is not part of who the subject
is, and keeping it out is what lets the same header carry an organization.

Below the header, ties to other subjects are `AffiliationRow` — organizations
on a person's record, people on an organization's. `past` is the whole
treatment for a tie that has ended (dimmed, mark desaturated); the dates say
when. A long history closes with `ExpandFooter` across the panel's foot rather
than pushing the page down.

Four components carry a magnitude, and reaching for a hand-built bar or pill
instead is how a page stops matching the rest of the system:

| Showing | Use |
|---|---|
| A proportion in a table cell | `<Meter size="sm" showValue />` |
| A proportion at full width | `<Meter />` |
| A label carrying a count and a rank | `<Chip count={21} strength={1} />` |
| A figure in a sidebar | `<StatCard density="compact" />` |
| A figure on a dashboard | `<StatCard />` |

## Some components only render inside their parent

Their prop contracts look self-contained, but they draw their styling from an
ancestor's class. Rendered standalone they come out as bare, unstyled strips:

| Component | Must be inside |
|---|---|
| `PanelHeader`, `PanelBody` | `Panel` |
| `RowActions` | a table row — status then overflow menu, pushed to the row end |
| `StateIcon` | a `Field` — it has no intrinsic size and takes its color from a `pk-field--ok\|advisory\|invalid` ancestor |

## List surfaces are one framed band, not four floating blocks

`Toolbar`, `BulkBar`, `DataTable` and `Pager` are designed as bands of a single
panel, composed by `pk-table-list`. Without it they render as separate blocks on
the canvas with no shared border. (This class lives in the component styles, not
in `utilities.css`.)

```jsx
<div class="pk-table-list">
  <Toolbar …/>
  <BulkBar …/>
  <DataTable …/>
  <Pager …/>
</div>
```

`DataTable` is generic over its row type in source, but the emitted contract
flattens that — write `<DataTable …>` and annotate the row type on each `cell`
and `rowKey` callback rather than trying `<DataTable<Row>>`.

## Choosing the gap when you stack things

`pk-stack` defaults to `--pk-4`, and that is usually right. The modifiers are not
interchangeable:

- `pk-stack--tight` (`--pk-1`) — only for items that carry their own background or
  border, like stacked `Alert`s. Two `Panel`s at this gap abut into what looks
  like one surface.
- `pk-stack` — sibling `Panel`s, and anything where the gap is the only separator.
- `pk-stack--loose` (`--pk-5`) — untinted, unbordered blocks.

## Read the real files

- `_ds/<folder>/styles.css` and its imports — `tokens/tokens.generated.css` is the
  full token list, `tokens/utilities.css` the full utility list, `_ds_bundle.css`
  every component's styles.
- `components/<group>/<Name>/<Name>.prompt.md` — per-component usage.
- `guidelines/docs/design-system/PORTAL-ANATOMY.md` — how a screen is assembled:
  the components are the vocabulary, that file is the grammar.

## A screen, idiomatically

```jsx
<div class="pk pk-canvas">
  <div class="pk-container pk-stack">
    <PageHeader title="Members" />
    <div class="pk-cluster pk-cluster--between">
      <TextInput placeholder="Search members…" />
      <Button variant="primary">Invite member</Button>
    </div>
    <Panel>
      <PanelHeader>Working group roster</PanelHeader>
      <PanelBody>
        <div class="pk-cluster pk-cluster--between">
          <PersonCell name="Tomas Riedel" email="tomas.riedel@example.org" />
          <Badge tone="ok">Active</Badge>
        </div>
      </PanelBody>
    </Panel>
  </div>
</div>
```
