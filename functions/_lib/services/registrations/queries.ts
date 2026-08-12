import { AppError } from "../../errors";
import { all, first } from "../../db/queries";
import { verifyDatabaseCapability } from "../capability-links";
import type { DatabaseLike } from "../../types";
import type { RegistrationRecord } from "./types";

export async function getRegistrationByManageToken(
  db: DatabaseLike,
  manageToken: string,
  signingSecret: string,
): Promise<RegistrationRecord> {
  const verified = await verifyDatabaseCapability({
    db,
    signingSecret,
    purpose: "registration_manage",
    token: manageToken,
  });
  if (!verified.ok) {
    throw new AppError(
      verified.reason === "expired" ? 410 : 404,
      verified.reason === "expired" ? "REGISTRATION_TOKEN_EXPIRED" : "REGISTRATION_NOT_FOUND",
      verified.reason === "expired" ? "Registration manage link has expired" : "Invalid registration token",
    );
  }
  const registration = await first<RegistrationRecord>(db, "SELECT * FROM registrations WHERE id = ?", [
    verified.resourceId,
  ]);
  if (!registration) {
    throw new AppError(404, "REGISTRATION_NOT_FOUND", "Invalid registration token");
  }
  return registration;
}

export async function getRegistrationById(db: DatabaseLike, registrationId: string): Promise<RegistrationRecord> {
  const registration = await first<RegistrationRecord>(db, "SELECT * FROM registrations WHERE id = ?", [
    registrationId,
  ]);
  if (!registration) {
    throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
  }
  return registration;
}

export async function listRegistrationsForEvent(db: DatabaseLike, eventId: string): Promise<RegistrationRecord[]> {
  return all<RegistrationRecord>(db, "SELECT * FROM registrations WHERE event_id = ? ORDER BY created_at DESC", [
    eventId,
  ]);
}
