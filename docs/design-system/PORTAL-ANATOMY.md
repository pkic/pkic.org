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

**An account is read like a CRM record.** Organizations and the people who
represent them are the consortium's CRM. An organization page opens with the
trail, the name and its qualifying badges; the main column says what the
organization says about itself — slogan as the lead, description as prose,
links as a row (prose is never a term/value list) — then who represents it,
then its Activity: Groups, Events, Proposals and Sponsorships as tabs, each a
bounded query fetched when opened, aggregating what the organization's people
do across the system. The side column carries the mark (a tile that is itself
the control for changing it), the Membership facts, the Sponsorship standing
in one sentence — never an empty headed table — and the Contacts. Term/value
lists on one surface share one term measure (`pk-datalist-aligned`) so their
values sit on one edge; a state is a badge and never wraps. A record with
large facets (a group workspace) keeps its facets as tabs for the same reason
the account's activity does: a tab is the license not to fetch what nobody is
looking at.

**A record is edited where it is read.** One Edit in the page header turns
the record's values into inputs in place — the name in the title, the slogan
on its own line, the links under the mark, the membership facts in their
rows — and one Save sends one PATCH with the record's revision; Cancel puts
the values back. Nothing else moves: no separate form opens, no card is
replaced. The fields are the design system's `Field` with its typed controls
(`TextInput`, `Textarea`, `Select`) — never an invented input style — and
they are checked live through the one shared request contract the server
parses (`useContractForm`): a URL is `type="url"` held to the
shared link contract, a date is a date input, a category is a select, and a
field shows the ok or invalid state with its mark and reason as it is typed
in or left. Save validates the draft through the shared Zod update contract
and reads a refusal — the contract's or the server's — through the shared
validation map (`normalizeValidation`), so a refused field is marked, says
why, and takes focus, and never learns a rule the server does not apply.

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
