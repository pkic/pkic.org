import { useEffect } from "preact/hooks";
import { RoleCreate } from "./roles/RoleCreate";
import { RoleDetail } from "./roles/RoleDetail";
import { RoleList } from "./roles/RoleList";

/** Reserved role-id segment that routes to the creation view instead of a role's detail. */
const NEW_ROLE_SEGMENT = "new";

/** Redirects back to the roles list from an effect, not render — see its call site below. */
function RoleAccessRedirect({ onNavigate }: { onNavigate: (roleSegment?: string) => void }) {
  useEffect(() => onNavigate(), [onNavigate]);
  return null;
}

/**
 * Portal route adapter for the global roles surface: list-first, with
 * creation and per-role detail (fields, assignees, assignment) both routed
 * through `roleSegment` instead of rendering open by default. The three
 * views themselves live in ./roles/ — this file only picks which one to
 * render for a given `roleSegment`.
 */
export function Roles({
  canGrant = true,
  canRevoke = true,
  roleSegment,
  onNavigate = () => {},
}: {
  canGrant?: boolean;
  canRevoke?: boolean;
  /** `undefined` for the list, `"new"` for creation, or a role id for its detail. */
  roleSegment?: string;
  /** Navigates within the roles surface; omit the segment to return to the list. */
  onNavigate?: (roleSegment?: string) => void;
} = {}) {
  if (roleSegment === NEW_ROLE_SEGMENT) {
    if (!canGrant) {
      // Navigating away belongs in an effect, not render (mirrors
      // FormsRedirect in shell/PortalShell.tsx's sibling Forms.tsx route).
      return <RoleAccessRedirect onNavigate={onNavigate} />;
    }
    return <RoleCreate onCreated={(roleId) => onNavigate(roleId)} onCancel={() => onNavigate()} />;
  }

  if (roleSegment) {
    return <RoleDetail roleId={roleSegment} canGrant={canGrant} canRevoke={canRevoke} onBack={() => onNavigate()} />;
  }

  return (
    <RoleList
      canGrant={canGrant}
      canRevoke={canRevoke}
      onOpenRole={(roleId) => onNavigate(roleId)}
      onCreateNew={() => onNavigate(NEW_ROLE_SEGMENT)}
    />
  );
}
