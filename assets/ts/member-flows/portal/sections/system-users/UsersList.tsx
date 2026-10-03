import { ApiDataTable } from "../../../../components/ApiDataTable";
import { PersonCell, personDisplayName } from "../../../../components/PersonCell";
import { ButtonLink } from "../../../../ui/Button";
import { fmtDate } from "../../ui";
import {
  USER_TYPE_LABELS,
  USER_TYPE_VALUES,
  usersListResponseSchema,
  type UserListItem,
} from "../../../../../shared/schemas/user-management";
import { usePortalHashLocation } from "../../hash-location";

/**
 * A column filter over a whole vocabulary, plus the "no filter" choice.
 *
 * The values are the contract's, so a vocabulary that grows is offered here
 * without anyone remembering to add a line — which is the defect issue #24
 * reported against the membership categories. The empty value is the
 * control's own, not one of the contract's.
 */
function filterOptions<Value extends string>(
  values: readonly Value[],
  everything: string,
  label: (value: Value) => string,
): { value: string; label: string }[] {
  return [{ value: "", label: everything }, ...values.map((value) => ({ value, label: label(value) }))];
}

/**
 * Who the person represents, as names: "Digitorus", "Entrust, HID + 2 more".
 * A name identifies which Ada this is; the count of identities it replaces
 * did not, and nearly everyone has exactly one.
 */
function representation(user: UserListItem): string {
  const named = user.organizationNames.join(", ");
  const more = user.organizationCount - user.organizationNames.length;
  if (named && more > 0) return `${named} + ${String(more)} more`;
  if (named) return named;
  if (user.organizationCount > 0) return `${String(user.organizationCount)} individual`;
  return "";
}

export function UsersList({ canWrite, canGrantAccess }: { canWrite: boolean; canGrantAccess: boolean }) {
  const [, navigate] = usePortalHashLocation();

  return (
    <ApiDataTable
      caption="User accounts"
      urlState="users"
      endpoint="/api/v1/users"
      responseSchema={usersListResponseSchema}
      resolve={(data) => data.users}
      resolvePage={(data) => data.page}
      paginate
      searchPlaceholder="email or name"
      createAction={canWrite ? { label: "Create user", onSelect: () => navigate("/users/new") } : undefined}
      toolbar={
        canGrantAccess
          ? () => (
              <ButtonLink href={usePortalHashLocation.hrefs("/settings/access-control/people")} size="sm">
                Manage access
              </ButtonLink>
            )
          : undefined
      }
      columns={[
        {
          header: "Person",
          cell: (user) => (
            <PersonCell
              firstName={user.first_name}
              lastName={user.last_name}
              email={user.email}
              headshotUrl={user.headshotUrl}
            />
          ),
          sort: { asc: "last_name", desc: "-last_name" },
        },
        {
          // Names, not counts: the column says which organizations the person
          // represents, and its filter narrows the list to members, event
          // attendees or contacts — the same query the toolbar select used to
          // send, now where the reader looks for it.
          header: "Represents",
          cell: (user) => {
            if (user.type === "member") return representation(user);
            if (user.type === "event_attendee") return <span class="pk-muted">Event attendee</span>;
            return <span class="pk-muted">Contact only</span>;
          },
          width: "fit",
          filter: {
            param: "type",
            options: filterOptions(USER_TYPE_VALUES, "Everyone", (type) => USER_TYPE_LABELS[type]),
          },
        },
        {
          header: "Since",
          cell: (user) => fmtDate(user.created_at),
          // A date has a bounded length, so the column says that rather than
          // wearing `pk-nowrap` and still claiming a share of a wide screen.
          // It also keeps the table's own ink and size: the row already shows
          // one line of quiet grey under the name, and a second one left
          // nothing in the row reading as the record's own data.
          width: "fit",
          sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
        },
      ]}
      empty="No users found"
      rowKey={(user) => user.id}
      rowAction={(user) => ({
        label: `View ${personDisplayName(user.first_name, user.last_name, user.email)}`,
        href: usePortalHashLocation.hrefs(`/users/${encodeURIComponent(user.id)}`),
      })}
    />
  );
}
