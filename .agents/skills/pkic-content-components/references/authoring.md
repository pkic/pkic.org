# Content authoring

Native Markdown owns the text and structure; shared PKIC components own presentation. Use these contracts consistently across working groups.

## Editable complementary content

Use an aside for supporting information alongside the main explanation. Its entire body remains ordinary Markdown, including its heading:

```markdown
:::aside
### Before you start
Read the [contribution guide](../contributing/).

- Identify the intended audience.
- Link to supporting material.
:::
```

Asides have no presentation attributes. Write the heading inside the block so it is editable with the other content. The portal editor's **Aside** control wraps or unwraps the selected content; headings, paragraphs, links, and lists remain editable. Saving writes the directive back to Markdown. This does not add a page-management or publication workflow to the portal.

The publication renderer and portal Markdown renderer use the same aside boundary codec and the same PKIC component presentation. Asides are complementary content, without live alert announcements. Nested asides are supported; the editor uses a longer outer colon fence when saving nested content. Fenced code examples remain literal. An unclosed aside or unsupported aside attributes fail content validation rather than being silently discarded.

Review the `content-aside` component-gallery specimen to edit a complete example and compare the published result with the saved Markdown. Every working group can use the same syntax and capabilities.


## Shared reading presentation

The `content-prose` gallery specimen demonstrates the shared page-reading presentation using a complete, editable Markdown document. The full visual editor and the published `Markdown` component with `layout="reading"` use `ContentProse` typography: measured paragraphs, a consistent heading hierarchy, normal lists and quotations, code examples, and shared scrolling tables. Images and tables can use the surrounding width while text remains measured. No additional authored directive is needed for ordinary prose.

Compact Markdown and chat retain their existing application scale. Opt into the shared reading presentation for complete documents; compact fields keep their existing scale. Existing publication tables already use the same table classes now used by the portal renderer and editor. Table edits still save as Markdown tables.

## Columns, grids, and cards

`:::columns count=2` contains a single continuous Markdown body. Text flows down the first column and continues in the next. `count` accepts `auto`, `1`, `2`, `3`, or `4`; `width` defaults to `auto`. A preferred width (`16rem`, `18rem`, `20rem`, `24rem`, or `32rem`) lets the browser choose how many columns fit; a supplied count caps that number. Both omitted means one column. Narrow containers collapse to one column. Use multi-column text for short articles and parallel reading material; long pages still need careful reading-order review.

`````markdown
::::columns count=2
### A practical question
Ordinary paragraphs flow without explicit column children.

More paragraphs continue in the next column automatically.
::::
`````

Use `:::grid` with `:::item` children for independent items. Use `:::cards` with `:::card` children for related resources. These grids adapt to available space or accept a `count`. The old experimental column-item syntax is superseded, not a second form of text columns.

A card grid can set `variant=default`, `muted`, `accent`, or `plain`. Cards inherit that choice unless their own `variant` overrides it. These choices describe presentation, not review status. All surfaces, borders, ink, and accent colors use the current page's PKIC tokens.

`cards layout=bento count=3` uses the same cards with featured items. A card's `span=2` and `rows=2` request a wider/taller item when space permits. No dense packing or CSS order changes reorder the document. On narrow screens, cards stack in document order. Icons use the existing authored SVG registry through `icon=shield-check`; logos remain native Markdown images with descriptive alt text and `media=logo` for proportional presentation. Logo artwork is not recolored.

`````markdown
::::cards layout=bento count=3
:::card span=2 rows=2 icon=shield-check variant=accent
### Shared evidence
Editable paragraphs, lists, and links.
:::
:::card media=logo
![Organization name](/img/logo-color.svg)

### Supporting organization
Keep the logo and explanation editable.
:::
::::
`````

The editor provides Text columns, Grid, Cards, and Bento grid insertion commands. Select a block to open Layout options: set count/width, card styles, spans, icon, or image treatment. Grid items can be added, removed, or reordered. Text columns keep one editable body; their toolbar command wraps or unwraps the selected paragraphs without replacing them. Gallery entries: `content-columns`, `content-bento`, and the combined `content-layout`.

Use the parent skill for the component implementation map and verification requirements.
