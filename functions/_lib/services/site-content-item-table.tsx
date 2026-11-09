import { renderToStringAsync as render } from "preact-render-to-string";
import { ContentItemTable } from "../../../assets/ts/site/ContentComponents";
import { objectValue, type ContentCall } from "./site-shortcodes";

/** A table of identified items; every row is a permalink target and a feedback item. */
export async function renderContentItemTable(
  call: ContentCall,
  inlineMarkdownHtml: (value: string) => Promise<string>,
): Promise<string> {
  const data = objectValue(call.inner);
  const columns = Array.isArray(data.columns) ? data.columns.map(String) : [];
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items = await Promise.all(
    rawItems.map(async (value) => {
      const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
      const cells = Array.isArray(item.cells) ? item.cells : [];
      return {
        id: String(item.id ?? ""),
        cellsHtml: await Promise.all(columns.map((_column, index) => inlineMarkdownHtml(String(cells[index] ?? "")))),
      };
    }),
  );
  if (!columns.length || items.some((item) => !item.id))
    throw new Error("An item table needs columns and an id for every item");
  return render(<ContentItemTable columns={columns} items={items} />);
}
