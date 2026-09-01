import { usePortalHashLocation } from "../../hash-location";
import { UserDetail, type UserPermissions } from "./UserDetail";
import { UsersList } from "./UsersList";

export function Users({ userId, permissions }: { userId?: string; permissions: UserPermissions }) {
  const [, navigate] = usePortalHashLocation();

  if (userId) {
    return <UserDetail userId={userId} permissions={permissions} onBack={() => navigate("/users")} />;
  }

  if (!permissions.canRead) {
    return (
      <div class="pk">
        <p class="pk-muted">User records require the users:read permission.</p>
      </div>
    );
  }

  return (
    <section class="pk">
      <UsersList
        canWrite={permissions.canWrite}
        canGrantAccess={permissions.canGrantAccess}
        onViewUser={(id) => navigate(`/users/${encodeURIComponent(id)}`)}
      />
    </section>
  );
}
