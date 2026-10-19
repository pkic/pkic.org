# Frontend guidance

- Infer request and response types from canonical schemas in `assets/shared`; do not maintain manual API mirrors or unsafe response casts.
- Use `ApiDataTable` or its shared successor for server-driven admin lists. Do not rebuild fetch, filter, search, sort, and page state per screen.
- Send filter, search, sorting, and pagination state to the API. Do not fetch an arbitrary first 100 or 200 rows and process them as a complete dataset.
- Separate data hooks/controllers from focused presentational components. Split components by responsibility before they become multi-purpose pages.
- Reuse existing accessible controls and design tokens.
- Editing belongs in a dedicated view or edit page, or in the WYSIWYG content being edited. Never insert edit forms above a data table, between data sections, or inside table rows. Row menus open the appropriate detail or edit view. Keep actions at their actual scope: whole-record actions belong in that record card's ellipsis menu; collection creation/search/refresh/bulk actions belong in the shared table toolbar or native create action. Local panels use the existing shared tabbed submenu, not a custom button strip. Never add a separate action or status panel above a list or between data sections. Revision status and publication approval belong in a dedicated review view opened from the ellipsis menu. WYSIWYG controls belong with the content being edited.
- Before building or changing a portal view, identify what users need to understand or accomplish and inspect comparable existing views, including forms, Users, and Organizations. Build on their layouts and shared components where they fit. If existing components do not serve the purpose, extend them or introduce a focused, broadly reusable component rather than inventing a separate design for one screen. Explain the gap and why the chosen composition fits the task.
- Choose presentation according to its purpose: tables for comparing rows, cards for headline figures, description lists for record metadata, and established form sections for editing. These are patterns, not mandatory choices for every count or detail. Reuse the shared component for the chosen pattern; keep distinct quantities understandable rather than compressing them into unexplained tuples.
- Format displayed quantities through the shared formatNumber helper, including headline cards and explanatory text. Numeric table columns must use align: "end" and width: "fit" so grouped digits are comparable. Identifiers and revision tokens are not quantities.
- During UI review, verify component reuse, semantic status colors, grouped numbers, numeric alignment, and desktop/phone presentation against the existing portal views before declaring the screen ready.
- Treat every instant from the API as UTC and localize it only when rendering. Use the shared date formatter rather than per-component `toLocale*` calls, and let it resolve the viewer's locale and zone instead of hardcoding one.
- Render an event, meeting, or occurrence time in the entity's configured IANA zone when the wall clock is what participants agreed to, and label which zone is shown.
- List behavior (loading, error, empty, filter, sort, paging) is tested once in the shared list component; screen tests cover only what the screen adds.
- One implementation per UI job (buttons, downloads, pictures, confirmations, dialogs, tabs, menus, headers, person rows, empty states, pills, toasts, file pickers, pagination, copy, formatting, icons): extend the existing shared one; never add a parallel variant, and delete superseded ones in the same change.
- Buttons are label-width, grouped with the shared gap; only stacked alternative choices in a narrow single-purpose card (sign-in methods) are full width. A form's main action is primary; destructive actions confirm through `confirmAction()`.
- Normal, expected states (Registered, Confirmed, Accepted, Member, Upcoming) are plain text in a meta line. Use a tone `Badge` only for exceptional or actionable states (needs action, waitlisted, declined, cancelled, on air, overrun), with the matching tone rather than green by default.
- Before building or changing a control, name the pattern widely used apps follow and follow the `$pkic-ui` pattern catalog entry for its full anatomy: shape, placement relative to the trigger, dismissal, and keyboard behavior. A small tweak to a generic component that produces an unfamiliar shape is not done.
- Links outside the portal open in a new tab through `ButtonLink`, `ExternalLink`, or the Markdown renderer; never set a raw `target`.
- Do not repeat tab navigation as "Back" buttons, show features that do not work yet, or expose implementation words (URL, token, credential, JSON) to attendees and members.

## Live production

- Keep production integration vendor-neutral: say "browser source", "production software", or "switcher". Never name a specific production tool in copy, identifiers, comments, or contract values.
- Operators work from muscle memory, so the studio and control room layout stays fixed. Never insert a banner or notice that shifts panels; show status in an existing fixed spot such as the session bar.
- Speaker name, title, and organization in the studio, lower thirds, and search come only from the selected speaker identity, never from a copied session-speaker field.
- Engagement screens center participation: chat and reactions visible, sponsors visible, panels shown only when they have content, full screen, video edge to edge on phones.

## Navigation state

- Primary views/tabs use readable route paths (for example `/agenda/speakers/`), with clean default routes. Search, filters, sort, pagination, timezone and secondary presentation choices use canonical validated URL query state; omit default values. Refresh, bookmark/share and browser back/forward must restore meaningful view state across portal and public site.
- Use canonical URL/route hooks and shared list/tab/view controls; never maintain another query dialect or local-only navigation state. ApiDataTable requires an explicit nonempty urlState namespace owned by its route/workspace. Passthrough controlled props must receive a canonical binding at the owner.
- Loading, permissions, errors, confirmations, unsaved forms and temporary camera/fullscreen state are transient and must not enter bookmark URLs. Genuine transient form panels need explicit semantic shared contracts, not file exceptions or skipped baselines.

- `check:url-state` resolves canonical collection/tab/view component symbols and follows selected-value props through wrappers and aliases; local-only navigation state is a violation even behind a wrapper. It does not claim universal static proof of arbitrary DOM behavior: DOM-driven surfaces must use a canonical URL-state initializer and test direct links, refresh and back/forward through that owner. Availability predicates and transient draft state are not navigation state.
