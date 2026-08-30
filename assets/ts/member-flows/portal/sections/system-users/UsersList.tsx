import { useRef, useState } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { PersonCell, personDisplayName } from "../../../../components/PersonCell";
import { RowActions } from "../../../../components/RowActions";
import { patchJson } from "../../../../shared/api-client";
import { fmt, toast } from "../../ui";
import {
  userUpdateResponseSchema,
  usersListResponseSchema,
  type UserListItem,
} from "../../../../../shared/schemas/user-management";

/** Only noteworthy roles get a label; the default "user" stays quiet. */
function roleStatus(role: string): string | null {
  if (role === "admin") return "Administrator";
  if (role === "guest") return "Guest";
  return null;
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
  const [roleFilter, setRoleFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
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
      endpoint="/api/v1/users"
      responseSchema={usersListResponseSchema}
      resolve={(data) => data.users}
      resolvePage={(data) => data.page}
      paginate
      actionsRef={tableRef}
      searchPlaceholder="email or name"
      params={{ ...(roleFilter ? { role: roleFilter } : {}), ...(typeFilter ? { type: typeFilter } : {}) }}
      toolbar={({ resetPage }) => (
        <>
          <select
            class="form-select form-select-sm w-auto"
            aria-label="Filter by role"
            value={roleFilter}
            onChange={(event) => {
              setRoleFilter((event.target as HTMLSelectElement).value);
              resetPage();
            }}
          >
            <option value="">All roles</option>
            <option value="admin">Administrators</option>
            <option value="user">Users</option>
            <option value="guest">Guests</option>
          </select>
          <select
            class="form-select form-select-sm w-auto"
            aria-label="Filter by participation"
            value={typeFilter}
            onChange={(event) => {
              setTypeFilter((event.target as HTMLSelectElement).value);
              resetPage();
            }}
          >
            <option value="">All types</option>
            <option value="member">Members</option>
            <option value="event_attendee">Event attendees</option>
            <option value="contact_only">Contacts only</option>
          </select>
        </>
      )}
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
          header: "Organization",
          cell: (user) => user.organization_name ?? "—",
          className: "small text-muted",
          sort: { asc: "organization_name", desc: "-organization_name" },
        },
        {
          header: "Participation",
          cell: (user) => {
            if (user.membership) {
              return (
                <>
                  <span class="badge text-bg-success">{user.membership.membershipCategory}</span>
                  {user.membership.organizationName && (
                    <>
                      {" "}
                      <span class="small text-muted">{user.membership.organizationName}</span>
                    </>
                  )}
                </>
              );
            }
            if (user.type === "event_attendee") {
              return (
                <span class="small">
                  Event attendee · {user.eventParticipationCount} event{user.eventParticipationCount === 1 ? "" : "s"}
                </span>
              );
            }
            return <span class="text-muted small">Contact only</span>;
          },
        },
        {
          header: "Since",
          cell: (user) => fmt(user.created_at),
          className: "small text-muted",
          sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
        },
        {
          header: "",
          cell: (user) => (
            <RowActions
              label={`Actions for ${personDisplayName(user.first_name, user.last_name, user.email)}`}
              status={roleStatus(user.role)}
              actions={
                canWrite && canGrantAccess
                  ? user.role === "admin"
                    ? [
                        {
                          key: "revoke-admin",
                          label: "Revoke administrator role",
                          onSelect: () => void updateRole(user, "user"),
                        },
                      ]
                    : [
                        {
                          key: "grant-admin",
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
      rowClass={() => "adm-user-row"}
      onRowClick={(user) => onViewUser(user.id)}
    />
  );
}
