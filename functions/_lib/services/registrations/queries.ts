import { AppError } from "../../errors";
import { all, first } from "../../db/queries";
import { sha256Hex } from "../../utils/crypto";
import type { DatabaseLike } from "../../types";
import type { RegistrationRecord } from "./types";

export async function getRegistrationByManageToken(
  db: DatabaseLike,
  manageToken: string,
): Promise<RegistrationRecord> {
  const hash = await sha256Hex(manageToken);
  const registration = await first<RegistrationRecord>(
    db,
    "SELECT * FROM registrations WHERE manage_token_hash = ?",
    [hash],
  );
  if (!registration) {
    throw new AppError(404, "REGISTRATION_NOT_FOUND", "Invalid registration token");
  }
  return registration;
}

export async function getRegistrationById(db: DatabaseLike, registrationId: string): Promise<RegistrationRecord> {
  const registration = await first<RegistrationRecord>(
    db,
    "SELECT * FROM registrations WHERE id = ?",
    [registrationId],
  );
  if (!registration) {
    throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
  }
  return registration;
}

export async function listRegistrationsForEvent(db: DatabaseLike, eventId: string): Promise<RegistrationRecord[]> {
  return all<RegistrationRecord>(
    db,
    "SELECT * FROM registrations WHERE event_id = ? ORDER BY created_at DESC",
    [eventId],
  );
}
