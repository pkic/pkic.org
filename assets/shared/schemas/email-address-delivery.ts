import { z } from "zod";
import { utcInstantSchema } from "./api-common";

/** Delivery evidence for one exact address; verification and membership remain independent. */
export const emailAddressDeliverySchema = z.object({
  status: z.enum(["unknown", "delivered", "bouncing", "delayed", "blocked"]),
  observedAt: utcInstantSchema.nullable(),
});
export type EmailAddressDelivery = z.infer<typeof emailAddressDeliverySchema>;
export const UNKNOWN_EMAIL_DELIVERY: EmailAddressDelivery = { status: "unknown", observedAt: null };
export const EMAIL_ADDRESS_DELIVERY_LABELS: Record<EmailAddressDelivery["status"], string> = {
  unknown: "No delivery history",
  delivered: "Delivered",
  bouncing: "Bouncing",
  delayed: "Delivery delayed",
  blocked: "Delivery blocked",
};
