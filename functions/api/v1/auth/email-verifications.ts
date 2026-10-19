/**
 * POST /api/v1/auth/email-verifications/preview — what an emailed address verification link names
 * POST /api/v1/auth/email-verifications         — verify the address the link names
 *
 * Public like an identity invitation: the link alone proves the mailbox, so
 * nobody has to sign in first. Previewing changes nothing; verifying is an
 * explicit, single-use step.
 */
import {
  ownEmailAddressVerificationPreviewResponseSchema,
  ownEmailAddressVerificationPreviewRouteSchema,
  ownEmailAddressVerificationResponseSchema,
  ownEmailAddressVerificationRouteSchema,
} from "../../../../assets/shared/schemas/own-email-addresses";
import { prepareMagicLinkVerificationHttp } from "../../../_lib/auth/http-flow";
import type { AdminContext } from "../../../_lib/db/context";
import { jsonPrivate } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { previewOwnEmailVerification, verifyOwnEmailAddress } from "../../../_lib/services/own-email-verification";

const EMAIL_VERIFICATION_RATE_LIMIT_NAMESPACE = "user-email-verification-redeem:ip";

export const EmailVerificationPreviewPost = openApiRoute(
  ownEmailAddressVerificationPreviewRouteSchema,
  async (c: AdminContext, data) => {
    const http = await prepareMagicLinkVerificationHttp(c, EMAIL_VERIFICATION_RATE_LIMIT_NAMESPACE);
    const preview = await previewOwnEmailVerification(http.db, { token: data.body.token, signingSecret: http.secret });
    return jsonPrivate(ownEmailAddressVerificationPreviewResponseSchema.parse(preview));
  },
  (c: AdminContext) => c.set?.("sensitive", true),
);

export const EmailVerificationPost = openApiRoute(
  ownEmailAddressVerificationRouteSchema,
  async (c: AdminContext, data) => {
    const http = await prepareMagicLinkVerificationHttp(c, EMAIL_VERIFICATION_RATE_LIMIT_NAMESPACE);
    const verified = await verifyOwnEmailAddress(http.db, { token: data.body.token, signingSecret: http.secret });
    return jsonPrivate(ownEmailAddressVerificationResponseSchema.parse(verified));
  },
  (c: AdminContext) => c.set?.("sensitive", true),
);
