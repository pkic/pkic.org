import { usePortalHashLocation } from "../../hash-location";
import { PageHeader } from "../../../../ui/PageHeader";
import { UserDetail, type UserPermissions } from "./UserDetail";
import { UsersList } from "./UsersList";

export function Users({ userId, permissions }: { userId?: string; permissions: UserPermissions }) {
  const [, navigate] = usePortalHashLocation();

  if (userId) {
    return <UserDetail userId={userId} permissions={permissions} />;
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
      <PageHeader title="Users" />
      <UsersList
        canWrite={permissions.canWrite}
        canGrantAccess={permissions.canGrantAccess}
        onViewUser={(id) => navigate(`/users/${encodeURIComponent(id)}`)}
      />
    </section>
  );
}
