import { h, type ComponentChildren } from "preact";

interface TableProps {
  heads: string[];
  empty?: string;
  children?: ComponentChildren;
}

export function Table({ heads, empty = "No data", children }: TableProps) {
  const hasRows = children !== undefined && children !== null && children !== false;
  return (
    <div class="tbl-wrap">
      <table class="table table-sm table-hover mb-0">
        <thead class="table-light">
          <tr>
            {heads.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hasRows ? (
            children
          ) : (
            <tr>
              <td colspan={heads.length} class="text-center text-muted fst-italic py-3">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
