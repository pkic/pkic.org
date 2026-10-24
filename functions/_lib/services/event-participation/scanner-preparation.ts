import { batchFirst } from "../../db/pagination";
import type { DatabaseLike, Env } from "../../types";
import { AppError } from "../../errors";
import { prepareEventAdminContext, readEventAdminContext } from "../events/authorized-context";
import { eventReadIdSql } from "../events/selection";
import { scannerCaptureOpenForEventSql } from "./scanner-upload-receipts";
import { prepareOfflineEligibility } from "./offline-eligibility";
import { requireScannerCapability } from "./scanner-authorization";
import {
  enrolledOfflineEligibilityResponseSchema,
  type enrolledOfflineEligibilityQuerySchema,
} from "../../../../assets/shared/schemas/event-offline-eligibility";
import type { z } from "zod";

/** Human-session authority, epoch ownership, and dated evidence share the same replica snapshot. */
export async function readEnrolledOfflineEligibilityRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
  query: z.infer<typeof enrolledOfflineEligibilityQuerySchema>,
) {
  const context = await prepareEventAdminContext(db, request, env, eventSlug);
  const fallback = context ? null : await readEventAdminContext(db, request, env, eventSlug);
  const scope = eventReadIdSql({ slug: eventSlug });
  const read = prepareOfflineEligibility(db, { slug: eventSlug }, query);
  const epoch = db
    .prepare(`SELECT session.operator_user_id FROM event_scanner_device_sessions session
    WHERE session.id=? AND session.device_id=? AND session.event_id=${scope.sql}
      AND session.closed_at IS NULL AND session.high_water_sequence IS NULL
      AND ${scannerCaptureOpenForEventSql("session.event_id")}`)
    .bind(query.epochId, query.deviceId, ...scope.bindings);
  const results = await db.batch([...(context?.statements ?? []), epoch, ...read.statements]);
  const offset = context?.statements.length ?? 0;
  const { actor, event } = context ? await context.decode(results.slice(0, offset)) : fallback!;
  requireScannerCapability(actor, event.id, ["agenda:check", "agenda:admit", "agenda:attendance_record"]);
  // Epoch ownership comes from D1, never the request. Release no badge data for another operator/device.
  if (batchFirst<{ operator_user_id: string }>(results[offset])?.operator_user_id !== actor.id)
    throw new AppError(
      409,
      "SCANNER_PREPARATION_CLOSED",
      "Prepare an open scanner session for this operator and device before downloading offline evidence.",
    );
  return enrolledOfflineEligibilityResponseSchema.parse({
    ...read.decode(results.slice(offset + 1), actor.id),
    epochId: query.epochId,
    deviceId: query.deviceId,
  });
}
