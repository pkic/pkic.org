import {
  promotionMaterialFileSchema,
  type PromotionMaterialFile,
} from "../../../../../../../shared/schemas/event-email-campaigns";

/**
 * One file an organizer can pick: a session's kit or the attendee kit, in one format.
 * The key names the file without a URL, so the same pick can travel to a message.
 */
export function promotionFileKey(kit: { occurrenceId: string } | "attendee", format: string): string {
  return kit === "attendee" ? `attendee:${format}` : `session:${kit.occurrenceId}:${format}`;
}

/** The message contract's file for a picked key; badges are named as their own kind. */
export function promotionMaterialFile(key: string): PromotionMaterialFile | null {
  const [kit, ...rest] = key.split(":");
  const format = rest.pop() ?? "";
  const badge = /^badge-(landscape|square)$/u.exec(format)?.[1];
  const candidate = badge
    ? { kit: "badge", format: badge }
    : kit === "session"
      ? { kit, occurrenceId: rest.join(":"), format }
      : { kit, format };
  const parsed = promotionMaterialFileSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
