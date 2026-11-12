import type { promotionFormatSchema } from "../../../../assets/shared/schemas/event-promotion-kit";
import type { z } from "zod";
import { slugifyAttachmentPart, type QueuedEmailAttachment } from "../../email/attachments";
import type { DatabaseLike } from "../../types";
import {
  selectedOrAffiliationJobTitleSql,
  selectedOrAffiliationOrganizationNameSql,
} from "../identities/affiliation-projection";
import type { CampaignRecipient } from "./types";

/** The kit rows a staging pass reads, and the files and people their emails are built from. */
type PromotionFormat = z.infer<typeof promotionFormatSchema>;

export const KIT_FILE_NAMES: Record<PromotionFormat, string> = {
  portrait: "tall-post",
  carousel: "carousel",
  square: "square-post",
  landscape: "wide-post",
};

export interface PendingKitEmail {
  batch_id: string;
  /** NULL for the attendee kit. */
  occurrence_id: string | null;
  user_id: string;
  status: string;
  fingerprint: string | null;
  event_id: string;
  published_revision: number;
  live_revision: number;
  formats_json: string;
  origin: string;
  requested_by: string;
  email_test: number;
  input_json: string | null;
  renders_json: string;
}

export interface KitPerson {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  job_title: string | null;
}

export type EmailOutcome = { occurrenceId: string | null; userId: string; status: "queued" | "failed" };

/** What one staging pass hands to the outbox, and how each kit row settles. */
export interface KitEmailPlan {
  recipients: CampaignRecipient[];
  outcomes: EmailOutcome[];
}

/** The rendered files of one kit row, or null while any picked format has no finished file. */
export function finishedKitFiles(
  row: PendingKitEmail,
  formats: readonly PromotionFormat[],
  name: string,
): QueuedEmailAttachment[] | null {
  if (row.status === "failed" || row.live_revision !== row.published_revision || !row.fingerprint) return null;
  const renders = JSON.parse(row.renders_json ?? "[]") as Array<{ format: string; status: string }>;
  const session = slugifyAttachmentPart(name).slice(0, 60) || "session";
  const files: QueuedEmailAttachment[] = [];
  for (const format of formats) {
    const render = renders.find((item) => item.format === format && item.status === "rendered");
    if (!render) return null;
    files.push({
      kind: "promotion-kit-file",
      eventId: row.event_id,
      occurrenceId: row.occurrence_id,
      userId: row.user_id,
      format,
      filenameBase: `${session}-${KIT_FILE_NAMES[format]}`,
    });
  }
  return files;
}

export function prepareKitPeopleRead(db: DatabaseLike, userIds: string[]) {
  return db
    .prepare(
      `SELECT person.id,person.email,person.first_name,person.last_name,
        ${selectedOrAffiliationOrganizationNameSql("NULL", "person.id")} AS organization_name,
        ${selectedOrAffiliationJobTitleSql("NULL", "person.id")} AS job_title
      FROM users person
      WHERE person.id IN(SELECT value FROM json_each(?)) AND person.active=1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL`,
    )
    .bind(JSON.stringify(userIds));
}

/** The published titles of the batch's sessions, by occurrence id. */
export function prepareKitSessionTitlesRead(
  db: DatabaseLike,
  eventId: string,
  revision: number,
  occurrenceIds: string[],
) {
  return db
    .prepare(
      `SELECT json_extract(entry.value,'$.id') AS id,json_extract(entry.value,'$.title') AS title
       FROM event_agenda_publications publication,json_each(publication.snapshot_json,'$.occurrences') entry
       WHERE publication.event_id=? AND publication.revision=? AND json_extract(entry.value,'$.id') IN(SELECT value FROM json_each(?))`,
    )
    .bind(eventId, revision, JSON.stringify(occurrenceIds));
}
