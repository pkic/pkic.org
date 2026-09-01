import { useRef, useState } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { FilterSelect } from "../../../../components/FilterSelect";
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
      caption="User accounts"
      urlState="users"
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
          {/* A toolbar has no room for a stacked label, so each filter keeps
              its name in `aria-label` — through the shared control, which is
              the one place that decision is made. */}
          <FilterSelect
            ariaLabel="Filter by role"
            value={roleFilter}
            options={[
              { value: "", label: "All roles" },
              { value: "admin", label: "Administrators" },
              { value: "user", label: "Users" },
              { value: "guest", label: "Guests" },
            ]}
            onChange={(value) => {
              setRoleFilter(value);
              resetPage();
            }}
          />
          <FilterSelect
            ariaLabel="Filter by participation"
            value={typeFilter}
            options={[
              { value: "", label: "All types" },
              { value: "member", label: "Members" },
              { value: "event_attendee", label: "Event attendees" },
              { value: "contact_only", label: "Contacts only" },
            ]}
            onChange={(value) => {
              setTypeFilter(value);
              resetPage();
            }}
          />
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
          header: "Participation",
          cell: (user) => {
            if (user.activeIdentityCount > 0) {
              return (
                <span class="pk-small">
                  Member · {user.activeIdentityCount} active{" "}
                  {user.activeIdentityCount === 1 ? "identity" : "identities"}
                </span>
              );
            }
            if (user.type === "event_attendee") {
              return (
                <span class="pk-small">
                  Event attendee · {user.eventParticipationCount} event{user.eventParticipationCount === 1 ? "" : "s"}
                </span>
              );
            }
            return <span class="pk-muted pk-small">Contact only</span>;
          },
        },
        {
          header: "Since",
          cell: (user) => fmtDate(user.created_at),
          className: "pk-small pk-muted pk-nowrap",
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
