import { buildPushPayload } from "@block65/webcrypto-web-push";
import {
  webPushSubscriptionSchema,
  webPushNotificationSchema,
  type WebPushSubscription,
  type WebPushNotification,
} from "../../../../assets/shared/schemas/event-web-push";
import type { WebPushConfiguration } from "./web-push-configuration";
export type WebPushTransportResult = {
  status: "accepted" | "gone" | "retry" | "failed";
  retryAfterMs?: number;
  code: string;
};
/** Standards encryption comes from the maintained package; all network ownership stays here. */
export async function deliverWebPush(
  subscription: WebPushSubscription,
  notification: WebPushNotification,
  config: WebPushConfiguration,
  ttl: number,
  fetcher: typeof fetch = fetch,
  beforeSend?: () => Promise<boolean>,
): Promise<WebPushTransportResult> {
  const target = webPushSubscriptionSchema.parse(subscription),
    payload = webPushNotificationSchema.parse(notification);
  if (!Number.isInteger(ttl) || ttl < 0 || ttl > 86400) throw new Error("Invalid push lifetime");
  const request = await buildPushPayload(
    {
      data: payload,
      options: { ttl, urgency: "normal", topic: payload.notificationId.replace(/-/g, "").slice(0, 32) },
    },
    target,
    { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
  );
  try {
    if (beforeSend && !(await beforeSend())) return { status: "failed", code: "consent_changed" };
    const response = await fetcher(target.endpoint, {
      ...request,
      headers: { ...request.headers, ttl: String(ttl) },
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    const status = response.status;
    // Workers supports manual redirects. Never follow a subscription capability to another destination.
    if (status >= 300 && status < 400) {
      await response.body?.cancel();
      return { status: "failed", code: "provider_redirect_blocked" };
    }
    await response.body?.cancel();
    if (status >= 200 && status < 300) return { status: "accepted", code: "accepted_by_push_service" };
    if (status === 404 || status === 410) return { status: "gone", code: "subscription_expired" };
    if (status === 429 || status >= 500) {
      const header = response.headers.get("retry-after"),
        seconds = header ? Number(header) : NaN;
      const delay = Number.isFinite(seconds) ? seconds * 1000 : header ? Date.parse(header) - Date.now() : NaN;
      return {
        status: "retry",
        code: status === 429 ? "provider_rate_limited" : "provider_unavailable",
        ...(Number.isFinite(delay) ? { retryAfterMs: Math.min(Math.max(delay, 1000), 3600000) } : {}),
      };
    }
    return { status: "failed", code: "provider_refused" };
  } catch {
    return { status: "retry", code: "transport_uncertain" };
  }
}
