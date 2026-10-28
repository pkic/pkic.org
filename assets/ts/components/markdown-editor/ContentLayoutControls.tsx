import type { Editor } from "@tiptap/core";
import {
  contentCardVariantSchema,
  contentColumnWidthSchema,
  contentIconSchema,
  contentGridLayoutSchema,
  contentMediaSchema,
  contentSpanSchema,
  contentLayoutSchema,
} from "../../../shared/schemas/content-layout";
import { Menu, type MenuItem } from "../../ui/Menu";
import { IconTextColumns, IconContentGrid } from "../icons";

/** Layout choices live beside the selected authored block, not in a separate form. */
export function ContentLayoutControls({ editor }: { editor: Editor }) {
  const selection = editor.state.selection.$from;
  let layoutDepth = selection.depth;
  while (layoutDepth > 0 && !["cards", "columns", "grid"].includes(selection.node(layoutDepth).type.name))
    layoutDepth--;
  if (!layoutDepth) return null;
  const layout = selection.node(layoutDepth).type.name;
  const itemName = layout === "cards" ? "card" : "item";
  let itemDepth = selection.depth;
  while (itemDepth > layoutDepth && selection.node(itemDepth).type.name !== itemName) itemDepth--;
  if (itemDepth <= layoutDepth) itemDepth = 0;
  const itemPosition = itemDepth ? selection.before(itemDepth) : null;
  const item = itemDepth ? selection.node(itemDepth) : null;
  const parent = itemDepth ? selection.node(itemDepth - 1) : null;
  const choices: MenuItem[] = [
    {
      id: "columns",
      label: "Column count",
      children: contentLayoutSchema.options.map((value) => ({
        id: `columns-${value}`,
        label: value === "auto" ? "Automatic" : `${value} column${value === "1" ? "" : "s"}`,
        checked: (editor.getAttributes(layout).count ?? "auto") === value,
        onSelect: () => {
          editor.chain().focus().updateAttributes(layout, { count: value }).run();
        },
      })),
    },
  ];
  if (layout === "columns")
    choices.push({
      id: "column-width",
      label: "Preferred column width",
      children: contentColumnWidthSchema.options.map((value) => ({
        id: `width-${value}`,
        label: value === "auto" ? "Automatic" : value,
        checked: (editor.getAttributes(layout).width ?? "auto") === value,
        onSelect: () => {
          editor.chain().focus().updateAttributes(layout, { width: value }).run();
        },
      })),
    });
  if (layout === "cards") {
    choices.push({
      id: "card-layout",
      label: "Arrangement",
      children: contentGridLayoutSchema.options.map((value) => ({
        id: `layout-${value}`,
        label: value === "bento" ? "Bento" : "Grid",
        checked: (editor.getAttributes("cards").layout ?? "grid") === value,
        onSelect: () => {
          editor.chain().focus().updateAttributes("cards", { layout: value }).run();
        },
      })),
    });
    if (item) {
      choices.push({
        id: "card-icon",
        label: "Card icon",
        children: [
          {
            id: "icon-none",
            label: "No icon",
            checked: !editor.getAttributes("card").icon,
            onSelect: () => {
              editor.chain().focus().updateAttributes("card", { icon: null }).run();
            },
          },
          ...contentIconSchema.options.map((value) => ({
            id: `icon-${value}`,
            label: value.replaceAll("-", " "),
            checked: editor.getAttributes("card").icon === value,
            onSelect: () => {
              editor.chain().focus().updateAttributes("card", { icon: value }).run();
            },
          })),
        ],
      });
      choices.push({
        id: "card-media",
        label: "Image treatment",
        children: contentMediaSchema.options.map((value) => ({
          id: `media-${value}`,
          label: value === "logo" ? "Logo: preserve proportions" : "Image",
          checked: (editor.getAttributes("card").media ?? "image") === value,
          onSelect: () => {
            editor.chain().focus().updateAttributes("card", { media: value }).run();
          },
        })),
      });
    }
    const styleChoices = (name: "cards" | "card"): MenuItem[] =>
      contentCardVariantSchema.options.map((value) => ({
        id: `${name}-${value}`,
        label: value[0].toUpperCase() + value.slice(1),
        checked: (editor.getAttributes(name).variant ?? (name === "cards" ? "default" : null)) === value,
        onSelect: () => {
          editor.chain().focus().updateAttributes(name, { variant: value }).run();
        },
      }));
    choices.push({ id: "grid-style", label: "Default card style", children: styleChoices("cards") });
    if (item)
      choices.push({
        id: "card-style",
        label: "This card’s style",
        children: [
          {
            id: "card-inherit",
            label: "Use grid default",
            checked: !editor.getAttributes("card").variant,
            onSelect: () => {
              editor.chain().focus().updateAttributes("card", { variant: null }).run();
            },
          },
          ...styleChoices("card"),
        ],
      });
  }
  if (item && (layout === "grid" || editor.getAttributes("cards").layout === "bento")) {
    for (const attribute of ["span", "rows"] as const)
      choices.push({
        id: `item-${attribute}`,
        label: attribute === "span" ? "Item width" : "Item height",
        children: contentSpanSchema.options.map((value) => ({
          id: `${attribute}-${value}`,
          label: `${value} ${attribute === "span" ? "column" : "row"}${value === "2" ? "s" : ""}`,
          checked: (editor.getAttributes(itemName)[attribute] ?? "1") === value,
          onSelect: () => {
            editor
              .chain()
              .focus()
              .updateAttributes(itemName, { [attribute]: value })
              .run();
          },
        })),
      });
  }
  if (layout !== "columns" && item && itemPosition !== null && parent) {
    const position = itemPosition;
    choices.push(
      {
        id: "add-item",
        label: layout === "cards" ? "Add card" : "Add grid item",
        separatorBefore: true,
        onSelect: () => {
          editor
            .chain()
            .focus()
            .insertContentAt(position + item.nodeSize, {
              type: itemName,
              content: [{ type: "paragraph", content: [{ type: "text", text: "Add your content." }] }],
            })
            .run();
        },
      },
      {
        id: "remove-item",
        label: layout === "cards" ? "Remove this card" : "Remove this grid item",
        disabled: parent.childCount < 2,
        onSelect: () => {
          editor
            .chain()
            .focus()
            .deleteRange({ from: position, to: position + item.nodeSize })
            .run();
        },
      },
    );
    const index = selection.index(itemDepth - 1);
    for (const direction of [-1, 1] as const)
      choices.push({
        id: `move-${direction}`,
        label: direction < 0 ? "Move earlier" : "Move later",
        disabled: index + direction < 0 || index + direction >= parent.childCount,
        onSelect: () => {
          const sibling = parent.child(index + direction);
          const destination = direction < 0 ? position - sibling.nodeSize : position + sibling.nodeSize;
          const transaction = editor.state.tr.delete(position, position + item.nodeSize).insert(destination, item);
          editor.view.dispatch(transaction);
          editor.commands.setTextSelection(destination + 2);
          editor.commands.focus();
        },
      });
  }
  return (
    <div class="pk-markdown-editor__toolbar" data-density="compact" role="group" aria-label="Layout editing">
      <Menu label="Layout options" items={choices}>
        {layout === "columns" ? <IconTextColumns /> : <IconContentGrid />}
      </Menu>
    </div>
  );
}
