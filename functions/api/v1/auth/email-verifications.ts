/**
 * POST /api/v1/auth/email-verifications/preview — what an emailed address verification link names
 * POST /api/v1/auth/email-verifications         — verify the address the link names
 *
 * Previewing changes nothing. Linking requires mailbox proof, the intended
 * account’s live sign-in, and an explicit single-use confirmation.
 */
import {
  ownEmailAddressVerificationPreviewResponseSchema,
  ownEmailAddressVerificationPreviewRouteSchema,
  ownEmailAddressVerificationResponseSchema,
  ownEmailAddressVerificationRouteSchema,
} from "../../../../assets/shared/schemas/own-email-addresses";
import { prepareMagicLinkVerificationHttp } from "../../../_lib/auth/http-flow";
import type { AdminContext } from "../../../_lib/db/context";
import { AppError } from "../../../_lib/errors";
import { jsonPrivate } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { previewOwnEmailVerification, verifyOwnEmailAddress } from "../../../_lib/services/own-email-verification";

import { verifyUserSessionRequest } from "../../../_lib/auth/user-session-request";
import { userSessionRequestAuthorizationEvidence } from "../../../_lib/auth/user-session-evidence";

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
    const claims = await verifyUserSessionRequest(c.req.raw, c.env).catch((error: unknown) => {
      if (error instanceof AppError && error.status === 401)
        throw new AppError(
          401,
          "EMAIL_LINK_SIGN_IN_REQUIRED",
          "Sign in to the account that requested this address, then reopen this email link.",
        );
      throw error;
    });
    const verified = await verifyOwnEmailAddress(http.db, {
      token: data.body.token,
      consolidateUnverifiedAccount: data.body.consolidateUnverifiedAccount,
      signingSecret: http.secret,
      actor: { userId: claims.sub, authorizationEvidence: userSessionRequestAuthorizationEvidence(claims) },
    });
    return jsonPrivate(ownEmailAddressVerificationResponseSchema.parse(verified));
  },
  (c: AdminContext) => c.set?.("sensitive", true),
);
