import type { DatabaseLike, Env } from "../types";
import { logError, logInfo } from "../logging";
import { queueEmail } from "../email/outbox";
import { prepareAuditLog } from "./audit";

interface PendingRsvpEvent {
  id: string;
  registration_id: string;
  response_status: string;
  received_at: string;
  warning_sent_at: string | null;
  event_id: string;
  user_id: string;
  starts_at: string | null;
  attendance_type: string;
  settings_json: string;
  user_email: string;
  first_name: string | null;
  event_name: string;
}

export async function runRsvpEnforcer(db: DatabaseLike, env: Env): Promise<{
  bouncesProcessed: number;
  warningsSent: number;
  downgradesProcessed: number;
}> {
  logInfo("RSVP_ENFORCER_STARTED");

  let bouncesProcessed = 0;
  let warningsSent = 0;
  let downgradesProcessed = 0;

  try {
    // 1. Process Bounces Immediately
    // A bounce indicates they aren't receiving emails at all, so we cancel to free the seat.
    const bounces = await db.prepare(
      `SELECT rsvp.id, rsvp.registration_id, r.event_id, r.user_id 
       FROM calendar_rsvp_events rsvp
       JOIN registrations r ON rsvp.registration_id = r.id
       WHERE rsvp.response_status = 'bounced' AND rsvp.action_executed_at IS NULL`
    ).all<{ id: string; registration_id: string; event_id: string; user_id: string }>();

    for (const b of bounces.results || []) {
      await db.batch([
        db.prepare(
          `UPDATE registrations SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`
        ).bind(b.registration_id),
        db.prepare(
          `UPDATE calendar_rsvp_events SET action_executed_at = datetime('now'), action_taken = 'cancelled_due_to_bounce' WHERE id = ?`
        ).bind(b.id),
        prepareAuditLog(db, "system", null, "cancelled_bounce", "registration", b.registration_id, { reason: "bounced_rsvp" })
      ]);
      bouncesProcessed++;
    }

    // 2. Process Warnings for Declined / Tentative
    const warnings = await db.prepare(
      `SELECT rsvp.id, rsvp.registration_id, r.event_id, r.user_id, rsvp.attendee_email,
              e.name as event_name, e.slug as event_slug, r.manage_token_hash, u.first_name
       FROM calendar_rsvp_events rsvp
       JOIN registrations r ON rsvp.registration_id = r.id
       JOIN events e ON r.event_id = e.id
       LEFT JOIN users u ON r.user_id = u.id
       WHERE rsvp.response_status IN ('declined', 'tentative') 
         AND rsvp.warning_sent_at IS NULL 
         AND rsvp.action_executed_at IS NULL 
         AND r.attendance_type = 'in_person'
         AND r.status IN ('registered', 'waitlisted')
         AND rsvp.received_at < datetime('now', '-1 hour')`
    ).all<{ id: string; registration_id: string; event_id: string; user_id: string; attendee_email: string; event_name: string; event_slug: string; manage_token_hash: string; first_name: string | null }>();

    for (const w of warnings.results || []) {
      // Check if they already accepted in a newer chronological record
      const newerAccepted = await db.prepare(
        `SELECT id FROM calendar_rsvp_events 
         WHERE registration_id = ? AND response_status = 'accepted' AND received_at > (SELECT received_at FROM calendar_rsvp_events WHERE id = ?)`
      ).bind(w.registration_id, w.id).first();

      if (newerAccepted) {
        // Obsolete warning, skip and mark as ignored
        await db.prepare(
          `UPDATE calendar_rsvp_events SET action_executed_at = datetime('now'), action_taken = 'ignored_newer_accept' WHERE id = ?`
        ).bind(w.id).run();
        continue;
      }

      // Generate a dynamic management link directly from env or app baseUrl if passed in config
      let manageUrl = "";
      if (env.APP_BASE_URL) {
        manageUrl = `${env.APP_BASE_URL}/manage/${w.event_slug}?t=${w.manage_token_hash}`; // Typically needs real token generation logic
      }

      await queueEmail(db, {
        templateKey: "rsvp_warning",
        eventId: w.event_id,
        recipientUserId: w.user_id,
        recipientEmail: w.attendee_email,
        data: {
          firstName: w.first_name ?? "",
          event_name: w.event_name,
          manage_url: manageUrl
        },
        messageType: "transactional"
      });

      await db.prepare(
        `UPDATE calendar_rsvp_events SET warning_sent_at = datetime('now') WHERE id = ?`
      ).bind(w.id).run();
      
      warningsSent++;
    }

    // 3. Process Downgrades / Cancellations
    const pendingActions = await db.prepare(
            `SELECT rsvp.id, rsvp.registration_id, rsvp.response_status, rsvp.received_at, rsvp.warning_sent_at,
              r.event_id, r.user_id, r.attendance_type, 
              e.starts_at, e.settings_json, e.name as event_name, u.email as user_email, u.first_name
       FROM calendar_rsvp_events rsvp
       JOIN registrations r ON rsvp.registration_id = r.id
       JOIN events e ON r.event_id = e.id
       JOIN users u ON r.user_id = u.id
       WHERE rsvp.response_status IN ('declined', 'tentative') 
         AND rsvp.warning_sent_at IS NOT NULL 
         AND rsvp.action_executed_at IS NULL
         AND r.attendance_type = 'in_person'
         AND r.status IN ('registered', 'waitlisted')`
    ).all<PendingRsvpEvent>();

    const now = new Date();

    for (const action of pendingActions.results || []) {
      const startsAt = action.starts_at ? new Date(action.starts_at) : new Date(now.getTime() + 30 * 24 * 3600000); // Assume 30+ days if unknown
      const warningSentAt = new Date(action.warning_sent_at || now.toISOString());
      
      const distanceHours = (startsAt.getTime() - now.getTime()) / 3600000;
      const warnedHours = (now.getTime() - warningSentAt.getTime()) / 3600000;

      let shouldExecute = false;
      if (distanceHours > 14 * 24 && warnedHours >= 48) shouldExecute = true;
      else if (distanceHours <= 14 * 24 && distanceHours > 7 * 24 && warnedHours >= 24) shouldExecute = true;
      else if (distanceHours <= 7 * 24 && warnedHours >= 2) shouldExecute = true;

      if (shouldExecute) {
        // Check if there is a newer accepted status (just in case)
        const newerAccepted = await db.prepare(
          `SELECT id FROM calendar_rsvp_events 
           WHERE registration_id = ? AND response_status = 'accepted' AND received_at > (SELECT received_at FROM calendar_rsvp_events WHERE id = ?)`
        ).bind(action.registration_id, action.id).first();
  
        if (newerAccepted) {
          await db.prepare(
            `UPDATE calendar_rsvp_events SET action_executed_at = datetime('now'), action_taken = 'ignored_newer_accept' WHERE id = ?`
          ).bind(action.id).run();
          continue;
        }

        // Parse event settings to find supported attendance types
        let settings: any = {};
        try {
          settings = action.settings_json ? JSON.parse(action.settings_json) : {};
        } catch(e) {}
        
        const enabledTypes: string[] = settings.enabled_attendance_types || ['in_person'];
        
        let newAttendanceType = action.attendance_type;
        let newStatus = 'registered';
        let actionTaken = '';

        if (enabledTypes.includes('on_demand')) {
          newAttendanceType = 'on_demand';
          actionTaken = 'downgraded_on_demand';
        } else if (enabledTypes.includes('virtual')) {
          newAttendanceType = 'virtual';
          actionTaken = 'downgraded_virtual';
        } else {
          newStatus = 'cancelled';
          actionTaken = 'cancelled';
        }

        // Apply
        await db.batch([
          db.prepare(
            `UPDATE registrations SET attendance_type = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
          ).bind(newAttendanceType, newStatus, action.registration_id),
          db.prepare(
            `UPDATE calendar_rsvp_events SET action_executed_at = datetime('now'), action_taken = ? WHERE id = ?`
          ).bind(actionTaken, action.id),
          prepareAuditLog(db, "system", null, actionTaken, "registration", action.registration_id, {
            previous_attendance_type: action.attendance_type,
            rsvp_id: action.id,
          })
        ]);

        // Send confirmation email
        await queueEmail(db, {
          templateKey: "rsvp_downgraded",
          eventId: action.event_id,
          recipientUserId: action.user_id,
          recipientEmail: action.user_email,
          data: {
            firstName: action.first_name ?? "",
            event_name: action.event_name,
            action_taken: actionTaken,
            new_attendance_type: newAttendanceType,
            new_status: newStatus
          },
          messageType: "transactional"
        });

        downgradesProcessed++;
      }
    }

    logInfo("RSVP_ENFORCER_COMPLETED", { bouncesProcessed, warningsSent, downgradesProcessed });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logError("RSVP_ENFORCER_FAILED", { error: errorMsg });
  }

  return { bouncesProcessed, warningsSent, downgradesProcessed };
}
