import { describe, expect, it } from "vitest";
import { verifyStripeWebhookSignature } from "../functions/_lib/integrations/stripe/verify-webhook";

async function sign(secret: string, timestamp: number, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("verifyStripeWebhookSignature", () => {
  const body = JSON.stringify({ id: "evt_1" });
  const now = 1_800_000_000;

  it("accepts a valid signature and rejects tampered content", async () => {
    const signature = await sign("whsec_current", now, body);
    const header = `t=${now},v1=${signature}`;
    await expect(verifyStripeWebhookSignature(body, header, "whsec_current", { nowSeconds: now })).resolves.toBe(true);
    await expect(verifyStripeWebhookSignature(`${body} `, header, "whsec_current", { nowSeconds: now })).resolves.toBe(
      false,
    );
  });

  it("accepts any valid v1 during Stripe signature rotation", async () => {
    const valid = await sign("whsec_current", now, body);
    const header = `t=${now},v1=${"0".repeat(64)},v1=${valid}`;
    await expect(verifyStripeWebhookSignature(body, header, "whsec_current", { nowSeconds: now })).resolves.toBe(true);
  });

  it("supports overlapping endpoint secrets during secret rotation", async () => {
    const valid = await sign("whsec_previous", now, body);
    await expect(
      verifyStripeWebhookSignature(body, `t=${now},v1=${valid}`, ["whsec_current", "whsec_previous"], {
        nowSeconds: now,
      }),
    ).resolves.toBe(true);
  });

  it("rejects stale, malformed, or ambiguous timestamps", async () => {
    const signature = await sign("whsec_current", now, body);
    await expect(
      verifyStripeWebhookSignature(body, `t=${now},v1=${signature}`, "whsec_current", {
        nowSeconds: now + 301,
      }),
    ).resolves.toBe(false);
    await expect(
      verifyStripeWebhookSignature(body, `t=nope,v1=${signature}`, "whsec_current", { nowSeconds: now }),
    ).resolves.toBe(false);
    await expect(
      verifyStripeWebhookSignature(body, `t=${now},t=${now},v1=${signature}`, "whsec_current", {
        nowSeconds: now,
      }),
    ).resolves.toBe(false);
  });
});
