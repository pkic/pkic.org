import { z } from "zod";
import { SCREEN_POLICY } from "../../../../assets/shared/event-screen-policy";
import {
  SCREEN_MANAGE_PERMISSION,
  SCREEN_STATUS_PERMISSIONS,
} from "../../../../assets/shared/event-screen-permissions";
import { databaseIdSchema } from "../../../../assets/shared/schemas/identifiers";
import { screenIdSchema } from "../../../../assets/shared/schemas/event-screens";
import { hasPermission } from "../../auth/permissions";
import type { UserSessionResult } from "../../auth/user-session-result";
import type { UserSessionTokenClaims } from "../../auth/user-session-token";
import { prepareUserSessionClaimsBatch } from "../../auth/user-session-live-data";
import { batchRows } from "../../db/pagination";
import type { D1StatementResult, DatabaseLike } from "../../types";

/**
 * Who holds a socket of an event's screen monitor, and the access they were
 * last found to have. The Worker checks access once at admission; the
 * monitor rechecks every open socket together, in one batch, on its alarm.
 * Messages never touch the database: a socket whose recheck is older than
 * the lease, or whose credential expired, is refused until it reconnects.
 */
export const SCREEN_MONITOR_ADMISSION_HEADER = "x-pkic-screen-monitor-admission";
export const SCREEN_MONITOR_SCREEN_TAG = "screen";
export const SCREEN_MONITOR_STAFF_TAG = "staff";

export function screenMonitorName(eventId: string): string {
  return `screens:${eventId}`;
}
export const screenSocketTag = (screenId: string) => `screen:${screenId}`;

const accessFields = {
  eventId: databaseIdSchema,
  /** When access was last confirmed, and when the credential itself ends, in epoch milliseconds. */
  checkedAt: z.number().int().nonnegative(),
  credentialExpiresAt: z.number().int().positive(),
};

const screenAdmissionSchema = z
  .object({
    role: z.literal("screen"),
    screenId: screenIdSchema,
    sessionId: z.string().min(1).max(80),
    ...accessFields,
  })
  .strict();
const staffAdmissionSchema = z
  .object({
    role: z.literal("staff"),
    /** The staff session the socket was opened with, rechecked on every refresh. */
    claims: z.custom<UserSessionTokenClaims>(
      (value) => typeof value === "object" && value !== null && "sid" in value && "sub" in value,
    ),
    /** May send Identify and Reload. */
    control: z.boolean(),
    ...accessFields,
  })
  .strict();
export const screenMonitorAdmissionSchema = z.discriminatedUnion("role", [screenAdmissionSchema, staffAdmissionSchema]);
export type ScreenMonitorAdmission = z.infer<typeof screenMonitorAdmissionSchema>;
export type ScreenAdmission = z.infer<typeof screenAdmissionSchema>;
export type StaffAdmission = z.infer<typeof staffAdmissionSchema>;

/** A socket may act while its last check is within the lease and its credential has not ended. */
export function screenMonitorAccessCurrent(admission: ScreenMonitorAdmission, now: number): boolean {
  return (
    admission.credentialExpiresAt > now && admission.checkedAt + SCREEN_POLICY.monitorAccessLeaseSeconds * 1000 > now
  );
}

const LIVE_SESSION = "session.activated_at IS NOT NULL AND session.revoked_at IS NULL AND session.expires_at>?";

/** A screen's live sign-in and the event it belongs to now. */
export function prepareScreenMonitorScreenRead(db: DatabaseLike, screenId: string, sessionId: string, now: string) {
  return db
    .prepare(
      `SELECT screen.event_id,session.expires_at FROM screen_sessions session JOIN screens screen ON screen.id=session.screen_id
        WHERE session.id=? AND session.screen_id=? AND ${LIVE_SESSION}`,
    )
    .bind(sessionId, screenId, now);
}

/** What a staff session may do with the event's screens: watch, and with screen management also command. */
export function staffScreenAccess(session: UserSessionResult, eventId: string): { control: boolean } | null {
  const staff = session.staff;
  if (!staff) return null;
  const context = { type: "event", id: eventId };
  if (!SCREEN_STATUS_PERMISSIONS.some((permission) => hasPermission(staff, permission, context))) return null;
  return { control: hasPermission(staff, SCREEN_MANAGE_PERMISSION, context) };
}

/**
 * Every open socket's access in one batch: each staff session with its live
 * grants, and each screen's sign-in still live and still in this event.
 * Returns the admission each socket keeps, refreshed, or null to close it.
 */
export function prepareScreenMonitorRefresh(
  db: DatabaseLike,
  eventId: string,
  admissions: readonly ScreenMonitorAdmission[],
  now: number,
) {
  const staff = admissions.filter((admission): admission is StaffAdmission => admission.role === "staff");
  const screens = admissions.filter((admission): admission is ScreenAdmission => admission.role === "screen");
  const staffRead = staff.length
    ? prepareUserSessionClaimsBatch(
        db,
        staff.map((admission) => admission.claims),
      )
    : null;
  const screenRead = db
    .prepare(
      `SELECT session.id AS session_id,session.screen_id,session.expires_at
         FROM json_each(?) requested
         JOIN screen_sessions session ON session.id=json_extract(requested.value,'$.sid')
          AND session.screen_id=json_extract(requested.value,'$.screen')
         JOIN screens screen ON screen.id=session.screen_id
        WHERE ${LIVE_SESSION} AND screen.event_id=?`,
    )
    .bind(
      JSON.stringify(screens.map((admission) => ({ sid: admission.sessionId, screen: admission.screenId }))),
      new Date(now).toISOString(),
      eventId,
    );
  const statements = [...(staffRead?.statements ?? []), screenRead];
  return {
    statements,
    async decode(results: D1StatementResult[]): Promise<(ScreenMonitorAdmission | null)[]> {
      const staffResults = staffRead ? await staffRead.decode(results.slice(0, staffRead.statements.length)) : [];
      const live = new Map(
        batchRows<{ session_id: string; screen_id: string; expires_at: string }>(results.at(-1)!).map((row) => [
          `${row.session_id}:${row.screen_id}`,
          row.expires_at,
        ]),
      );
      let staffIndex = 0;
      return admissions.map((admission) => {
        if (admission.role === "screen") {
          const expiresAt = live.get(`${admission.sessionId}:${admission.screenId}`);
          return expiresAt
            ? {
                ...admission,
                checkedAt: now,
                credentialExpiresAt: Math.min(admission.credentialExpiresAt, Date.parse(expiresAt)),
              }
            : null;
        }
        const result = staffResults[staffIndex++];
        const access = result?.ok ? staffScreenAccess(result.session, eventId) : null;
        return access ? { ...admission, control: access.control, checkedAt: now } : null;
      });
    },
  };
}

/**
 * Which of these screens, kept by the monitor without an open socket, still
 * belong to the event. One removed, replaced by a new device or moved to
 * another event is forgotten, so it stops counting as an offline screen.
 */
export function prepareScreenMonitorMembership(db: DatabaseLike, eventId: string, screenIds: readonly string[]) {
  return {
    statement: db
      .prepare(
        "SELECT screen.id FROM json_each(?) requested JOIN screens screen ON screen.id=requested.value WHERE screen.event_id=?",
      )
      .bind(JSON.stringify(screenIds), eventId),
    decode: (result: D1StatementResult) => new Set(batchRows<{ id: string }>(result).map((row) => row.id)),
  };
}
