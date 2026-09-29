import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { authErrors, requiresPermissions } from "./route-contract";
import { stripeCurrencySchema } from "./stripe";

export const offlinePaymentMethodSchema = z.enum(["bank_transfer", "check", "cash", "other"]);

export const offlinePaymentSettlementSchema = z.object({
  idempotencyKey: z.uuid(),
  amount: z.number().int().positive(),
  currency: stripeCurrencySchema,
  method: offlinePaymentMethodSchema,
  settledAt: z.iso.datetime({ offset: true }),
  reference: z.string().trim().min(1).max(200),
  note: z.string().trim().min(1).max(1000),
});

export const paymentSettlementResponseSchema = z.object({
  paymentId: z.string().min(1),
  purpose: z.enum(["membership", "sponsorship"]),
  resourceId: databaseIdSchema,
  status: z.literal("paid"),
  amount: z.number().int().positive(),
  currency: stripeCurrencySchema,
  method: offlinePaymentMethodSchema,
  settledAt: z.iso.datetime({ offset: true }),
  duplicate: z.boolean(),
  handlingRequired: z.boolean().optional(),
});

export const membershipFeeSyncResponseSchema = z.object({
  feeId: databaseIdSchema,
  sessionId: z.string().min(1),
  outcome: z.enum(["paid", "pending", "failed", "expired", "requires_review"]),
  status: z.string().min(1),
  handlingRequired: z.boolean(),
  syncedAt: z.iso.datetime({ offset: true }),
});
export type MembershipFeeSyncResponse = z.infer<typeof membershipFeeSyncResponseSchema>;

const body = {
  required: true,
  content: { "application/json": { schema: offlinePaymentSettlementSchema } },
};
const responses = {
  "200": {
    description: "The existing offline settlement was returned.",
    content: { "application/json": { schema: paymentSettlementResponseSchema } },
  },
  "201": {
    description: "The offline settlement was recorded.",
    content: { "application/json": { schema: paymentSettlementResponseSchema } },
  },
  ...authErrors({ notFound: "Payment obligation not found.", conflict: "The payment state changed." }),
};

export const membershipFeeSettlementRouteSchema = {
  ...requiresPermissions("membership:write"),
  tags: ["Membership"],
  summary: "Record an offline membership-fee settlement",
  description:
    "Records an attributable bank transfer or other offline payment and advances the pinned workflow only when the fee remains its active requirement.",
  request: {
    params: z.object({ feeId: databaseIdSchema }),
    body,
  },
  responses,
};

export const membershipFeeSyncRouteSchema = {
  ...requiresPermissions("membership:write"),
  tags: ["Membership"],
  summary: "Reconcile a membership fee with Stripe",
  description:
    "Fetches the current Stripe Checkout state and applies it through the same payment workflow used by signed webhooks. This supports local and operator-initiated recovery without requiring webhook delivery.",
  request: { params: z.object({ feeId: databaseIdSchema }) },
  responses: {
    "200": {
      description: "The current Stripe state was reconciled.",
      content: { "application/json": { schema: membershipFeeSyncResponseSchema } },
    },
    ...authErrors({ notFound: "Membership fee not found.", conflict: "The payment or authorization changed." }),
    "502": { description: "Stripe did not return usable payment evidence." },
    "503": { description: "Stripe checkout is not configured." },
  },
};

export const sponsorshipSettlementRouteSchema = {
  ...requiresPermissions("sponsorships:write"),
  tags: ["Sponsorships"],
  summary: "Record an offline sponsorship settlement",
  description:
    "Records an attributable bank transfer or other offline payment against an existing sponsorship without activating the sponsorship automatically.",
  request: {
    params: z.object({ id: databaseIdSchema }),
    body,
  },
  responses,
};
