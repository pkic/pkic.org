import type { Column } from "../Table";
import { PersonCell } from "../../ui/PersonCell";

/** The same attendee identity and sort control in each registration roster. */
export function registrationPersonColumn<
  T extends { display_name: string | null; user_email: string | null; headshot_url?: string | null },
>(): Column<T> {
  return {
    header: "Attendee",
    cell: (row) => (
      <PersonCell
        name={row.display_name ?? row.user_email ?? "—"}
        avatarSrc={row.headshot_url ?? undefined}
        size="sm"
      />
    ),
    width: "primary",
    sort: { asc: "display_name", desc: "-display_name" },
  };
}
