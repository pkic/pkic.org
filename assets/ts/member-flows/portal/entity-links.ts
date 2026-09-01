/**
 * Resolves a named entity to its canonical portal route, permission-aware,
 * so `EntityLink` can degrade to plain text when the viewer cannot reach the
 * target. Mirrors the access rules `PortalShell` already applies when
 * deciding whether to mount each route — see `portal-navigation.ts`.
 */
import {
  portalHasAnyGlobalPermission,
  portalHasGlobalPermission,
  portalSectionEnabled,
} from "./shell/portal-navigation";
import { portalSession } from "./state";

export function portalEntityHref(entityType: string, entityId: string | null | undefined): string | null {
  if (!entityId) return null;
  const session = portalSession.value;

  switch (entityType) {
    case "user":
      return portalHasGlobalPermission(session, "users:read") ? `/users/${encodeURIComponent(entityId)}` : null;
    case "group":
      return portalSectionEnabled(session, "groups") ? `/groups/${encodeURIComponent(entityId)}` : null;
    case "organization":
      return portalHasAnyGlobalPermission(session, ["organizations:read", "membership:write"])
        ? `/organizations/${encodeURIComponent(entityId)}`
        : null;
    case "membership_application":
    case "application":
      return portalSectionEnabled(session, "membership")
        ? `/membership/applications/${encodeURIComponent(entityId)}`
        : null;
    default:
      // Events, votes, and unrecognized types need an owning group to route
      // and none is available here — do not guess a URL.
      return null;
  }
}
