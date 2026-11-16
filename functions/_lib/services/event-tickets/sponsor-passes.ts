/**
 * Sponsor passes: each tier gives a sponsor a number of staff passes and a
 * number of customer invitations. Every active sponsor of the event gets two
 * codes made from its tier, one per kind. Creating them again is safe: a code
 * that exists is kept, and its limit is raised when the tier now gives more.
 * A limit is never lowered, so a pass someone was promised stays.
 */
import type { EventTicketSponsorPassesUpdate } from "../../../../assets/shared/schemas/event-tickets";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { all } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { commitConfigurationChange, generateTicketCode, prepareConfigurationChange } from "./configuration";

export async function saveSponsorPasses(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  event: { id: string },
  input: EventTicketSponsorPassesUpdate,
): Promise<{ revision: number }> {
  const now = nowIso();
  const statements: StatementLike[] = [
    ...prepareConfigurationChange(db, actor, event.id, input.expectedRevision, now),
    db
      .prepare(
        `UPDATE event_ticket_settings SET
           sponsor_staff_ticket_type_id = (SELECT id FROM event_ticket_types WHERE id = ? AND event_id = ?),
           sponsor_customer_ticket_type_id = (SELECT id FROM event_ticket_types WHERE id = ? AND event_id = ?)
         WHERE event_id = ?`,
      )
      .bind(input.staffTicketTypeId, event.id, input.customerTicketTypeId, event.id, event.id),
    db.prepare("DELETE FROM event_ticket_sponsor_passes WHERE event_id = ?").bind(event.id),
  ];
  for (const tier of input.tiers)
    if (tier.staffPasses > 0 || tier.customerPasses > 0)
      statements.push(
        db
          .prepare(
            "INSERT INTO event_ticket_sponsor_passes (event_id, tier_name, staff_passes, customer_passes) VALUES (?, ?, ?, ?)",
          )
          .bind(event.id, tier.tierName, tier.staffPasses, tier.customerPasses),
      );
  statements.push(
    prepareAuditLog(db, "user", actor.id, "event_ticket_sponsor_passes_changed", "event", event.id, {
      tiers: input.tiers.length,
    }),
  );
  await commitConfigurationChange(db, statements);
  return { revision: input.expectedRevision + 1 };
}

interface SponsorPassRow {
  sponsorship_id: string;
  sponsor_name: string;
  staff_passes: number;
  customer_passes: number;
  staff_ticket_type_id: string | null;
  customer_ticket_type_id: string | null;
  staff_code_id: string | null;
  staff_max_uses: number | null;
  customer_code_id: string | null;
  customer_max_uses: number | null;
}

/** Gives every active sponsor its two codes, and raises a code whose tier now gives more passes. */
export async function issueSponsorPassCodes(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  event: { id: string },
): Promise<{ created: number; raised: number }> {
  const sponsors = await all<SponsorPassRow>(
    db,
    `SELECT sponsor.id AS sponsorship_id,
            COALESCE(organization.name, sponsor.non_member_name, 'Sponsor') AS sponsor_name,
            passes.staff_passes, passes.customer_passes,
            settings.sponsor_staff_ticket_type_id AS staff_ticket_type_id,
            settings.sponsor_customer_ticket_type_id AS customer_ticket_type_id,
            staff.id AS staff_code_id, staff.max_uses AS staff_max_uses,
            customers.id AS customer_code_id, customers.max_uses AS customer_max_uses
     FROM sponsorships sponsor
     JOIN event_ticket_sponsor_passes passes ON passes.event_id = sponsor.event_id AND passes.tier_name = sponsor.tier
     JOIN event_ticket_settings settings ON settings.event_id = sponsor.event_id
     LEFT JOIN organizations organization ON organization.id = sponsor.organization_id
     LEFT JOIN event_ticket_codes staff ON staff.sponsorship_id = sponsor.id AND staff.pass_kind = 'staff'
     LEFT JOIN event_ticket_codes customers ON customers.sponsorship_id = sponsor.id AND customers.pass_kind = 'customers'
     WHERE sponsor.event_id = ? AND sponsor.pipeline_stage = 'active'
     ORDER BY sponsor_name, sponsor.id LIMIT 500`,
    [event.id],
  );
  if (!sponsors.length)
    throw new AppError(
      409,
      "SPONSOR_PASSES_UNAVAILABLE",
      "No active sponsor has a tier with passes. Set the passes per tier first.",
    );
  const now = nowIso();
  const statements: StatementLike[] = [
    preparePermissionsAuthorizationGuard(db, actor, [
      { permission: "events:write", context: { type: "event", id: event.id } },
    ]),
  ];
  let created = 0;
  let raised = 0;
  for (const sponsor of sponsors) {
    for (const kind of ["staff", "customers"] as const) {
      const passes = kind === "staff" ? sponsor.staff_passes : sponsor.customer_passes;
      const ticketTypeId = kind === "staff" ? sponsor.staff_ticket_type_id : sponsor.customer_ticket_type_id;
      const codeId = kind === "staff" ? sponsor.staff_code_id : sponsor.customer_code_id;
      const maxUses = kind === "staff" ? sponsor.staff_max_uses : sponsor.customer_max_uses;
      if (passes === 0 || !ticketTypeId) continue;
      if (!codeId) {
        created += 1;
        statements.push(
          db
            .prepare(
              `INSERT INTO event_ticket_codes
                 (id, event_id, ticket_type_id, label, code, amount, max_uses, sponsorship_id, pass_kind,
                  created_by_user_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(sponsorship_id, pass_kind) WHERE sponsorship_id IS NOT NULL DO NOTHING`,
            )
            .bind(
              uuid(),
              event.id,
              ticketTypeId,
              `${sponsor.sponsor_name}: ${kind}`,
              generateTicketCode(),
              passes,
              sponsor.sponsorship_id,
              kind,
              actor.id,
              now,
              now,
            ),
        );
      } else if ((maxUses ?? 0) < passes) {
        raised += 1;
        statements.push(
          db
            .prepare("UPDATE event_ticket_codes SET max_uses = ?, updated_at = ? WHERE id = ? AND max_uses < ?")
            .bind(passes, now, codeId, passes),
        );
      }
    }
  }
  statements.push(
    prepareAuditLog(db, "user", actor.id, "event_ticket_sponsor_codes_issued", "event", event.id, { created, raised }),
  );
  await db.batch(statements);
  return { created, raised };
}
