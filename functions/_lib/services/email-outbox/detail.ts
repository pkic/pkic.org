import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { EMAIL_OUTBOX_SELECT, type OutboxListRow } from "./query";
import { buildEmailOutboxRows } from "./preview";
import { readDirectEmailBody } from "../../email/direct-body";
import { parseQueuedEmailAttachments, readSentAttachmentNames } from "../../email/attachments";
import { parseJsonSafe } from "../../utils/json";
import type { CalendarPayload } from "../../email/outbox-queue";

/** Before sending: the calendar files, which carry their final names, then the stored files by base name. */
function queuedAttachmentNames(payload: Record<string, unknown>): string[] {
  const calendar = payload.__calendarInvite as Partial<CalendarPayload> | undefined;
  const calendarNames = Array.isArray(calendar?.icsFiles)
    ? calendar.icsFiles.flatMap((file) => (typeof file?.filename === "string" ? [file.filename] : []))
    : [];
  return [...calendarNames, ...parseQueuedEmailAttachments(payload).map((file) => file.filenameBase)];
}

export async function getEmailOutboxDetail(db: DatabaseLike, id: string) {
  const row = await first<OutboxListRow>(db, `${EMAIL_OUTBOX_SELECT} WHERE o.id = ?`, [id]);
  if (!row) throw new AppError(404, "EMAIL_NOT_FOUND", "Email message not found");
  const payload = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});
  const customText = payload.__eventCampaignCustomText;
  const sentNames = readSentAttachmentNames(payload);
  return {
    message: {
      ...(await buildEmailOutboxRows(db, [row]))[0],
      bodyContent: readDirectEmailBody(payload),
      customText: typeof customText === "string" && customText.trim() ? customText : null,
      attachments: (sentNames ?? queuedAttachmentNames(payload)).map((name) => ({ name })),
      attachmentNamesFinal: sentNames !== null,
    },
  };
}
