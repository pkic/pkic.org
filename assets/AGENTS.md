# Asset and browser guidance

- Reuse existing TypeScript components, SCSS classes, design tokens, and Hugo asset pipelines before adding alternatives.
- Do not use inline scripts or `style` attributes. Bundle TypeScript through Hugo/Vite and put presentation rules in SCSS.
- Keep browser code render-focused. Filtering, searching, sorting, aggregation, and pagination of server data belong in backend queries.
- Preserve keyboard access, semantic controls, visible focus, responsive layouts, and reduced-motion behavior.
- Do not hardcode tenant-visible branding, links, or configurable product policy in components.
