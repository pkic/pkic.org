import type { EventRecord } from "./events";
import { registrationManagePageUrl } from "./frontend-links";
import { writeAuditLog } from "./audit";
import { getRegistrationById } from "./registrations";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike } from "../types";
import { sha256Hex } from "../utils/crypto";
import { signAdminManageJwt } from "../utils/jwt";

const ADMIN_MANAGE_SESSION_MINUTES = 15;

export async function createAdminRegistrationManageUrl(
  db: DatabaseLike,
  payload: {
    actor: AuthAdmin;
    event: EventRecord;
    registrationId: string;
    signingSecret: string;
    ip: string;
    userAgent: string;
    appBaseUrl: string;
  },
): Promise<string> {
  const registration = await getRegistrationById(db, payload.registrationId);
  if (registration.event_id !== payload.event.id) {
    throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
  }

  const [iphash, uahash] = await Promise.all([sha256Hex(payload.ip), sha256Hex(payload.userAgent)]);
  const token = await signAdminManageJwt(payload.signingSecret, {
    sub: registration.id,
    actor: payload.actor.id,
    event: payload.event.slug,
    iphash,
    uahash,
    ttlSeconds: ADMIN_MANAGE_SESSION_MINUTES * 60,
  });
  await writeAuditLog(db, "admin", payload.actor.id, "admin_opened_manage_page", "registration", registration.id, {
    eventSlug: payload.event.slug,
  });
  return registrationManagePageUrl(payload.appBaseUrl, payload.event, token);
}
