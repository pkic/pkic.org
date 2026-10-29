---
name: pkic-content-components
description: Create or extend PKIC authored Markdown components, including editable layout blocks, card grids, and their publication rendering. Use for content component syntax, visual-editor support, and shared page-content presentation.
---

# PKIC content components

Markdown owns structure and contents. Shared PKIC components own presentation. Build one capability for every working group; preserve upstream source ownership.

Read the repository guidance and the relevant scoped instructions. Use the sibling [PKIC UI skill](../pkic-ui/SKILL.md) for controls and visual review. Read [authoring and publishing](references/authoring.md) when changing content syntax or publication policy, and inspect the existing component before adding syntax.

## Authoring contract

- Use native Markdown for headings, paragraphs, links, lists, tables, and images. Use colon containers only for structure native Markdown cannot express.
- `:::aside` contains ordinary editable Markdown.
- `:::columns count=2` contains one continuous Markdown body, not separate column nodes. `count` and `width` map to CSS multi-column layout; omitted values mean `auto`. `count=4` also works. Never implement this as a grid of paragraphs or manual column children.
- `:::grid` contains `:::item` children. `:::cards` contains `:::card` children. Use `count` for explicit grid columns. `cards layout=bento` uses the same cards with bounded `span`/`rows` choices; preserve document reading order.
- Cards may select an existing `icon` from the shared contract. Logos stay normal Markdown images with alt text; `media=logo` preserves their proportions. Extend `ContentIcon`/`SiteImage`, not another SVG loader or image pipeline. The editor's icon decoration is not authored child text.
- `:::button` contains one native Markdown link with a plain text label. It renders through `ButtonLink`; `variant=primary`, `secondary`, `ghost`, or `link` selects its shared presentation. `:::actions` groups button children. Reject unsafe destinations and unsupported button contents at the shared save/publication boundary.
- Cards may contain one `:::card-header` and one trailing `:::card-footer`. Their Markdown stays editable; footers align after the body without reordering content. Use native image Markdown with `media=image` for a cover or `media=logo` for proportional artwork.
- Cards inherit their grid's `variant`. A card can override it with `variant=default`, `muted`, `accent`, or `plain`. These are presentation choices, not approval/status indicators.
- Use a longer outer colon fence when nesting; the serializer chooses safe lengths. Do not introduce arbitrary CSS classes, inline styles, raw HTML requirements, or working-group-specific options.

All new components inherit the page's theme and working-group accent. Use semantic tokens, not a component-specific palette or a hardcoded green. Verify multiple accents in both themes. Use one labeled Layout toolbar trigger and the shared visual layout picker. Keep text-flow choices, grid/card sizing, and bento presets distinct within the picker; reuse it for content-preserving layout edits.

Editor capabilities are independent of canvas size. Use the default `basic` profile for biographies, short descriptions, abstracts, and notes (bold, italic, links, and lists). Request `profile="content"` explicitly for authored page and template bodies. Keep the schema, shortcuts, insertion controls, and contextual menus consistent with that profile; preserve unsupported existing Markdown as visible literal text.

The visual editor has one sticky toolbar. Selection-specific operations come from the shared Actions command builders and are available through its visible menu, right-click, and Shift+F10. Preserve native mobile text selection and Shift+right-click browser actions; never add another contextual toolbar row.

For interactive components, use the [Component Gallery](https://component.gallery/components/) as a reference for established behavior and naming. Keep text-bearing child nodes editable, reuse shared interaction primitives, and define keyboard/state behavior before adding syntax. Do not add arbitrary scripts to Markdown.

- Disclosures need editable summaries and bodies, visible focus, and native keyboard behavior. The existing `ContentFaq` is static; do not mistake it for an accordion.
- Tabbed content needs stable panel identities, appropriate tab-panel semantics, keyboard navigation, and explicit direct-link/state behavior.
- Forms, surveys, and polls reference existing PKIC modules; response storage, moderation, and approved publication remain owned by those modules.
- Diagrams reuse the existing Mermaid publication and theme pipeline. Interactive charts/tools need registered shared islands with validated configuration, accessible controls and fallback content, and lifecycle cleanup.

Project documentation, priorities, roadmaps, and task-status notes belong in the GitHub wiki. Keep repository skills focused on reusable implementation guidance; do not introduce a `docs/` folder in the public repository.

## Implementation map

- Shared button variants: `assets/shared/schemas/button.ts`; destination-button Markdown: `assets/shared/markdown-button.ts`.
- Canonical contracts: `assets/shared/schemas/content-layout.ts` and `content-aside.ts`.
- Fence parsing, validation, and serialization: `assets/shared/markdown-aside.ts`. Extend the shared codec; do not add a second parser for an individual renderer.
- Existing data-authored cards in `ContentComponents.tsx` consume the same `ContentLayout.css` surface. Keep image/body anatomy working when extending card variants; do not restore a second card/grid skin in `SitePages.css`.
- Shared DOM/presentation: `assets/ts/site/ContentLayout.tsx`, `ContentAside.tsx`, `ContentProse.tsx` and their imported stylesheets.
- Visual editor: `assets/ts/components/markdown-editor/layout-extensions.ts`, `aside-extension.ts`, and `editor-blocks.ts`. Authored children must remain editable nodes, not opaque widgets.
- Preview: `assets/ts/ui/Markdown.tsx`. Publication: `functions/_lib/services/site-components.tsx`. Keep the same component DOM in both; extra wrappers must not change grid children.
- Gallery: `assets/ts/ui/preview/sections-content.tsx`. Include a realistic editable specimen and its published result.

## Verify the capability

Test nested contents and named attributes through parse, visual edit, Markdown save, and reopen. Include fenced-code examples, malformed boundaries, and unsupported attributes where the codec changes. Verify publication DOM as well as the client preview. Check desktop and phone, light and dark, reading order, keyboard editing, overflow, and theme-token contrast. Follow the repository's validation scope; separate passing focused checks from unrelated failures. Do not claim portal page management exists merely because a gallery editor works.
