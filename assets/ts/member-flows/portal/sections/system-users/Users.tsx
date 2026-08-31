import { usePortalHashLocation } from "../../hash-location";
import { UserDetail, type UserPermissions } from "./UserDetail";
import { UsersList } from "./UsersList";

export function Users({ userId, permissions }: { userId?: string; permissions: UserPermissions }) {
  const [, navigate] = usePortalHashLocation();

  if (userId) {
    return <UserDetail userId={userId} permissions={permissions} onBack={() => navigate("/users")} />;
  }

  if (!permissions.canRead) {
    return <p class="text-muted">User records require the users:read permission.</p>;
  }

  return (
    <section>
      <UsersList
        canWrite={permissions.canWrite}
        canGrantAccess={permissions.canGrantAccess}
        onViewUser={(id) => navigate(`/users/${encodeURIComponent(id)}`)}
      />
    </section>
  );
}
