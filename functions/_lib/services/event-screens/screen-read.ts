import { SCREEN_STATUS_PERMISSIONS } from "../../../../assets/shared/event-screen-permissions";
import { screenStaffViewSchema, type ScreenReadResponse } from "../../../../assets/shared/schemas/event-screens";
import { readScreenSessionToken, signScreenSessionToken } from "../../auth/screen-session";
import { getBearerToken } from "../../auth/session-engine";
import { getUserSessionToken } from "../../auth/user-session-token";
import type { DatabaseLike, Env } from "../../types";
import { readScreenOwnView, screenSessionExpired, screenSessionMissing } from "./screen-own-view";
import { toScreenRecord } from "./screen-record";
import { readScreenForStaff } from "./screen-staff-access";

/**
 * One endpoint, two readers. A screen signed in as this screen reads what to
 * show; otherwise a staff credential reads the record. Without either, the
 * caller is told to pair, so a screen whose sign-in was lost shows a code.
 */
export async function readScreen(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  secret: string,
  screenId: string,
): Promise<{ body: ScreenReadResponse; renewedToken: string | null }> {
  const screenToken = await readScreenSessionToken(secret, request);
  if (screenToken.ok && screenToken.claims.sub === screenId) {
    const { view, renewedUntil } = await readScreenOwnView(db, secret, screenToken.claims);
    return {
      body: view,
      renewedToken: renewedUntil
        ? await signScreenSessionToken(secret, { screenId, sessionId: screenToken.claims.sid, expiresAt: renewedUntil })
        : null,
    };
  }
  if (!getUserSessionToken(request) && !getBearerToken(request))
    throw !screenToken.ok && screenToken.reason === "expired" ? screenSessionExpired() : screenSessionMissing();
  const { row } = await readScreenForStaff(db, request, env, screenId, SCREEN_STATUS_PERMISSIONS);
  return { body: screenStaffViewSchema.parse({ viewer: "staff", screen: toScreenRecord(row) }), renewedToken: null };
}
