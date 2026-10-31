---
name: pkic-ui
description: Build or change PKIC portal, site, or studio UI with the shared components, the pattern catalog, the copy rules, and the component gallery. Use for any change under assets/ts or to a screen's copy.
---

# PKIC UI

The design system (tokens in `assets/design`, components in `assets/ts/ui`, the session details dialog as the reference screen) is the brief. Extend a shared component; never add a parallel variant. Read `assets/ts/AGENTS.md` first.

For authored Markdown blocks and editable page layouts, also read [PKIC content components](../pkic-content-components/SKILL.md).

## Before you build

1. Name the control and the pattern widely used apps follow for it. Open its entry in [patterns.md](patterns.md) and follow the whole anatomy: shape, placement relative to the trigger, dismissal, keyboard.
2. New screen or large redesign: send one desktop and one phone screenshot of the bare layout and wait for approval.
3. Find the comparable existing view and reuse its composition.

## Components (assets/ts/ui unless noted)

| Job | Use |
|---|---|
| Action | `Button`, `ButtonLink` (destinations; external links open in a new tab), `CloseButton` (`label="Close …"`), `SplitButton` (create command with options) |
| Text link | `ExternalLink`; `new-tab.ts` decides what is external |
| Record actions | `Menu` (ellipsis), `RowActions` (end of a table row, always a menu) |
| Confirmation | `confirmAction()` from `components/ConfirmDialog.tsx`; `Dialog` for richer modal content; `BottomSheet` on phones |
| Feedback | `showToast()` from `shared/toast.tsx` (renders `Toast`); `Alert` for a lasting problem; `FieldStatus` beside a field |
| Sections | `Panel` + `PanelHeader` + `PanelBody`, `SectionHeading`, `PageHeader`, `ProfileHeader` (record hero) |
| Lists | `ApiDataTable` (server lists), `DataTable`, `CollectionCard`, `ActionTile`, `DescriptionList` (record metadata), `StatCard` (headline figures) |
| Navigation | `components/Tabs.tsx` (portal), `TabList` (panels), `ui/Tabs` (link strip), `Breadcrumb` |
| Forms | `Field` with `TextInput`/`Textarea`/`Select`, `Checkbox`/`Radio`, `useContractForm(schema, body)`; `FormSection` |
| People | `Avatar`, `PersonCell`, `SpeakerPortraitCard`; `shared/initials.ts` |
| Status | `Badge` (exceptions only), `Chip` (filters and tags), `EmptyState` |
| Time | `assets/shared/format-date.ts`, `assets/shared/timezone.ts`, `assets/shared/agenda-time-display.ts` |
| Vocabulary | `assets/ts/shared/{speaker-roles,management-catalogs}.ts`, `assets/shared/status-display.ts`, `assets/shared/live-room-outputs.ts`, `assets/ts/live-session/live-room-copy.ts` |

## Rules

- **Buttons**: label width, grouped with the shared gap, never touching. Full width only for stacked alternative choices in a narrow single-purpose card (sign-in methods), through a scoped container rule. A form's main action is primary. Icon-only buttons carry `aria-label` and the same `title`. Name a button by its outcome ("Send invitation"), never "OK" or "Submit". `Button` has no small size: dense surfaces (panel toolbars, tables and row actions, the studio, editor toolbars) set `data-density="compact"` once on the surface, and `size="lg"` is only for hero and landing calls to action.
- **Panel header**: title left; toolbar right with the ellipsis `Menu` first (pass it as `menu`), then the buttons. Whole-record actions live in that menu; never a separate action strip above content.
- **Record context**: a record's hero (`ProfileHeader` for an organization, user, event or group) stays above every page that belongs to that record, sub-pages included. Email domains, members, settings or history of an organization still open under the organization hero, so the page always says whose data it is. The sub-page adds its own heading and content below the hero and never replaces it with a bare `PageHeader`.
- **Tabs**: one look everywhere: a flat strip on the page or panel surface, its underline running the full width of its container. Never put a strip in an inset, a tinted box or its own card. A section's own tabs hang directly under the strip that opened it (`Tabs.css` removes the stack gap); no extra spacing or border between the two levels.
- **Input group**: a field and its one action share a row. Search uses the `Toolbar` search (inline icon button, accessible name "Search members"). A composer joins the field and its primary button and keeps the status line above so nothing moves.
- **Initials**: `Avatar` falls back to initials when there is no photo or it fails to load: people round with first and last initial, organizations square with up to three. Never a generic silhouette.
- **Badges**: expected states (Registered, Confirmed, Member, Upcoming) are plain text in a meta line. A tone `Badge` marks only exceptional or actionable states (needs action, waitlisted, declined, cancelled, on air), with the matching tone. Tone mapping lives in `status-display.ts`.
- **Tone and workflow stages**: one family, the brand rainbow (`tone.ts`): grey not started, blue in flight, yellow waiting on someone, orange at risk, green done, red rejected. Tone means the state, never the position: every review step is blue. The label is the real stage name ("Executive Council review"), never a bucket like "Processing". Where order matters, `progress` (0 to 1) fades the blue in (`fade`, the default) or moves it toward teal (`travel`). A workflow declares its stages, labels, tones and progress once in its shared domain module; components never map stages themselves. In a table, a `Badge` in a column is the default; `rowTone` adds an edge marker for queues worked top to bottom, and `rowToneStyle="tint"` only for a short queue where the state is the whole point, never on a table that already carries colored buttons or many badges. Gallery: `workflow-stage`.
- **Links**: anything outside the portal opens in a new tab through `ButtonLink`, `ExternalLink`, or the Markdown renderer. Never write a raw `target`.
- **Layout**: no fixed pixel widths; check 375px. Type, spacing, size, and position use tokens or rem (`pnpm lint:css`, rule `pkic/layout-units`); px is for hairlines, borders, shadows, and fixed canvases. Video edge to edge on phones. Show a panel only when it has content.
- **Copy**: US English, glossary terms (`GLOSSARY.md`), sentence case. Cut lines that repeat a heading, placeholder, or button. No implementation words (URL, token, JSON, credential) for attendees and members. Run `$ux-copy` on every changed string.
- **Studio**: vendor-neutral terms ("browser source", "production software", "switcher"). Fixed layout: never insert a banner that shifts panels. Speaker details only from the selected identity. Vocabulary: Program (on air), Preview (next composition), Transition (replaces Program with Preview), outputs (Program, Projector, Stage preview, Stage display), lower third, ticker, browser source.

## Visual check (part of done)

- Component change: add or update its specimen in `assets/ts/ui/preview/sections-patterns.tsx`, then `pnpm gallery:shot <id>` (add `--phone`, `--dark`). The screenshot lands in `.gallery-shots/`. `pnpm gallery` serves every entry; `?only=<id>` shows one.
- Screen change: hot-reload server (`pnpm dev:test`), screenshot desktop and 375px.
- Built server (`--build`): only before a push.
- Inspect every screenshot yourself against the catalog entry: shape, placement, dismissal, spacing, pill density, copy. A UI change without a screenshot is not done.

## Saved values and actionable validation

- A saved value is not proof that it satisfies the current write contract. Keep reads tolerant of legacy values and provide a usable, authorized correction action beside a read-only summary; never hide an invalid saved field behind a generic form error.
- Reuse `ParticipationPersonalDetails` for personal-name corrections in participation flows. Its caller supplies the existing session or verified-capability adapter; do not build another name editor or store per-registration names.
- Keep validation on the canonical request schemas. A failed step must identify the relevant field and expose its correction path, including fields on earlier steps or in dialogs. Do not say only “correct highlighted fields” when no visible, editable field is marked.
- Exercise valid non-ASCII names, canonically equivalent Unicode spellings, and a pre-existing invalid saved name. Verify correction, persistence, and continuation through the complete flow, including browser Back/Forward. A successful PNG, request mock, or happy-path form test does not establish that a failed field can be corrected.

- Reading a form draft or checking whether it parses must not submit validation, mark fields, or move focus. Trigger those effects only from explicit user actions. In composed forms, validate in the visible field order and focus the first invalid editable field; verify that opening a verified link does not immediately show errors or jump to a later section.
- Keep each destination focused on one user task. Do not embed a complete secondary page or workflow below the primary one; use existing navigation and progressively reveal optional detail instead of stacking explanations, tables, and editors. Ticket entry and event sharing belong in separate destinations.
