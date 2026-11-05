import {
  selectRegistrationIdentity,
  prepareSelectedRegistrationIdentityGuard,
} from "../registrations/selected-identity";
import type { AttendeeRegistrationParticipation } from "../../../../assets/shared/schemas/registration";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import type { GroupResourceViewer } from "../resource-grants";
import { submitEventRegistration, type PublicRegistrationSubmissionConfig } from "../registrations/public-submission";
import { userRecordColumns, type UserRecord } from "../users";
import { getGroupEvent } from "./group-read-model";
import {
  prepareGroupEventRegistrationGuard,
  prepareVerifiedRegistrationUserGuard,
  requireRegistrationUserProfile,
} from "../registrations/authorization";

export async function submitGroupEventRegistration(
  db: DatabaseLike,
  env: Env,
  viewer: GroupResourceViewer,
  groupId: string,
  eventId: string,
  input: AttendeeRegistrationParticipation,
  metadata: {
    clientIp: string | null;
    userAgent: string | null;
    appBaseUrl: string;
    signingSecret: string;
    config: PublicRegistrationSubmissionConfig;
  },
) {
  const { event } = await getGroupEvent(db, viewer, groupId, eventId);
  if (!event.capabilities.includes("register")) {
    throw new AppError(403, "EVENT_REGISTRATION_ACCESS_REQUIRED", "Registration access is required");
  }
  const user = await first<UserRecord>(db, `SELECT ${userRecordColumns()} FROM users WHERE id = ? AND active = 1`, [
    viewer.userId,
  ]);
  if (!user) throw new AppError(403, "REGISTRATION_IDENTITY_REQUIRED", "An active verified identity is required");
  const profile = requireRegistrationUserProfile(user);
  const selectedIdentity = input.identityId
    ? await selectRegistrationIdentity(db, user.id, input.identityId)
    : undefined;
  return submitEventRegistration(
    db,
    env,
    {
      ...profile,
      dayAttendance: input.dayAttendance,
      customAnswers: input.customAnswers,
      consents: input.consents,
      sourceType: "direct",
      sourceRef: `group:${groupId}`,
    },
    {
      ...metadata,
      eventSlug: event.slug,
      eventBasePath: null,
      verifiedIdentity: { userId: user.id, registrationGroupId: groupId, selectedIdentity },
      authorizationGuards: [
        prepareVerifiedRegistrationUserGuard(db, user),
        ...(selectedIdentity ? [prepareSelectedRegistrationIdentityGuard(db, selectedIdentity)] : []),
        prepareGroupEventRegistrationGuard(db, { eventId: event.id, groupId, userId: user.id }),
      ],
    },
  );
}
