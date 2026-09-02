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
decorative checkboxes. Filters the API supports belong to the column they
narrow: a column declares its `filter` (the query parameter and its values)
and the table draws the column's `…` menu — sort ascending, sort descending,
the filter's values, hide the column — with the choice in force checked and
the narrowed value stated under the column's name. The toolbar keeps only
search, the create action and refresh. A row of selects above the table did
not scale (ten filterable columns is ten selects) and each page drew it a
little differently — the donations list had grown its own chips — which is
exactly the non-uniformity a shared table exists to prevent. Hidden columns
come back from the ⊞ menu at the end of the head.

**A record with facets gets tabs; an account gets its related lists on the
page.** A tab loads its own bounded query when activated — a tab is precisely
the license _not_ to fetch everything on first paint — and that is right for a
workspace whose facets are large (a group's events, votes, forms). It is wrong
for an account read the way a CRM reads one: an organization's page shows the
organization, then who represents it, then its sponsorships, each a bounded
query of its own, with the mark and the contacts beside them. Putting "who
represents this organization" behind a tab made the first question a second
step. The mark is the affordance for changing it — hover or focus the tile
and it says so — not a panel with a header and a button.

**A record page takes the width; its forms stay closed.** The record and its
facts span the measure with the supporting column — logo, contacts, the
pipeline — beside it (`pk-record`), never two cards packed into the top-left
corner of a wide screen by an `auto-fill` grid sized for cards that never
arrive. What can be changed is shown as facts first; the form that changes it
opens behind Edit, Change, Advance stage. The organization page opened with
its logo-replacement form standing beside the logo, and the sponsorship page
with three forms and no record; a reader who opened a record to look at it
was handed tasks.

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
