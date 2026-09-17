import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { EMAIL_OUTBOX_SELECT, type OutboxListRow } from "./query";
import { buildEmailOutboxRows } from "./preview";

export async function getEmailOutboxDetail(db: DatabaseLike, id: string) {
  const row = await first<OutboxListRow>(db, `${EMAIL_OUTBOX_SELECT} WHERE o.id = ?`, [id]);
  if (!row) throw new AppError(404, "EMAIL_NOT_FOUND", "Email message not found");
  return { message: (await buildEmailOutboxRows(db, [row]))[0] };
}
