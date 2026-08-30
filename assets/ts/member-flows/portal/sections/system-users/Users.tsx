import { useHashLocation } from "wouter/use-hash-location";
import { UserDetail, type UserPermissions } from "./UserDetail";
import { UsersList } from "./UsersList";

export function Users({ userId, permissions }: { userId?: string; permissions: UserPermissions }) {
  const [, navigate] = useHashLocation();

  if (userId) {
    return <UserDetail userId={userId} permissions={permissions} onBack={() => navigate("/users")} />;
  }

  if (!permissions.canRead) {
    return <p class="text-muted">User records require the users:read permission.</p>;
  }

  return (
    <section aria-labelledby="system-users-heading">
      <h5 id="system-users-heading" class="mb-3">
        Users
      </h5>
      <UsersList
        canWrite={permissions.canWrite}
        canGrantAccess={permissions.canGrantAccess}
        onViewUser={(id) => navigate(`/users/${encodeURIComponent(id)}`)}
      />
    </section>
  );
}
