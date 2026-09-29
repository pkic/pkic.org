# Frontend guidance

- Infer request and response types from canonical schemas in `assets/shared`; do not maintain manual API mirrors or unsafe response casts.
- Use `ApiDataTable` or its shared successor for server-driven admin lists. Do not rebuild fetch, filter, search, sort, and page state per screen.
- Send filter, search, sorting, and pagination state to the API. Do not fetch an arbitrary first 100 or 200 rows and process them as a complete dataset.
- Separate data hooks/controllers from focused presentational components. Split components by responsibility before they become multi-purpose pages.
- Reuse existing accessible controls and design tokens.
- Treat every instant from the API as UTC and localize it only when rendering. Use the shared date formatter rather than per-component `toLocale*` calls, and let it resolve the viewer's locale and zone instead of hardcoding one.
- Render an event, meeting, or occurrence time in the entity's configured IANA zone when the wall clock is what participants agreed to, and label which zone is shown.
- Test loading, error, empty, keyboard, filter, sort, and first/last-page behavior for list screens.
