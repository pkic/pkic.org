# Hugo layout guidance

- Reuse existing partials and shortcodes before creating another rendering path.
- Do not use `style` attributes. Add reusable classes and define their presentation in SCSS.
- Do not add inline scripts; the strict CSP blocks them. Use bundled TypeScript through the Hugo asset pipeline.
- Keep templates presentation-focused. Put reusable transformation or application behavior in an appropriate tested module.
