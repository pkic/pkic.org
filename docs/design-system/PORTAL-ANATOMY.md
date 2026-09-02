# Portal page anatomy

The component library is the vocabulary; this is the grammar. Every portal
screen composes the same five regions, in order, and nothing else at the top
level. A page that needs something this anatomy cannot express is a reason to
extend the anatomy, not to hand-roll a layout.

## The five regions

```
1  PageHeader   breadcrumb? · title · context chips · primary actions
2  Tabs?        TabList, only when the record has more facets than fit one page
3  Content      full width — one of:
   · List panel: ONE panel holding head (search · filters · actions),
     bulk bar?, table, and pager (count left, page controls right)
   · Form panels, detail panels
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

## Records inside a workspace — the nested-header decision

A workspace (a group, and one day anything else that owns collections) keeps
the five regions above for itself: its PageHeader is the page's `<h2>`, its
tabs are the section switcher. The records living inside its tabs then come in
exactly two shapes, and the choice between them is a rule, not taste:

**A record with facets is a routed page.** An event, a vote, a form: each has
its own URL under the workspace (`…/votes/:voteId/:tab?`), and renders a
**record header** — a `← Back to <collection>` link, the record's name as an
`<h3>` (`pk-record-title`; the shell owns `<h1>`, the workspace `<h2>`),
status badges and one meta line — followed by its own tab row, each facet
fetching only when opened. The workspace header stays above it: the reader
keeps "where am I" (group) and gains "what am I on" (record) without either
repeating the other. Never render a faceted record as an expansion between
the rows of the list it came from — that is how the vote detail ended up
drawing "Sharing" above the vote itself, with the rest of the list still
poking out underneath.

**A single-facet detail opens in place.** A row whose detail is one bounded
form or quick view — a mailing list's settings, one meeting occurrence — may
expand under its row (`detailRow`); the license ends the moment the detail
grows a second facet or wants its own URL in someone's hands.

A meeting **series** (occurrences, settings) is the same shape as the others,
at `…/meetings/:seriesId/:tab?`. It was the one exception for as long as the
API had no single-series GET and the row was the only place its data lived;
`GET /groups/:id/meetings/series/:seriesId` now returns exactly the list
row's projection — effective capabilities and occurrence count included — so
the record fetches itself by id and no faceted record opens in place anymore.

## What this is not

Not a base class and not a wrapper component hierarchy. `PageHeader` is a
primitive because a header has real structure; the rest is composition of
what `assets/ts/ui` already exports. The future Vite/Node renderer inherits
components, not page scaffolding.
