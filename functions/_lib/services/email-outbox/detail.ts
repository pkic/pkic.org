import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { EMAIL_OUTBOX_SELECT, type OutboxListRow } from "./query";
import { buildEmailOutboxRows } from "./preview";
import { readDirectEmailBody } from "../../email/direct-body";
import { parseJsonSafe } from "../../utils/json";

export async function getEmailOutboxDetail(db: DatabaseLike, id: string) {
  const row = await first<OutboxListRow>(db, `${EMAIL_OUTBOX_SELECT} WHERE o.id = ?`, [id]);
  if (!row) throw new AppError(404, "EMAIL_NOT_FOUND", "Email message not found");
  const payload = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});
  const customText = payload.__eventCampaignCustomText;
  return {
    message: {
      ...(await buildEmailOutboxRows(db, [row]))[0],
      bodyContent: readDirectEmailBody(payload),
      customText: typeof customText === "string" && customText.trim() ? customText : null,
    },
  };
}
