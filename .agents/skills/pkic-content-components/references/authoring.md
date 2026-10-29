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

Asides have no presentation attributes. Write the heading inside the block so it is editable with the other content. The portal editor's **Supporting note** control wraps or unwraps the selected content; headings, paragraphs, links, and lists remain editable. Saving writes the directive back to Markdown. This does not add a page-management or publication workflow to the portal.

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

The editor's Layout picker offers text-column choices, grid/card sizing, and bento presets. Edit layout changes the selected arrangement while preserving its contents. The sticky toolbar’s Actions menu retains preferred width, card styles, spans, icons, image treatment, and item ordering; the same actions are available by right-click or Shift+F10. Mobile authors use the visible Actions button while native long-press text selection remains available. Shift+right-click opens the browser menu. Gallery entries: `content-columns`, `content-bento`, and the combined `content-layout`.

## Destination buttons and card sections

Use a button for a clear next step, retaining a normal Markdown link as its editable contents:

`````markdown
::::actions
:::button
[Join the consortium](/join/)
:::
:::button variant=secondary
[Explore our work](/wg/)
:::
::::
`````

Button variants are `primary` (the default), `secondary`, `ghost`, and `link`. These use the existing PKIC `ButtonLink`; ordinary prose links keep their normal presentation. Labels are plain text. Unsafe destinations, extra paragraphs, images, and formatted labels inside a button are rejected. The Link toolbar menu inserts a text link or button; select an existing button and open Actions for Edit button and Button style. Its text is editable directly, while Edit button updates its destination through the shared form contract.

Cards can contain one `:::card-header` and one `:::card-footer`. Keep the header near the start and the footer after the body; footer content may include notes or an actions group. Both sections contain ordinary editable Markdown. Actions → Card options can add missing sections. Footers align at the bottom of equal-height cards without changing reading order. Native images remain editable; `media=image` presents the leading image as a cover and `media=logo` preserves logo proportions and artwork colors.

The `content-actions` gallery entry shows icon, image, and logo cards, headers and footers, primary/secondary actions, and their complete editable source.

Use the parent skill for the component implementation map and verification requirements.
