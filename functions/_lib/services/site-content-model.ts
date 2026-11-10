import type { ContentComponentContext } from "./site-components";
import type { ContentCall } from "./site-shortcodes";

/** Normative content from the pinned model version a page is published from. */
export async function renderModelContent(
  call: ContentCall,
  context: Pick<ContentComponentContext, "modelContent" | "sourcePath">,
  renderMarkdown: (markdown: string) => Promise<string>,
): Promise<string> {
  if (!context.modelContent)
    throw new Error(`${context.sourcePath} places model content outside a published model version`);
  return renderMarkdown(context.modelContent(call));
}
