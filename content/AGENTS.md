# Hugo content guidance

- Write authored content in US English. Preserve exact quoted names and source text where required.
- Do not include HTML in Markdown content.
- Check for and reuse an existing shortcode before creating one. Make new shortcodes reusable.
- Keep company and member descriptions factual, neutral, and attributable under the more specific member guidance where applicable.
- For prose, front matter, or other content-only edits, review the diff and validate the affected front matter. Do not run `pnpm run check`, `pnpm run test`, or `pnpm run test:e2e` unless the change also touches executable code, templates, schemas, or configuration.
- Preview only the affected page when content structure, shortcode usage, internal links, or rendering may have changed. A spelling or wording-only edit does not require a full site build.
