import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema } from "./api-common";
/** Subscription endpoints are capabilities. Only known browser push services may receive our server requests. */
export const webPushProviderHosts = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
] as const;
export const webPushEndpointSchema = z
  .string()
  .max(2048)
  .url()
  .superRefine((value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({ code: "custom", message: "Use a valid browser push subscription." });
      return;
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !webPushProviderHosts.some((host) => host === url.hostname)
    )
      context.addIssue({ code: "custom", message: "Use a subscription from a supported browser push service." });
  });
const base64Url = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .length(Math.ceil((bytes * 8) / 6));
export const webPushSubscriptionSchema = z
  .object({
    endpoint: webPushEndpointSchema,
    expirationTime: z.number().int().positive().max(253402300799999).nullable(),
    keys: z.object({ p256dh: base64Url(65), auth: base64Url(16) }).strict(),
  })
  .strict();
export const eventWebPushRegisterSchema = z
  .object({
    deviceId: databaseIdSchema,
    subscription: webPushSubscriptionSchema,
    enabled: z.literal(true),
    reminderMinutes: z.number().int().min(1).max(1440),
  })
  .strict();
export const eventWebPushRevokeResponseSchema = z.object({ revoked: z.literal(true) }).strict();
export const eventWebPushDeviceParamsSchema = z.object({ deviceId: databaseIdSchema });
export const eventWebPushConfigurationSchema = z
  .object({ available: z.boolean(), publicKey: base64Url(65).nullable() })
  .strict();
export const eventWebPushStatusSchema = z
  .object({
    deviceId: databaseIdSchema,
    enabled: z.boolean(),
    reminderMinutes: z.number().int().min(1).max(1440),
    registered: z.boolean(),
    revoked: z.boolean(),
    updatedAt: utcInstantSchema.nullable(),
  })
  .strict();
export const webPushNotificationKindSchema = z.enum(["session_reminder", "agenda_changed"]);
/** The event app's agenda; reminders and changes open it filtered to the reader's own sessions (`?mine=1`). */
export const webPushDestinationSchema = z
  .string()
  .regex(/^\/portal\/#\/events\/[a-z0-9]+(?:-[a-z0-9]+)*\/agenda(?:\?mine=1)?$/);
export const webPushNotificationSchema = z
  .object({
    notificationId: databaseIdSchema,
    kind: webPushNotificationKindSchema,
    destination: webPushDestinationSchema,
  })
  .strict();
export const webPushNotificationDisplay = {
  session_reminder: { title: "PKI Consortium", body: "A session on your schedule starts soon." },
  agenda_changed: { title: "PKI Consortium", body: "Your event schedule has an update." },
} satisfies Record<z.infer<typeof webPushNotificationKindSchema>, { title: string; body: string }>;
export type WebPushSubscription = z.infer<typeof webPushSubscriptionSchema>;
export type EventWebPushRegister = z.infer<typeof eventWebPushRegisterSchema>;
export type WebPushNotification = z.infer<typeof webPushNotificationSchema>;
