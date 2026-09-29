import {
  donationCheckoutPostRouteSchema,
  donationCheckoutSchema,
  type DonationCheckoutInput,
} from "../../../../assets/shared/schemas/donation";
import { resolveAppBaseUrl } from "../../../_lib/config";
import { AppError } from "../../../_lib/errors";
import { json } from "../../../_lib/http";
import { readBoundedTextBody } from "../../../_lib/http-body";
import { openApiRoute } from "../../../_lib/openapi/route";
import { assertSameOriginRequest } from "../../../_lib/request-origin";
import { createDonationCheckout } from "../../../_lib/services/donations";

const DONATION_CHECKOUT_MAX_BYTES = 64 * 1024;

function throwInvalidDonationInput(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): never {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    (fieldErrors[key] ??= []).push(issue.message);
  }
  throw new AppError(400, "VALIDATION_ERROR", "Invalid donation parameters", { fieldErrors });
}

async function handleDonationCheckout(c: any, input: DonationCheckoutInput): Promise<Response> {
  c.set("sensitive", true);
  const request = c.req.raw;
  const appBaseUrl = resolveAppBaseUrl(c.env, request);
  assertSameOriginRequest(request, appBaseUrl, "donation_checkout");
  if (!c.env.STRIPE_SECRET_KEY) {
    throw new AppError(503, "SERVICE_UNAVAILABLE", "Donation processing is not configured");
  }

  const result = await createDonationCheckout(c.env.DB, c.env.STRIPE_SECRET_KEY, appBaseUrl, input);
  if (input.embedded) {
    return json({ clientSecret: result.clientSecret, publishableKey: c.env.STRIPE_PUBLISHABLE_KEY ?? "" });
  }
  return json({ url: result.url });
}

/** Direct Pages handler retained for callers and focused unit tests. */
export async function onRequestPost(c: any): Promise<Response> {
  let body: unknown;
  try {
    body = JSON.parse(await readBoundedTextBody(c.req.raw, DONATION_CHECKOUT_MAX_BYTES));
  } catch (error) {
    if (error instanceof AppError && error.status === 413) throw error;
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
  const parsed = donationCheckoutSchema.safeParse(body);
  if (!parsed.success) throwInvalidDonationInput(parsed.error);
  return handleDonationCheckout(c, parsed.data);
}

export const DonationsCheckoutPost = openApiRoute(donationCheckoutPostRouteSchema, (c: any, data) =>
  handleDonationCheckout(c, data.body),
);
