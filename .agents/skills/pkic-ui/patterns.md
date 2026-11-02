# Pattern catalog

Each entry is the full anatomy of a control. The gallery id renders it (`pnpm gallery:shot <id>`). Popups share placement through `assets/ts/ui/popup-placement.ts` (`usePopupPlacement`): fixed position, 4px gap, flip only when the preferred side lacks room and the other has it, 8px viewport margin, follows the trigger on scroll, top layer above sticky headers.

## Reaction picker (`reaction-picker`)

- Use: `assets/ts/live-session/ReactionPicker.tsx` with `LIVE_CHAT_REACTIONS` (`assets/shared/live-chat-policy.ts`).
- Shape: one horizontal row of emoji buttons in a popover, `role="toolbar"`, each a toggle (`aria-pressed`). Never a vertical menu, never icon-only items in `Menu`. Reference: Slack, Teams, WhatsApp, GitHub.
- Placement: above the trigger, right edges aligned (`side: "top", align: "end"`); below only without room. The trigger sits beside the message's ellipsis menu.
- Dismissal: Escape (focus back to the trigger), outside click, Tab, or choosing a reaction.
- Keyboard: focus moves to the first emoji on open; Left/Right wrap, Home/End.

## Layout picker (`content-layout`)

- Use: `ContentLayoutPicker` in the Markdown editor, with `LayoutSizeGrid` for card/grid/table dimensions. Reference: the insertion palettes in Word and Google Docs.
- Shape: one labeled Layout toolbar trigger opens a compact, nonmodal palette. Text columns offer illustrated 1–4 choices and Automatic. Grid and Cards use a size matrix; Bento offers illustrated presets. Table opens the same matrix with table limits. Do not add separate toolbar buttons per layout type or put sizing cells in a Menu.
- Placement: below the trigger, aligned to its start, through `usePopupPlacement` with top-layer placement; flip and clamp to the phone viewport.
- Dismissal: choosing a size applies immediately; Escape and Close return focus to the trigger; outside click or focus leaving closes without stealing focus.
- Keyboard: focus enters the first choice. Matrix arrows move by cell, Home/End move to row edges, Ctrl+Home/End move to matrix corners; Enter/Space select. Tab follows normal controls. Edit layout reuses this palette, marks the current choice, and preserves all authored children.

## Menu (`menu`)

- Use: `assets/ts/ui/Menu.tsx` (`MenuItem`: `danger`, `disabled`, `checked`, `multiple`, `keepOpen`, `separatorBefore`, `children` for a submenu). Row ends: `RowActions`. Create command: `SplitButton`.
- Shape: the ellipsis trigger is square and as tall as a text button beside it at either density (`variant="icon"`) or labeled trigger (`variant="plain"`); a vertical list of text items. Disabled items stay visible. Destructive items last, after a separator, in the danger tone.
- Placement: below the trigger; `align="end"` at a row or panel end; submenus open to the right and flip left.
- Dismissal: Escape (focus back to the trigger; in a submenu one level back), outside click, Tab, or selecting an item (unless `keepOpen`).
- Keyboard: Enter/Space/ArrowDown open on the first item, ArrowUp on the last; arrows wrap and skip disabled items; Home/End; ArrowRight opens a submenu, ArrowLeft returns.

## Authored-content editor (`content-editor`)

- Use: one sticky formatting toolbar in `MarkdownEditor`, `EditorContextMenu`, and the canonical builders in `editor-context-actions.ts`. Reference: document-editor toolbars and context menus in Word and Google Docs.
- Shape: one row; formatting commands that fit stay visible, with overflow in More formatting. An always-visible Actions button exposes commands for the current text, layout, button, media, code block, or table. Never stack selection-specific toolbar rows.
- Placement: the toolbar remains inside the editor and below pinned semantic headers, including nested scroll surfaces. The Actions menu anchors to its button; right-click anchors the same shared Menu at the invocation point with viewport clamping. Popups use the shared top layer.
- Dismissal: Escape restores the invoking content or button focus, outside click dismisses, and actual scrolling closes a pointer menu. A queued scroll that preceded invocation must not close it.
- Keyboard/touch: Shift+F10 or the Context Menu key opens the same actions at the selection. Preserve existing selected text when invoked within it; otherwise target the clicked content. Shift+right-click and disabled/source mode keep the browser menu. Touch keeps native long-press selection and uses the visible Actions button.
- Editing destinations/media opens the shared Dialog, so its fields remain visible on long pages. Keep command implementations shared across all entry points, and preserve editor selection through menu focus changes.

## Dialog (`dialogs`)

- Use: `confirmAction({ title, body, consequences, confirmLabel, tone })` for a yes/no decision; `assets/ts/ui/Dialog.tsx` for modal content; `BottomSheet` for a phone sheet.
- Shape: native modal `<dialog>`; title, short description, optional consequence list; footer with ghost Cancel then the primary (or danger) action named by its outcome. Destructive dialogs use `role="alertdialog"`; irreversible ones can require a typed phrase.
- Placement: centered over an inert page; `BottomSheet` slides up from the bottom edge.
- Dismissal: Escape, the close button, or Cancel. A backdrop click does not dismiss a `Dialog` or a confirmation (it does dismiss a `BottomSheet`, as does a swipe down).
- Keyboard: focus trapped inside; focus returns to the opener on close.

## Tooltip (`tooltip`)

- Use: the native `title` attribute, identical to the control's `aria-label`. There is no custom tooltip component; do not build one.
- Shape and placement: the browser's own, on hover. Every icon-only control has one. Truncated table cells get the full value as `title` (handled by `DataTable`).
- Dismissal and keyboard: the browser's. Never put essential information only in a tooltip.

## Toast (`toast`)

- Use: `showToast(targetId, message, type)` from `assets/ts/shared/toast.tsx` (the portal wrapper targets `#portal-toast-area`). Never render `Toast` directly in product code.
- Shape: one line with a tone dot, the message, an optional action, and Dismiss; `role="status"`.
- Placement: the fixed toast area of the portal, never inline in content.
- Dismissal: after 5 seconds, or Dismiss. Use it only to confirm a finished action. An error the user must act on goes in an `Alert` or the field status, not only a toast.

## Tabs (`tabs`)

- Use: `assets/ts/components/Tabs.tsx` in the portal (route links with `hrefFor`, or panels); `TabList` for panels inside a view; `ui/Tabs` for a link strip. Inner tab state goes in the URL through `useHashQueryParam`.
- Shape: a horizontal strip of short labels, the active one marked; `attention` adds a danger badge for hidden problems. Never repeat a tab as a "Back" button.
- Placement: directly above the content it switches; on phones the strip scrolls sideways to keep the active tab visible.
- Keyboard: Left/Right wrap, Home/End; selection follows focus.

## Panel header (`panel-header`)

- Use: `PanelHeader` from `assets/ts/ui/Panel.tsx`.
- Shape: title left; toolbar right holding the ellipsis `Menu` first (the `menu` prop), then label-width buttons, primary last. The toolbar sets compact density itself, so its buttons take no `size`; `Button` has no small size. On phones the toolbar wraps under the title.
- The menu holds whole-record actions; the buttons hold the one or two frequent ones. Never a separate action or status panel above the content.

## Input group (`input-group`)

- Use: `Toolbar` `search` for list search; a `pk-field__control` row (`TextInput` plus an icon `Button`) for add-to-list fields; the live chat composer for messages.
- Shape: the field and its one action in one row. Search: inline icon button at the field's end, accessible name naming the list ("Search members"). Composer: textarea joined to the primary Send button, status line above the field so nothing moves.
- Keyboard: Enter submits (in a composer Shift+Enter adds a line). The action stays disabled until the shared contract says the value is valid.

## Empty state (`empty-state`)

- Use: `assets/ts/ui/EmptyState.tsx` (`title`, `body`, `action`).
- Shape: a short statement of what is missing and why, left aligned; the title is a paragraph, not a heading.
- Offer `action` only when the surface has no other way to start that command (an `ApiDataTable` create action already counts). Hide panels that would only show an empty state on engagement screens.

## Person hover card (`person-card`)

- Use: the canonical `PersonCard` / `usePersonCard` / `PersonPreview` in `assets/ts/site/PersonCard.tsx`.
- Shape: a portrait, name linked to the public profile when available, identity affiliation, and full role labels. Membership uses the monochrome PKIC mark. Reference: Teams and GitHub profile cards.
- Placement: beside the name through `usePopupPlacement`, in the top layer and within the phone viewport. Moving from the name into the card keeps it open.
- Dismissal: Escape, a tap outside, or leaving both the trigger and card. A tap on the trigger toggles it.
- Keyboard: focusing the trigger opens the card; Tab can reach the profile link. Escape dismisses the card before any surrounding dialog.

## Avatars and badges (`people`)

- Use: `Avatar` (`shape="round"` for people, `"square"` for organizations), `PersonCell` in tables, `Badge` for exceptions.
- Shape: photo, or initials when there is none or it fails to load. Badges have a dot and a tone; expected states are plain text.
- Speaker details: keep personal links beside the name, wrapping as a group on narrow screens, with title and organization text beneath. Organization logos form a separate group on the right on desktop, below the title and links on phones. Never insert a logo into the title or affiliation text. Compact agenda rows show no organization logos; their affiliation text can rotate.

## Workflow stage (`workflow-stage`)

- Use: `Badge` with `tone` and, for in-flight steps, `progress` and `progressStyle`; `DataTable`/`ApiDataTable` `rowTone` and `rowToneStyle` for rows. The stage list (label, tone, progress) lives in the workflow's shared domain module.
- Shape: pill with dot, label in body ink, fill a light mix of the rainbow stop. Rows: label only by default; edge marker (a 0.25rem inset bar on the leading edge, on the record card on phones) for queues; tint (20%, deeper on hover) for short state-led queues. Selection wins over tint.
- Never color by position, never invent a stop outside the rainbow, never let color carry the stage without its label.

## Profile biographies (`profile-biographies`)

- Use `IdentityProfileFields` inside the existing identity profile form. General introduction: **About you**. Organization profile: **Your bio at {organization}**. Speaker onboarding: **Your speaker bio at {organization}**.
- Shared `Field` guidance appears above its control by default; validation feedback stays below. Explain the bio scope there: About you spans roles; an organization bio is reused only when participating as that organization. Neither edit copies into the other.
- The About panel names an organization when using its bio as a fallback. Its menu edits the displayed source and separately offers adding a general introduction.

## Content version notice (`content-version-notice`)

- Use: `site/ContentVersionNotice.tsx` with the selected and latest entries from the shared `ContentVersions` contract. Both maturity models use this component.
- Shape: one slim full-width row below the section navigation, with the draft or historical version at the left and “View current release” at the right. Use plain version text, not a badge; show a linked source revision when available for a draft, including on phones. Hide only the supplementary description on phones.
- Placement: the section navigation and notice share one sticky container beneath the site header. Do not change the hero or repeat the notice in the page body. The current release has no notice.
- Behavior: persistent, without dismissal. The current-release link preserves the equivalent page when available and is an ordinary keyboard-accessible link.

## Page feedback (`content-contribution`)

- Use: `site/ContentContributionLinks.tsx` with canonical source metadata, only on public pages with an editable source. Never portal screens.
- Shape: one centered, muted italic sentence between the content and footer, with an underlined feedback link. No heading, panel, border, or decorative arrow. Wrap naturally on phones.
- A small circular pencil stays at the bottom-right with safe-area spacing and an accessible edit label. On phones it sits in the flow under the invitation, since a floating one covers badges at the cards' right edge. Keep the hero unchanged.
- Blog posts retain their footnote without the invitation; editing and selection feedback remain available.
- Selection feedback includes the page, section or item, wording, source, and available version and revision. General feedback stays independent of the selection. Persistent links work without JavaScript.
