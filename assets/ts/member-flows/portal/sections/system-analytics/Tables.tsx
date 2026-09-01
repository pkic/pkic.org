/**
 * The two count tables the analytics surfaces share.
 *
 * Column `className`s speak the design system's vocabulary (`pk-mono`,
 * `pk-end`) rather than Bootstrap's: `components/Table` turns the first into a
 * cell utility and the second into the column's alignment, so the count column
 * stays monospaced and right-aligned once the surface stops loading Bootstrap.
 */

import { Badge } from "../../../../components/Badge";
import { DataTable } from "../../../../components/Table";
// `pk-mono` is defined in Content.css, which ships in a lazy chunk. A module
// that writes the class name imports the stylesheet itself.
import "../../../../ui/Content.css";

export function StatusTable({
  entries,
  caption = "Counts by status",
}: {
  entries: Array<[string, number]>;
  caption?: string;
}) {
  return (
    <DataTable
      caption={caption}
      columns={[
        { header: "Status", cell: (entry) => <Badge status={entry[0]} /> },
        {
          header: { label: "Count", className: "pk-end" },
          cell: (entry) => entry[1],
          className: "pk-mono pk-end",
        },
      ]}
      data={entries}
      empty="None"
    />
  );
}

export function SimpleTable({
  rows,
  heads = ["Item", "Count"],
  caption,
}: {
  rows: Array<[string, string]>;
  heads?: [string, string];
  /** Names the table. Defaults to the pairing the columns describe. */
  caption?: string;
}) {
  return (
    <DataTable
      caption={caption ?? `${heads[1]} by ${heads[0].toLowerCase()}`}
      columns={[
        { header: heads[0], cell: (row) => row[0] },
        {
          header: { label: heads[1], className: "pk-end" },
          cell: (row) => row[1],
          className: "pk-mono pk-end",
        },
      ]}
      data={rows}
      empty="No data"
    />
  );
}
