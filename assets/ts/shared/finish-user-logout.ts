import { userAuthLogoutRequestSchema, userAuthLogoutResponseSchema } from "../../shared/schemas/user-auth";
import { postJson } from "./api-client";
import { settleUserLogout, type PendingUserLogout } from "./pending-user-logout";

/** Every retry is guarded by the original nonsecret session instance. */
export async function finishUserLogout(intent: PendingUserLogout) {
  const response = await postJson(
    "/api/v1/auth/logout",
    userAuthLogoutRequestSchema.parse({ expectedSessionId: intent.sessionId }),
    userAuthLogoutResponseSchema,
  );
  const settled = await settleUserLogout(intent);
  return { outcome: response.outcome, settled };
}
