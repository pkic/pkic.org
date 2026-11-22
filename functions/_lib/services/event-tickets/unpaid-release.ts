/**
 * Releases a place that was not paid for in time. An event may keep an
 * unpaid place for a number of days; after that its registration is
 * cancelled, as an organizer would cancel it, and the person is told why. A
 * payment that is on its way keeps the place until the provider says how it
 * ended.
 */
import { all } from "../../db/queries";
import { isStateGuardFailure, prepareStateGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import { logError } from "../../logging";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { getEventById } from "../events";
import { updateRegistrationByIdWithNotification } from "../registrations/update";
import { ticketPaymentProcessingSql } from "./payment";

export async function releaseUnpaidTickets(
  db: DatabaseLike,
  appBaseUrl: string,
  limit = 25,
): Promise<{ released: number; failed: number }> {
  const due = await all<{ id: string; event_id: string; registration_id: string }>(
    db,
    `SELECT ticket.id, ticket.event_id, ticket.registration_id
     FROM registration_tickets ticket JOIN registrations registration ON registration.id = ticket.registration_id
     WHERE ticket.status = 'pending_payment' AND ticket.pay_by IS NOT NULL AND ticket.pay_by <= ?
       AND registration.status <> 'cancelled' AND NOT ${ticketPaymentProcessingSql("ticket.id")}
     ORDER BY ticket.pay_by, ticket.id LIMIT ?`,
    [nowIso(), limit],
  );
  let released = 0;
  let failed = 0;
  for (const ticket of due) {
    try {
      const event = await getEventById(db, ticket.event_id);
      await updateRegistrationByIdWithNotification(
        db,
        {
          eventId: ticket.event_id,
          registrationId: ticket.registration_id,
          action: "cancel",
          notification: {
            event,
            appBaseUrl,
            templateKey: "registration_updated",
            subject: `Registration cancelled for ${event.name}`,
            unpaidRelease: true,
          },
        },
        "system",
        undefined,
        // The cancellation and its record are one write, made only while the ticket is still unpaid and overdue.
        (statements) =>
          db.batch([
            prepareStateGuard(db, {
              sql: `SELECT 1 FROM registration_tickets ticket
                    WHERE ticket.id = ? AND ticket.status = 'pending_payment' AND ticket.pay_by IS NOT NULL
                      AND ticket.pay_by <= ? AND NOT ${ticketPaymentProcessingSql("ticket.id")}`,
              bindings: [ticket.id, nowIso()],
            }),
            ...statements,
            prepareAuditLog(
              db,
              "system",
              null,
              "registration_cancelled_unpaid",
              "registration",
              ticket.registration_id,
              {
                eventId: ticket.event_id,
              },
            ),
          ]),
      );
      released += 1;
    } catch (error) {
      // Paid or changed meanwhile: nothing was written, and the next run judges it again.
      if (isStateGuardFailure(error) || (error instanceof AppError && error.code === "REGISTRATION_CHANGED")) continue;
      failed += 1;
      logError("TICKET_UNPAID_RELEASE_FAILED", { registrationId: ticket.registration_id });
    }
  }
  return { released, failed };
}
