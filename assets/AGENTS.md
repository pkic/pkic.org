# Asset and browser guidance

- Reuse existing TypeScript components, component stylesheets, design tokens, and the Vite and Astro build before adding alternatives.
- Do not use inline scripts or `style` attributes. Bundle TypeScript through Vite and put presentation rules in the stylesheet the component imports.
- Keep browser code render-focused. Filtering, searching, sorting, aggregation, and pagination of server data belong in backend queries.
- Preserve keyboard access, semantic controls, visible focus, responsive layouts, and reduced-motion behavior.
- Do not hardcode tenant-visible branding, links, or configurable product policy in components.
