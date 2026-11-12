import type {
  EventEmailCampaignPreviewInput,
  PromotionMaterialFile,
} from "../../../../assets/shared/schemas/event-email-campaigns";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { prepareAuditLogWhen } from "../audit";
import { prepareJobWake } from "../scheduled-jobs/dispatcher";
import { campaignPublishedSessions } from "./audience";
import type { CampaignEvent } from "./types";

type MaterialsInput = EventEmailCampaignPreviewInput & {
  materials: { files: PromotionMaterialFile[] };
  filter: EventEmailCampaignPreviewInput["filter"] & { userIds: [string] };
};

interface MaterialsRow {
  occurrenceId: string | null;
  formats: string[];
}

export function hasPromotionMaterials(input: EventEmailCampaignPreviewInput): input is MaterialsInput {
  return Boolean(input.materials) && input.filter.userIds?.length === 1;
}

/**
 * One render row per session kit the organizer picked, plus the attendee kit. A
 * pick of badges alone still needs a row, so the email has a batch to wait on.
 */
export function promotionMaterialRows(files: readonly PromotionMaterialFile[]): MaterialsRow[] {
  const sessions = new Map<string, string[]>();
  const attendee: string[] = [];
  for (const file of files) {
    if (file.kit === "session")
      sessions.set(file.occurrenceId, [...(sessions.get(file.occurrenceId) ?? []), file.format]);
    if (file.kit === "attendee") attendee.push(file.format);
  }
  const rows: MaterialsRow[] = [...sessions].map(([occurrenceId, formats]) => ({ occurrenceId, formats }));
  if (attendee.length || !rows.length) rows.push({ occurrenceId: null, formats: attendee });
  return rows;
}

/** Every picked session is one the person still presents on the published agenda. */
function pickedSessionsSql(event: CampaignEvent, input: MaterialsInput) {
  const sessions = campaignPublishedSessions(event, { audience: "speakers" });
  return {
    sql: `SELECT COUNT(DISTINCT session.occurrence_id) AS total FROM (${sessions.sql}) session
      WHERE session.user_id=? AND session.occurrence_id IN(SELECT json_extract(value,'$.occurrenceId') FROM json_each(?))`,
    bindings: [
      ...sessions.bindings,
      input.filter.userIds[0],
      JSON.stringify(promotionMaterialRows(input.materials.files)),
    ],
  };
}

export async function assertPromotionMaterialsBelongToPerson(
  db: DatabaseLike,
  event: CampaignEvent,
  input: MaterialsInput,
): Promise<void> {
  const picked = promotionMaterialRows(input.materials.files).filter((row) => row.occurrenceId).length;
  if (!picked) return;
  const query = pickedSessionsSql(event, input);
  const row = await first<{ total: number }>(db, query.sql, query.bindings);
  if ((row?.total ?? 0) !== picked)
    throw new AppError(
      422,
      "CAMPAIGN_MATERIALS_SESSION_CHANGED",
      "A picked session kit is no longer on this person's published agenda. Open their promotion materials again.",
    );
}

/** Commits with the campaign acceptance: the reviewed email waits for its files in one render batch. */
export function preparePromotionMaterialsAcceptance(
  db: DatabaseLike,
  event: CampaignEvent,
  input: MaterialsInput,
  identity: { campaignId: string; actorId: string; appBaseUrl: string; at: string },
): StatementLike[] {
  const batchId = identity.campaignId;
  const userId = input.filter.userIds[0];
  const rows = promotionMaterialRows(input.materials.files);
  const sessions = campaignPublishedSessions(event, { audience: "speakers" });
  const accepted = {
    sql: "SELECT 1 FROM event_email_campaigns WHERE id=? AND status='complete'",
    bindings: [identity.campaignId],
  };
  return [
    db
      .prepare(
        `INSERT INTO event_promotion_batches(id,event_id,requested_by,published_revision,formats_json,origin,created_at,email_campaign_id,email_test)
         SELECT ?,?,?,COALESCE((SELECT published_revision FROM event_agenda_state WHERE event_id=?),0),'[]',?,?,?,0
         WHERE EXISTS(${accepted.sql})
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        batchId,
        event.id,
        identity.actorId,
        event.id,
        identity.appBaseUrl,
        identity.at,
        identity.campaignId,
        ...accepted.bindings,
      ),
    db
      .prepare(
        `INSERT INTO event_promotion_batch_recipients(batch_id,occurrence_id,user_id,formats_json,status,next_attempt_at,updated_at,email_status)
         SELECT ?,json_extract(pick.value,'$.occurrenceId'),?,json_extract(pick.value,'$.formats'),
           CASE WHEN json_array_length(pick.value,'$.formats')=0 THEN 'prepared' ELSE 'queued' END,?,?,'pending'
         FROM json_each(?) pick
         WHERE changes()=1 AND (json_extract(pick.value,'$.occurrenceId') IS NULL OR EXISTS(
           SELECT 1 FROM (${sessions.sql}) session
           WHERE session.user_id=? AND session.occurrence_id=json_extract(pick.value,'$.occurrenceId')))
         ON CONFLICT DO NOTHING`,
      )
      .bind(batchId, userId, identity.at, identity.at, JSON.stringify(rows), ...sessions.bindings, userId),
    prepareAuditLogWhen(db, {
      actorType: "user",
      actorId: identity.actorId,
      action: "promotion_materials_email_requested",
      entityType: "user",
      entityId: userId,
      scope: { type: "event", id: event.id },
      details: { batchId, files: input.materials.files },
      createdAt: identity.at,
      idempotencyKey: `promotion-materials-email:${batchId}`,
      conditionSql: "SELECT 1 FROM event_promotion_batches WHERE id=?",
      conditionBindings: [batchId],
    }),
    prepareJobWake(db, "promotion_rendering", accepted),
  ];
}
