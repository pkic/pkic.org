import { contentColumnExample, contentBentoExample, contentLayoutExample } from "./content-layout-example";
import { contentReadingExample } from "./content-reading-example";
import { useState } from "preact/hooks";
import { MarkdownEditor } from "../../components/markdown-editor/MarkdownInput";
import { Field } from "../Field";
import { Markdown } from "../Markdown";
import { Panel, PanelBody, PanelHeader } from "../Panel";
import type { PreviewSection } from "./PreviewShell";

const example = `## Preparing your contribution

Keep the purpose and intended audience clear.

:::aside
### Before you start
Read the [contribution guide](https://example.org/contributing/) first.

- Describe the problem you are solving.
- Link to supporting material.
  - Include the document version when available.

**Keep the complete explanation editable.**
:::

Continue with the main document here.`;

function EditableContentSpecimen({ initialValue }: { initialValue: string }) {
  const [markdown, setMarkdown] = useState(initialValue);
  return (
    <div class="pk-stack">
      <Panel>
        <PanelHeader title="Edit the page" />
        <PanelBody>
          <Field label="Page content">
            {(props) => (
              <MarkdownEditor
                {...props}
                name="page-content"
                label="Page content"
                initialValue={initialValue}
                onChange={setMarkdown}
              />
            )}
          </Field>
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader title="Published content" />
        <PanelBody>
          <Markdown markdown={markdown} layout="reading" />
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader title="Saved Markdown" />
        <PanelBody>
          <pre class="pk-code-block">
            <code>{markdown}</code>
          </pre>
        </PanelBody>
      </Panel>
    </div>
  );
}

export const contentSections: PreviewSection[] = [
  {
    id: "content-layout",
    title: "Editable columns and card grids",
    note: "Use Layout to choose text columns, size a grid or cards, or select a bento preset. Edit layout changes the arrangement while preserving content.",
    render: () => <EditableContentSpecimen initialValue={contentLayoutExample} />,
  },
  {
    id: "content-columns",
    title: "Flowing text columns",
    note: "One editable Markdown body, balanced across two or four columns. Width stays automatic unless a preferred width is chosen.",
    render: () => <EditableContentSpecimen initialValue={contentColumnExample} />,
  },
  {
    id: "content-bento",
    title: "Bento cards, icons, and logos",
    note: "Shared card styles with editable contents, featured spans, page-themed icons, and proportionate logos.",
    render: () => <EditableContentSpecimen initialValue={contentBentoExample} />,
  },
  {
    id: "content-prose",
    title: "Page content: shared reading layout",
    note: "Native Markdown with the same typography in the full editor and published preview. Tables and images can use more width than the text.",
    render: () => <EditableContentSpecimen initialValue={contentReadingExample} />,
  },
  {
    id: "content-aside",
    title: "Editable page content: aside",
    note: "One Markdown block, shared presentation, and editable headings, paragraphs, links, and nested lists.",
    render: () => <EditableContentSpecimen initialValue={example} />,
  },
];
