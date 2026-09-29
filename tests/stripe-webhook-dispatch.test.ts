import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { dispatchStripePaymentEvent } from "../functions/_lib/services/payments/stripe-webhook";
import type { DatabaseLike, Env } from "../functions/_lib/types";

describe("consolidated Stripe webhook dispatch", () => {
  it("acknowledges an unrelated declared payment purpose without touching payment tables", async () => {
    const prepare = vi.fn();
    const result = await dispatchStripePaymentEvent(
      { prepare } as unknown as DatabaseLike,
      env as Env,
      {
        id: "evt_unrelated",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_unrelated",
            metadata: { pkic_payment_type: "unrelated-product", donor_name: "Must not become a donation" },
          },
        },
      },
      "https://app.test",
      vi.fn(),
    );

    expect(result).toEqual({ received: true, ignored: true });
    expect(prepare).not.toHaveBeenCalled();
  });
});
