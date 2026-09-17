import { OpenAPIRoute } from "chanfana";
import {
  membershipPaymentEventSchema,
  membershipPaymentWebhookRouteSchema,
} from "../../../../assets/shared/schemas/membership-payments";
import { resolveAppBaseUrl } from "../../../_lib/config";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { readBoundedTextBody, STRIPE_WEBHOOK_MAX_BYTES } from "../../../_lib/http-body";
import { verifyStripeWebhookSignature } from "../../../_lib/integrations/stripe/verify-webhook";
import { handleMembershipPaymentEvent } from "../../../_lib/services/membership/workflows/fee-events";

export class MembershipPaymentWebhook extends OpenAPIRoute {
  schema = membershipPaymentWebhookRouteSchema;
  async handle(c: AdminContext) {
    if (!c.env.MEMBERSHIP_STRIPE_WEBHOOK_SECRET)
      return json({ error: "Membership payment webhook is not configured" }, 503);
    const raw = await readBoundedTextBody(c.req.raw, STRIPE_WEBHOOK_MAX_BYTES);
    if (
      !(await verifyStripeWebhookSignature(
        raw,
        c.req.raw.headers.get("stripe-signature") ?? "",
        c.env.MEMBERSHIP_STRIPE_WEBHOOK_SECRET,
      ))
    )
      return json({ error: "Invalid signature" }, 400);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const event = membershipPaymentEventSchema.safeParse(value);
    if (!event.success) return json({ error: "Invalid payment event" }, 400);
    return json(await handleMembershipPaymentEvent(requestDb(c), event.data, resolveAppBaseUrl(c.env, c.req.raw)));
  }
}
