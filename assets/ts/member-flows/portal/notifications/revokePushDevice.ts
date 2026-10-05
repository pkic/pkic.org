import { eventWebPushRevokeResponseSchema } from "../../../../shared/schemas/event-web-push";
import { deleteJson, ApiClientError } from "../../../shared/api-client";
import { existingPushDeviceId, forgetPushDevice } from "./push-device";
/** Revoke server consent before unsubscribing and ending the authenticated session. */
export async function revokePushDevice() {
  const deviceId = existingPushDeviceId();
  if (!deviceId) return;
  try {
    await deleteJson(`/api/v1/users/current/push/devices/${deviceId}`, eventWebPushRevokeResponseSchema);
  } catch (error) {
    // A stale identifier from another account cannot authorize revoking that account's device.
    if (!(error instanceof ApiClientError && error.status === 403 && error.code === "PUSH_DEVICE_OWNER_REQUIRED"))
      throw error;
  }
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration("/portal/");
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription && !(await subscription.unsubscribe()))
      throw new Error("Browser notification cleanup failed. Please retry signing out.");
  }
  forgetPushDevice(deviceId);
}
