import { promotionFormatsSchema } from "../../../../assets/shared/schemas/event-promotion-kit";
import type { EventEmailCampaignPreviewInput } from "../../../../assets/shared/schemas/event-email-campaigns";
import { buildBadgeAttachment, type QueuedEmailAttachment } from "../../email/attachments";
import type { DatabaseLike } from "../../types";
import { promotionReferral } from "../event-agenda/promotion-referral";
import type { getEventById } from "../events";
import { promotionKitPageUrl } from "../frontend-links";
import { listCampaignRecipients } from "./audience";
import {
  finishedKitFiles,
  prepareKitSessionTitlesRead,
  type KitEmailPlan,
  type PendingKitEmail,
} from "./kit-email-files";

/**
 * The files one organizer picked for one person, as a single email. Every row of
 * the batch has settled; one missing file fails the whole email, never part of it.
 */
export async function planPromotionMaterialsEmail(
  db: DatabaseLike,
  event: Awaited<ReturnType<typeof getEventById>>,
  head: PendingKitEmail,
  page: PendingKitEmail[],
  campaign: EventEmailCampaignPreviewInput,
  renderable: boolean,
): Promise<KitEmailPlan> {
  const failed = (): KitEmailPlan => ({
    recipients: [],
    outcomes: page.map((row) => ({ occurrenceId: row.occurrence_id, userId: row.user_id, status: "failed" })),
  });
  // Picked files have no test send, so a test batch is never theirs.
  if (!renderable || !campaign.materials || head.email_test === 1) return failed();

  const occurrenceIds = page.flatMap((row) => (row.occurrence_id ? [row.occurrence_id] : []));
  const titles = await prepareKitSessionTitlesRead(db, head.event_id, head.published_revision, occurrenceIds).all<{
    id: string;
    title: string;
  }>();
  const titleById = new Map(titles.results.map((row) => [row.id, row.title]));
  const [recipient] = await listCampaignRecipients(db, event, head.origin, campaign.filter, { maxRecipients: 1 });
  if (!recipient || recipient.userId !== head.user_id) return failed();

  // Every kit row must have finished; the files then follow the order they were picked in.
  const rendered: QueuedEmailAttachment[] = [];
  for (const row of page) {
    const formats = promotionFormatsSchema.safeParse(JSON.parse(row.formats_json));
    if (!formats.success) continue;
    const name = row.occurrence_id ? titleById.get(row.occurrence_id) : "attendee";
    const files = name ? finishedKitFiles(row, formats.data, name) : null;
    if (!files) return failed();
    rendered.push(...files);
  }
  const badgeCode = campaign.materials.files.some((file) => file.kit === "badge")
    ? await promotionReferral(db, head.event_id, head.user_id)
    : "";
  const attachments = campaign.materials.files.flatMap((file): QueuedEmailAttachment[] => {
    if (file.kit === "badge")
      return [
        buildBadgeAttachment({
          badgeCode,
          badgeType: "attendee",
          format: file.format,
          firstName: recipient.firstName,
          lastName: recipient.lastName,
        }),
      ];
    const occurrenceId = file.kit === "session" ? file.occurrenceId : null;
    return rendered.filter(
      (item) => item.kind === "promotion-kit-file" && item.occurrenceId === occurrenceId && item.format === file.format,
    );
  });

  return {
    recipients: [
      {
        ...recipient,
        templateData: { ...recipient.templateData, promotionKitUrl: promotionKitPageUrl(head.origin, event) },
        idempotencyKey: `promotion-materials:${head.batch_id}`,
        attachments,
      },
    ],
    outcomes: page.map((row) => ({ occurrenceId: row.occurrence_id, userId: row.user_id, status: "queued" })),
  };
}
