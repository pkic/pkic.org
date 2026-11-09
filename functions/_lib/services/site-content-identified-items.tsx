import { renderToStringAsync as render } from "preact-render-to-string";
import { ContentItemTable } from "../../../assets/ts/site/ContentItemTable";
import { ContentRequirements } from "../../../assets/ts/site/ContentRequirements";
import { objectList, objectValue, type ContentCall } from "./site-shortcodes";

/** A table of identified items; every row is a permalink target and a feedback item. */
export async function renderContentItemTable(
  call: ContentCall,
  inlineMarkdownHtml: (value: string) => Promise<string>,
): Promise<string> {
  const data = objectValue(call.inner);
  const columns = Array.isArray(data.columns) ? data.columns.map(String) : [];
  const items = await Promise.all(
    objectList(data.items).map(async (item) => {
      const cells = Array.isArray(item.cells) ? item.cells : [];
      const id = String(item.id ?? "");
      return {
        id,
        label: String(item.label ?? id),
        cellsHtml: await Promise.all(columns.map((_column, index) => inlineMarkdownHtml(String(cells[index] ?? "")))),
      };
    }),
  );
  if (!columns.length || items.some((item) => !item.id))
    throw new Error("An item table needs columns and an id for every item");
  return render(<ContentItemTable columns={columns} items={items} />);
}

/** Requirements that must all hold; `marker`, `label` and `includes` name what they define. */
export async function renderContentRequirements(
  call: ContentCall,
  inlineMarkdownHtml: (value: string) => Promise<string>,
): Promise<string> {
  const data = objectValue(call.inner);
  const includes = data.includes && typeof data.includes === "object" ? (data.includes as Record<string, unknown>) : {};
  const items = await Promise.all(
    objectList(data.items).map(async (item) => {
      const id = String(item.id ?? "");
      return {
        id,
        label: String(item.label ?? id),
        textHtml: await inlineMarkdownHtml(String(item.text ?? "")),
        noteHtml: item.note ? await inlineMarkdownHtml(String(item.note)) : undefined,
      };
    }),
  );
  if (!items.length || items.some((item) => !item.id || !item.textHtml))
    throw new Error("Requirements need an id and text for every item");
  return render(
    <ContentRequirements
      marker={data.marker == null ? undefined : String(data.marker)}
      label={typeof data.label === "string" ? data.label : undefined}
      introductionHtml={await inlineMarkdownHtml(String(data.introduction ?? ""))}
      includes={{
        labelHtml: await inlineMarkdownHtml(String(includes.label ?? "")),
        links: objectList(includes.links).map((link) => ({
          href: String(link.href ?? ""),
          label: String(link.label ?? ""),
        })),
      }}
      itemName={typeof data.item === "string" ? data.item : "Requirement"}
      items={items}
    />,
  );
}
