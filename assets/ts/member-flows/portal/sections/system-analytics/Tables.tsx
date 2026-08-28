import { Badge } from "../../../../components/Badge";
import { DataTable } from "../../../../components/Table";

export function StatusTable({ entries }: { entries: Array<[string, number]> }) {
  return (
    <DataTable
      columns={[
        { header: "Status", cell: (entry) => <Badge status={entry[0]} /> },
        {
          header: { label: "Count", className: "text-end" },
          cell: (entry) => entry[1],
          className: "mono text-end",
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
}: {
  rows: Array<[string, string]>;
  heads?: [string, string];
}) {
  return (
    <DataTable
      columns={[
        { header: heads[0], cell: (row) => row[0] },
        {
          header: { label: heads[1], className: "text-end" },
          cell: (row) => row[1],
          className: "mono text-end",
        },
      ]}
      data={rows}
      empty="No data"
    />
  );
}
