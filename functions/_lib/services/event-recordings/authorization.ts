import { permissionsAuthorizationEvidence, requirePermission, guardPermissionDatabase } from "../../auth/permissions";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";

/** Workers use the same current event grant with a canonical user actor, without retaining a browser session. */
export function recordingManagementEvidence(actor: UserBackedAuthAdmin, eventId: string) {
  return permissionsAuthorizationEvidence(actor, [
    { permission: "events:manage", context: { type: "event", id: eventId } },
  ]);
}

/** App-wide provider metadata requires a global grant; an event association does not yet exist. */
export function recordingProviderManagementEvidence(actor: UserBackedAuthAdmin) {
  return permissionsAuthorizationEvidence(actor, [{ permission: "events:manage" }]);
}

export function humanRecordingProviderDatabase(db: DatabaseLike, actor: UserBackedAuthAdmin) {
  if (!actor.sessionId) throw new AppError(403, "RECORDING_SESSION_REQUIRED", "A current user session is required.");
  requirePermission(actor, "events:manage");
  return guardPermissionDatabase(
    db,
    actor,
    [{ permission: "events:manage" }],
    () => new AppError(403, "RECORDING_AUTHORIZATION_CHANGED", "Recording management access changed."),
  );
}

export function humanRecordingDatabase(db: DatabaseLike, actor: UserBackedAuthAdmin, eventId: string) {
  if (!actor.sessionId) throw new AppError(403, "RECORDING_SESSION_REQUIRED", "A current user session is required.");
  requirePermission(actor, "events:manage", { type: "event", id: eventId });
  return guardPermissionDatabase(
    db,
    actor,
    [{ permission: "events:manage", context: { type: "event", id: eventId } }],
    () => new AppError(403, "RECORDING_AUTHORIZATION_CHANGED", "Recording management access changed."),
  );
}
