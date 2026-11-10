import "./ContentItemTable.css";

export interface ContentItemTableRow {
  /** Stable identifier: the permalink target and the selection-feedback item. */
  id: string;
  /** Shown in the first column; the identifier itself unless a shorter reference reads better. */
  label: string;
  cellsHtml: string[];
}

/**
 * Identified items (questions, evidence) in the shared Markdown table presentation. Each row is a
 * permalink target; in a narrow column the rows become labeled records instead of squeezed columns.
 */
export function ContentItemTable({ columns, items }: { columns: string[]; items: ContentItemTableRow[] }) {
  const itemName = columns[0] ?? "Item";
  return (
    <div class="pk-table__scroll pk-table__scroll--prose pk-content-item-table__scroll">
      <table class="pk-table pk-content-item-table">
        <thead>
          <tr>
            <th scope="col">ID</th>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} id={item.id} data-content-item-id={item.id}>
              <td>
                <a
                  class="pk-content-item-table__id"
                  href={`#${item.id}`}
                  aria-label={`${itemName} ${item.id}`}
                  title={`${itemName} ${item.id}`}
                >
                  {item.label}
                </a>
              </td>
              {item.cellsHtml.map((html, index) => (
                <td key={columns[index]} data-label={columns[index]} dangerouslySetInnerHTML={{ __html: html }} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
