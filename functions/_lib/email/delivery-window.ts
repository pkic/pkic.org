import { addHours } from "../utils/time";

/** Presentation-only dates follow each delivery attempt, including delayed retries. */
export function emailDeliveryWindowData(payload: Record<string, unknown>, deliveryAt: string) {
  const days = payload.__deliveryWindowDays;
  if (typeof days !== "number" || !Number.isSafeInteger(days) || days <= 0) return {};
  const closesAt = addHours(deliveryAt, days * 24);
  return {
    deliveryWindowClosesAt: closesAt,
    deliveryWindowClosesOn: new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(closesAt)),
  };
}
