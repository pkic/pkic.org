import { captureLogoutPushCleanup } from "./logout-push-cleanup";
import { beginUserLogout, readPendingUserLogout, readActiveUserSession } from "../../shared/pending-user-logout";
import { finishUserLogout } from "../../shared/finish-user-logout";
import { clearOperatorEligibilityManifests } from "./sections/events/detail/scanner/eligibility-manifest";
import { clearAuth, clearSignOutReturnPath, logoutNotice, portalSession } from "./state";
import type { PortalSession } from "./types";

export async function resumePendingUserLogout(): Promise<boolean> {
  const intent = await readPendingUserLogout();
  if (!intent) return false;
  if (portalSession.value?.sessionId === intent.sessionId) clearAuth();
  logoutNotice.value = "Signed out on this device. Connect to finish signing out.";
  const active = await readActiveUserSession();
  const blocksCurrent = !active || active.sessionId === intent.sessionId;
  if (!navigator.onLine) return blocksCurrent;
  try {
    const result = await finishUserLogout(intent);
    if (!result.settled) return blocksCurrent;
    logoutNotice.value =
      result.outcome === "revoked" || result.outcome === "already_ended"
        ? "You are signed out."
        : "Signed out on this device. Your earlier sign-in could not be ended with your current sign-in.";
    return false;
  } catch {
    return blocksCurrent;
  }
}

export async function signOutPortalSession(session: PortalSession): Promise<void> {
  const cleanupPush = captureLogoutPushCleanup(session.sessionId);
  await beginUserLogout({
    sessionId: session.sessionId,
    operatorUserId: session.identity.id,
    expiresAt: session.expiresAt,
  });
  // Never clear a different session established while storage was opening.
  if (portalSession.value?.sessionId === session.sessionId) {
    clearSignOutReturnPath();
    clearAuth();
  }
  logoutNotice.value = "Signed out on this device. Connect to finish signing out.";
  const pushCleanup = cleanupPush();
  try {
    const active = await readActiveUserSession();
    if (!active || active.sessionId === session.sessionId) await clearOperatorEligibilityManifests(session.identity.id);
  } catch {
    // The durable fence independently prevents reads, captures and uploads.
  }
  const [, pushCleaned] = await Promise.all([resumePendingUserLogout(), pushCleanup]);
  if (!pushCleaned) logoutNotice.value = "Signed out on this device. Browser notifications could not be disconnected.";
}
