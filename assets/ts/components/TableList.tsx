import type { ComponentChildren } from "preact";
import "../ui/DataTable.css";

/** One collection frame for its toolbar, bulk actions, rows and pagination. */
export function TableList({ caption, children }: { caption: string; children: ComponentChildren }) {
  return (
    <section class="pk pk-panel pk-table-list" aria-label={caption}>
      {children}
    </section>
  );
}
