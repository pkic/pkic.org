import type { ComponentChildren } from "preact";
import "../ui/DataTable.css";

/** One collection frame for its toolbar, bulk actions, rows and pagination. */
export function TableList({
  caption,
  children,
  framed = true,
}: {
  caption: string;
  children: ComponentChildren;
  framed?: boolean;
}) {
  return (
    <section class={`pk pk-table-list ${framed ? "pk-panel" : "pk-table-list--unframed"}`} aria-label={caption}>
      {children}
    </section>
  );
}
