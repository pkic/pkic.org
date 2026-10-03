export const AVAILABILITY_EVENT = "pkic:service-availability";

export function notifyServiceAvailability(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AVAILABILITY_EVENT));
}
