import { PageHeader } from "../../../../ui/PageHeader";
import { EmailAddressAddForm } from "../EmailAddressAddForm";
import { UserDetail, type UserPermissions } from "./UserDetail";
import { UsersList } from "./UsersList";
import { UserCreateForm } from "./UserCreateForm";
import { UserProfileShowcase } from "./UserProfileShowcase";
import { IdentityProfileEditView } from "./IdentityProfileEditView";
import { IdentityPublicProfileView } from "./IdentityPublicProfileView";
import { IdentityProfilePage } from "./IdentityProfilePage";

export function Users({
  userId,
  section,
  segment,
  view,
  permissions,
  viewerUserId,
}: {
  userId?: string;
  /**
   * A page under the record: `profile`, `edit`, or `affiliations` with segment
   * `emails` with segment `new` (adding an email
   * address). Under `profile`, an identity ID with view
   * `edit` is the owner's edit view of that identity; under `affiliations`,
   * an identity ID with view `public-profile` is the staff view that hides it
   * from, or shows it on, the public profile, and view `profile` is the page that edits its profile.
   */
  section?: string;
  segment?: string;
  view?: string;
  permissions: UserPermissions;
  /** Who is reading. A record about the reader offers different things. */
  viewerUserId?: string;
}) {
  if (userId === "new") {
    return permissions.canRead && permissions.canWrite ? (
      <UserCreateForm />
    ) : (
      <p>User creation requires user write permission.</p>
    );
  }
  if (userId && section === "emails" && segment === "new") {
    const isSelf = viewerUserId === userId;
    return isSelf || permissions.canWrite ? (
      <EmailAddressAddForm userId={userId} isSelf={isSelf} />
    ) : (
      <p>Adding an email address requires user write permission.</p>
    );
  }
  if (userId && section === "affiliations" && segment && view === "public-profile") {
    return permissions.canManageMembership ? (
      <IdentityPublicProfileView userId={userId} identityId={segment} />
    ) : (
      <p class="pk-muted">Hiding an identity from the public profile requires the membership:write permission.</p>
    );
  }
  if (userId && section === "affiliations" && segment && view === "profile") {
    const isSubject = userId === "current" || viewerUserId === userId;
    return isSubject || permissions.canManageMembership ? (
      <IdentityProfilePage userId={userId} identityId={segment} viewerIsSubject={isSubject} />
    ) : (
      <p class="pk-muted">Editing an identity's profile requires the membership:write permission.</p>
    );
  }
  if (userId && section === "profile" && segment && view === "edit" && viewerUserId === userId) {
    return <IdentityProfileEditView userId={userId} identityId={segment} />;
  }
  if (userId && section === "profile") {
    return <UserProfileShowcase userId={userId} canRead={permissions.canRead || viewerUserId === userId} />;
  }
  if (userId) {
    return <UserDetail userId={userId} section={section} permissions={permissions} viewerUserId={viewerUserId} />;
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
        description="Find a person or create a user record, then manage their profile and affiliations."
      />
      <UsersList canWrite={permissions.canWrite} canGrantAccess={permissions.canGrantAccess} />
    </section>
  );
}
