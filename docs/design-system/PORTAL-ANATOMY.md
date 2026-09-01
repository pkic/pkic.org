# Portal page anatomy

The component library is the vocabulary; this is the grammar. Every portal
screen composes the same five regions, in order, and nothing else at the top
level. A page that needs something this anatomy cannot express is a reason to
extend the anatomy, not to hand-roll a layout.

## The five regions

```
1  PageHeader   breadcrumb? · title · context chips · primary actions
2  Tabs?        TabList, only when the record has more facets than fit one page
3  Toolbar      search · filters · view actions   (lists only)
4  Content      the table, the form, or the panels — full width
5  Pager        (lists only)
```

## Rules, each earned by a defect that reached the maintainer

**One name, once.** The sidebar names the section; the breadcrumb names the
trail; the title names the record. Nothing else repeats them. The organization
page said "organization" three times before its content began — sidebar entry,
breadcrumb, and a kicker restating what the breadcrumb already said.

**Content fills the width it is given.** `#portal-main` is the measure; the
content region spans it. Inside a table, slack goes to the one column marked
`primary` — not shared proportionally across all of them, which is how a
2000px screen produced columns adrift in dead space, and not capped at a
reading measure, which is how the next complaint became "the pages don't use
the width".

**Every list behaves the same way.** A row that has a detail page opens it —
`rowAction` on every such list, not some. Row commands live at the row's end,
always behind the `…` menu, even when there is only one: a column where some
rows show a button and others show the menu, depending on how many commands
each row happens to have, reads as broken. The row is the primary affordance;
the menu is its commands. A list whose API supports bulk operations
gets selection checkboxes and the `BulkBar`; one that does not, does not grow
decorative checkboxes. Filters the API supports render as `FilterSelect`s in
the toolbar, not as concepts the reader must express through search syntax.

**A record with facets gets tabs, not a longer page.** Each tab loads its own
bounded query when activated — a tab is precisely the license _not_ to fetch
everything on first paint. The organization page stacked profile, logo,
contacts and identities into one scroll while answering none of "which groups,
which sponsorships, which events".

**Controls are sized by their importance, not their consequence.** A
destructive action is distinguished by tone (`danger-quiet`) and confirmation,
never by being larger. The logo's Remove was the biggest control on the page.

## What this is not

Not a base class and not a wrapper component hierarchy. `PageHeader` is a
primitive because a header has real structure; the rest is composition of
what `assets/ts/ui` already exports. The future Vite/Node renderer inherits
components, not page scaffolding.
