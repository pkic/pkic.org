import { databaseIdSchema } from "../../../../shared/schemas/identifiers";
const key = "pkic-browser-notification-device";
/** This is an opaque device identifier, never a subscription capability or profile. */
export function existingPushDeviceId(): string | null {
  const parsed = databaseIdSchema.safeParse(localStorage.getItem(key));
  return parsed.success ? parsed.data : null;
}
export function pushDeviceId(): string {
  const existing = existingPushDeviceId();
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}
export function forgetPushDevice(deviceId: string) {
  if (existingPushDeviceId() === deviceId) localStorage.removeItem(key);
}
