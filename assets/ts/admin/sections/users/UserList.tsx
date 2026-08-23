import { useRef, useState } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../components/ApiDataTable";
import { normalizeProfileLinks } from "../../../shared/widgets/profile-links";
import { api } from "../../api";
import { fmt, toast } from "../../ui";
import { adminUserUpdateResponseSchema, usersListResponseSchema } from "../../../../shared/schemas/admin-users";

const ROLE_COLOR: Record<string, string> = { admin: "danger", user: "secondary", guest: "light" };

export function UserList({ onViewUser }: { onViewUser: (id: string) => void }) {
  const [roleFilter, setRoleFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const tableRef = useRef<ApiTableActions | null>(null);

  async function updateRole(userId: string, newRole: string, select: HTMLSelectElement) {
    const previousRole = select.dataset.currentRole ?? select.value;
    try {
      await api(`/api/v1/admin/users/${userId}`, adminUserUpdateResponseSchema, {
        method: "PATCH",
        body: JSON.stringify({ role: newRole }),
      });
      select.dataset.currentRole = newRole;
      toast(`Role updated to '${newRole}'`, "success");
    } catch (error) {
      toast((error as Error).message, "error");
      select.value = previousRole;
    }
  }

  return (
    <ApiDataTable
      endpoint="/api/v1/admin/users"
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
            value={roleFilter}
            onChange={(event) => {
              setRoleFilter((event.target as HTMLSelectElement).value);
              resetPage();
            }}
          >
            <option value="">All roles</option>
            <option value="admin">Admin</option>
            <option value="user">User</option>
            <option value="guest">Guest</option>
          </select>
          <select
            class="form-select form-select-sm w-auto"
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
          header: "Email",
          cell: (user) => <span>{user.email}</span>,
          className: "mono adm-user-email",
          sort: { asc: "email", desc: "-email" },
        },
        {
          header: "Name",
          cell: (user) => [user.first_name, user.last_name].filter(Boolean).join(" ") || "—",
          className: "fw-semibold",
          sort: { asc: "last_name", desc: "-last_name" },
        },
        {
          header: "Organization",
          cell: (user) => user.organization_name ?? "—",
          className: "small text-muted",
          sort: { asc: "organization_name", desc: "-organization_name" },
        },
        {
          header: "Type",
          cell: (user) => {
            if (user.membership) {
              return (
                <>
                  <span class="badge text-bg-success mono">{user.membership.membershipCategory}</span>
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
                <span class="badge text-bg-info">
                  Event attendee · {user.eventParticipationCount} event{user.eventParticipationCount === 1 ? "" : "s"}
                </span>
              );
            }
            return <span class="text-muted small fst-italic">Contact</span>;
          },
        },
        {
          header: "Links",
          cell: (user) => {
            const count = normalizeProfileLinks(user.links).length;
            return count > 0 ? (
              <span class="badge text-bg-info" title={`${count} profile link${count === 1 ? "" : "s"}`}>
                {count}
              </span>
            ) : (
              <span class="text-muted small">—</span>
            );
          },
          className: "text-center",
        },
        {
          header: "Role",
          cell: (user) => <span class={`badge text-bg-${ROLE_COLOR[user.role] ?? "secondary"}`}>{user.role}</span>,
          sort: { asc: "role", desc: "-role" },
        },
        {
          header: "Since",
          cell: (user) => fmt(user.created_at),
          className: "mono",
          sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
        },
        {
          header: "",
          cell: (user) => (
            <div onClick={(event) => event.stopPropagation()}>
              <select
                class="form-select form-select-sm d-inline-block adm-user-role-select"
                value={user.role}
                data-current-role={user.role}
                onChange={(event) => {
                  event.stopPropagation();
                  void updateRole(
                    user.id,
                    (event.target as HTMLSelectElement).value,
                    event.target as HTMLSelectElement,
                  );
                }}
              >
                <option value="admin">admin</option>
                <option value="user">user</option>
                <option value="guest">guest</option>
              </select>
            </div>
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
