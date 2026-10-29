/** Native Markdown used to review the shared reading layout and edit/save behavior. */
export const contentReadingExample = `## Publishing working-group material

A useful working-group page explains **who it is for**, what readers can learn, and how they can contribute. Keep the main explanation easy to follow and give supporting material a clear place in the document.

The same publishing approach should serve every [working group](/wg/). Authors keep their content in Markdown, while PKIC provides a consistent presentation.

### Start with the reader

1. **New contributors** should begin with the purpose and terminology.
2. **Reviewers** need the proposed approach and the supporting evidence.
   - Link to the primary source.
   - Record the document version when one is available.
3. **Readers** need a clear explanation of what is established and what is still under discussion.

:::aside
### Keep the context with the content
A supporting note can contain **formatted text**, [links](/wg/), and lists. Its heading and explanation remain editable parts of the document.

- Explain an assumption.
- Describe a limitation.
:::

### Compare the available material

A comparison can use more of the page width than the surrounding paragraphs. On a phone, the table scrolls within the page.

| Material | Intended reader | Main purpose | Supporting evidence | Review stage |
| --- | --- | --- | --- | --- |
| Methodology | Contributors and reviewers | Explain the proposed approach | Primary sources and worked examples | Working draft |
| Use case | Implementers | Show the approach in context | Assumptions and expected outcomes | Open for discussion |
| Reference | All readers | Identify supporting material | Publisher, document version, and source link | Curated entry |

### Make examples reproducible

Use a short example to make an abstract explanation concrete. Keep field names such as \`version\` readable within the surrounding text.

\`\`\`json
{
  "name": "Example profile",
  "version": "working-draft",
  "evidence": "https://example.org/source"
}
\`\`\`

> A working draft makes the proposed approach available for discussion. Publication does not imply approval.

### Include supporting visuals

![An illustration of canal houses](/img/pqc/canal-houses.svg)

Choose visuals that help explain the subject, and provide an alternative description. Paragraphs retain their reading width even when a table or image uses more space.

### Continue the discussion

End with a clear next step: read the supporting material, propose a change, or contribute an example.
`;
