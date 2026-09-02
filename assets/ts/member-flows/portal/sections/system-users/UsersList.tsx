import { useRef } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { PersonCell, personDisplayName } from "../../../../components/PersonCell";
import { RowActions } from "../../../../ui/RowActions";
import { patchJson } from "../../../../shared/api-client";
import { fmtDate, toast } from "../../ui";
import {
  userUpdateResponseSchema,
  usersListResponseSchema,
  type UserListItem,
} from "../../../../../shared/schemas/user-management";

/** Only noteworthy roles get a label; the default "user" stays quiet. */
function roleLabel(role: string): string | null {
  if (role === "admin") return "Administrator";
  if (role === "guest") return "Guest";
  return null;
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

export function UsersList({
  onViewUser,
  canWrite,
  canGrantAccess,
}: {
  onViewUser: (id: string) => void;
  canWrite: boolean;
  canGrantAccess: boolean;
}) {
  const tableRef = useRef<ApiTableActions | null>(null);

  async function updateRole(user: UserListItem, newRole: "admin" | "user"): Promise<void> {
    const name = personDisplayName(user.first_name, user.last_name, user.email);
    const confirmed = await confirmAction(
      newRole === "admin"
        ? {
            title: `Make ${name} an administrator?`,
            consequences: [
              "They gain every administrative permission across the portal",
              "The change takes effect on their next request",
            ],
            confirmLabel: "Grant administrator role",
            tone: "primary",
          }
        : {
            title: `Remove the administrator role from ${name}?`,
            consequences: [
              "They keep their account and any individually granted permissions",
              "They lose the blanket administrative access immediately",
            ],
            confirmLabel: "Revoke administrator role",
          },
    );
    if (!confirmed) return;
    try {
      await patchJson(`/api/v1/users/${encodeURIComponent(user.id)}`, { role: newRole }, userUpdateResponseSchema);
      toast(
        newRole === "admin" ? `${name} is now an administrator` : `Administrator role removed from ${name}`,
        "success",
      );
      await tableRef.current?.reload();
    } catch (error) {
      toast((error as Error).message, "error");
    }
  }

  return (
    <ApiDataTable
      caption="User accounts"
      urlState="users"
      endpoint="/api/v1/users"
      responseSchema={usersListResponseSchema}
      resolve={(data) => data.users}
      resolvePage={(data) => data.page}
      paginate
      actionsRef={tableRef}
      searchPlaceholder="email or name"
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
            options: [
              { value: "", label: "Everyone" },
              { value: "member", label: "Members" },
              { value: "event_attendee", label: "Event attendees" },
              { value: "contact_only", label: "Contacts only" },
            ],
          },
        },
        {
          header: "Role",
          cell: (user) => roleLabel(user.role) ?? <span class="pk-muted">User</span>,
          width: "fit",
          filter: {
            param: "role",
            options: [
              { value: "", label: "All roles" },
              { value: "admin", label: "Administrators" },
              { value: "user", label: "Users" },
              { value: "guest", label: "Guests" },
            ],
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
        {
          header: "",
          cell: (user) => (
            <RowActions
              subject={personDisplayName(user.first_name, user.last_name, user.email)}
              actions={
                canWrite && canGrantAccess
                  ? user.role === "admin"
                    ? [
                        {
                          id: "revoke-admin",
                          label: "Revoke administrator role",
                          onSelect: () => void updateRole(user, "user"),
                        },
                      ]
                    : [
                        {
                          id: "grant-admin",
                          label: "Grant administrator role",
                          onSelect: () => void updateRole(user, "admin"),
                        },
                      ]
                  : []
              }
            />
          ),
        },
      ]}
      empty="No users found"
      rowKey={(user) => user.id}
      rowAction={(user) => ({
        label: `View ${personDisplayName(user.first_name, user.last_name, user.email)}`,
        onSelect: () => onViewUser(user.id),
      })}
    />
  );
}
