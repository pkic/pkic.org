import { prepareQueueEmailStatement } from "../../../email/outbox";
import { DIRECT_EMAIL_TEMPLATE_KEY, directEmailBodyPayload } from "../../../email/direct-body";
import { AppError } from "../../../errors";
import type { AuthAdmin, DatabaseLike } from "../../../types";
import { nowIso } from "../../../utils/time";
import { requireAdminDatabaseUserId } from "../../../auth/admin-identity";
import { prepareAuditLog } from "../../audit";
import { getMemberApplicationById, prepareApplicationCommunication, prepareApplicationNote } from "./queries";

/**
 * Sends one staff-written communication to an applicant and records it on the
 * application's staff-only timeline.
 *
 * Follows applicationCommunicationCreateSchema: with no `templateKey` the
 * message is the message, so it is queued as a direct body under the typed
 * subject and delivered verbatim. Naming a `templateKey` renders that stored
 * template instead, and its own subject line applies. Nothing is defaulted —
 * borrowing another workflow's template for an untemplated message is what
 * used to put a canned subject on an email whose timeline row showed the
 * subject staff had typed.
 */
export async function sendApplicationCommunication(
  db: DatabaseLike,
  payload: {
    applicationId: string;
    actor: AuthAdmin;
    subject: string;
    body: string;
    templateKey?: string | null;
  },
): Promise<{ id: string; createdAt: string; outboxId: string }> {
  const actorUserId = requireAdminDatabaseUserId(payload.actor);
  const application = await getMemberApplicationById(db, payload.applicationId);
  if (!application) throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");

  const templateKey = payload.templateKey ?? null;
  const now = nowIso();
  const queued = prepareQueueEmailStatement(
    db,
    {
      templateKey: templateKey ?? DIRECT_EMAIL_TEMPLATE_KEY,
      recipientEmail: application.applicant_email,
      messageType: "transactional",
      subject: payload.subject,
      data: {
        applicantName: application.applicant_name,
        // The chosen template's own variable for this text; a direct body
        // ignores it and delivers the body itself.
        requestDetails: payload.body,
        ...directEmailBodyPayload(templateKey ? null : payload.body),
      },
    },
    now,
  );
  const prepared = prepareApplicationCommunication(db, {
    applicationId: payload.applicationId,
    actorUserId,
    subject: payload.subject,
    body: payload.body,
    templateKey,
    emailOutboxId: queued.id,
  });
  await db.batch([
    queued.statement,
    prepared.statement,
    prepareAuditLog(
      db,
      "admin",
      payload.actor.id,
      "application_communication_sent",
      "member_application",
      payload.applicationId,
      { subject: payload.subject },
      now,
    ),
  ]);
  return { id: prepared.communication.id, createdAt: prepared.communication.created_at, outboxId: queued.id };
}

export async function addApplicationNoteWithAudit(
  db: DatabaseLike,
  payload: { applicationId: string; actor: AuthAdmin; body: string },
): Promise<{ id: string; createdAt: string }> {
  const actorUserId = requireAdminDatabaseUserId(payload.actor);
  if (!(await getMemberApplicationById(db, payload.applicationId))) {
    throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");
  }
  const now = nowIso();
  const prepared = prepareApplicationNote(db, {
    applicationId: payload.applicationId,
    actorUserId,
    body: payload.body,
  });
  await db.batch([
    prepared.statement,
    prepareAuditLog(
      db,
      "admin",
      payload.actor.id,
      "application_note_added",
      "member_application",
      payload.applicationId,
      {},
      now,
    ),
  ]);
  return { id: prepared.note.id, createdAt: prepared.note.created_at };
}
