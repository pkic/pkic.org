import { readActiveUserSession } from "../../shared/pending-user-logout";
import { existingPushDeviceId, forgetPushDevice } from "./notifications/push-device";

/** Capture the browser object now; never look up a newer subscription for deferred cleanup. */
export function captureLogoutPushCleanup(sessionId: string): () => Promise<boolean> {
  let deviceId: string | null;
  try {
    deviceId = existingPushDeviceId();
  } catch {
    return async () => false;
  }
  if (!deviceId || !("serviceWorker" in navigator)) return async () => true;
  const subscription = navigator.serviceWorker
    .getRegistration("/portal/")
    .then((registration) => registration?.pushManager.getSubscription())
    .then(
      (subscription) => ({ subscription, failed: false }),
      () => ({ subscription: null, failed: true }),
    );
  return async () => {
    try {
      const result = await subscription;
      if (result.failed) return false;
      const captured = result.subscription;
      const active = await readActiveUserSession();
      if ((active && active.sessionId !== sessionId) || existingPushDeviceId() !== deviceId) return true;
      if (captured && !(await captured.unsubscribe())) return false;
      const after = await readActiveUserSession();
      if ((!after || after.sessionId === sessionId) && existingPushDeviceId() === deviceId) forgetPushDevice(deviceId);
      return true;
    } catch {
      return false;
    }
  };
}
