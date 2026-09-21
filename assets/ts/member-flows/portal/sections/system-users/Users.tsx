import { PageHeader } from "../../../../ui/PageHeader";
import { UserDetail, type UserPermissions } from "./UserDetail";
import { UsersList } from "./UsersList";

export function Users({
  userId,
  section,
  segment,
  permissions,
  viewerUserId,
}: {
  userId?: string;
  /** A page under the record: `affiliations` with segment `new` is the identity grant. */
  section?: string;
  segment?: string;
  permissions: UserPermissions;
  /** Who is reading. A record about the reader offers different things. */
  viewerUserId?: string;
}) {
  if (userId) {
    return (
      <UserDetail
        userId={userId}
        section={section}
        segment={segment}
        permissions={permissions}
        viewerUserId={viewerUserId}
      />
    );
  }

  if (!permissions.canRead) {
    return (
      <div class="pk">
        <p class="pk-muted">User records require the users:read permission.</p>
      </div>
    );
  }

  return (
    <section class="pk pk-stack">
      <PageHeader
        title="Users"
        description="Accounts are created when someone signs in, applies, registers, or is invited. Manage existing accounts here."
      />
      <UsersList canWrite={permissions.canWrite} canGrantAccess={permissions.canGrantAccess} />
    </section>
  );
}
