import {
  SCREEN_MONITOR_PROTOCOL,
  screenMonitorScreenParamsSchema,
  screenMonitorStaffParamsSchema,
} from "../../../assets/shared/schemas/event-screen-monitor";
import { SCREEN_SESSION_ERROR_CODES } from "../../../assets/shared/schemas/event-screens";
import { readScreenSessionToken } from "../auth/screen-session";
import { prepareUserSessionRequest } from "../auth/user-session-request";
import { getUserSessionToken } from "../auth/user-session-token";
import { AppError, isAppError } from "../errors";
import { handleError } from "../http";
import { requireInternalSecret } from "../request";
import { prepareEventBySlug, type EventRecord } from "../services/events";
import {
  SCREEN_MONITOR_ADMISSION_HEADER,
  prepareScreenMonitorScreenRead,
  screenMonitorAdmissionSchema,
  screenMonitorName,
  staffScreenAccess,
  type ScreenMonitorAdmission,
} from "../services/event-screens/screen-monitor-access";
import type { Env } from "../types";
import { nowIso } from "../utils/time";
import { assertLiveSocketHandshake, refusedLiveSocket } from "./live-socket-handshake";

const SCREEN_PATH = /^\/api\/v1\/screens\/([^/]+)\/live\/?$/;
const STAFF_PATH = /^\/api\/v1\/events\/([^/]+)\/screens\/live\/?$/;

/**
 * The event screen monitor's two sockets, dispatched before the HTTP router
 * like the live room's: a screen's own, `GET /api/v1/screens/:screenId/live`
 * with its screen cookie, and staff's, `GET /api/v1/events/:eventSlug/screens/live`
 * with their session. Each admission is one D1 call; a refused one closes
 * the socket with `4000 + status` and the error code.
 */
export function isScreenMonitorSocketPath(request: Request): boolean {
  const path = new URL(request.url).pathname;
  return (
    (SCREEN_PATH.test(path) || STAFF_PATH.test(path)) && request.headers.get("upgrade")?.toLowerCase() === "websocket"
  );
}

async function admitScreen(request: Request, env: Env, rawScreenId: string): Promise<ScreenMonitorAdmission> {
  const params = screenMonitorScreenParamsSchema.safeParse({ screenId: rawScreenId });
  if (!params.success) throw new AppError(404, "SCREEN_NOT_FOUND", "Screen not found");
  const token = await readScreenSessionToken(requireInternalSecret(env), request);
  if (!token.ok || token.claims.sub !== params.data.screenId)
    throw new AppError(401, SCREEN_SESSION_ERROR_CODES.missing, "This screen is not paired.");
  const row = await prepareScreenMonitorScreenRead(env.DB, token.claims.sub, token.claims.sid, nowIso()).first<{
    event_id: string | null;
    expires_at: string;
  }>();
  if (!row) throw new AppError(401, SCREEN_SESSION_ERROR_CODES.missing, "This screen is not paired.");
  if (!row.event_id) throw new AppError(409, "SCREEN_NOT_IN_EVENT", "This screen belongs to no event.");
  return screenMonitorAdmissionSchema.parse({
    role: "screen",
    screenId: token.claims.sub,
    sessionId: token.claims.sid,
    eventId: row.event_id,
    checkedAt: Date.now(),
    credentialExpiresAt: Math.min(token.claims.exp * 1000, Date.parse(row.expires_at)),
  });
}

async function admitStaff(request: Request, env: Env, rawSlug: string): Promise<ScreenMonitorAdmission> {
  const params = screenMonitorStaffParamsSchema.safeParse({ eventSlug: rawSlug });
  if (!params.success) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  if (!getUserSessionToken(request)) throw new AppError(401, "AUTH_REQUIRED", "Sign in to watch the event's screens.");
  const session = await prepareUserSessionRequest(env.DB, request, env);
  const results = await env.DB.batch([...session.statements, prepareEventBySlug(env.DB, params.data.eventSlug)]);
  const resolved = await session.decode(results.slice(0, session.statements.length));
  const event = (results.at(-1)?.results?.[0] as EventRecord | undefined) ?? null;
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  const access = staffScreenAccess(resolved, event.id);
  if (!access)
    throw new AppError(
      403,
      "SCREEN_STATUS_FORBIDDEN",
      "Only staff who manage or operate this event's screens can watch them.",
    );
  return screenMonitorAdmissionSchema.parse({
    role: "staff",
    claims: session.claims,
    control: access.control,
    eventId: event.id,
    checkedAt: Date.now(),
    credentialExpiresAt: session.claims.exp * 1000,
  });
}

export async function screenMonitorSocketRequest(request: Request, env: Env): Promise<Response> {
  try {
    const path = new URL(request.url).pathname;
    const screen = SCREEN_PATH.exec(path);
    const staff = STAFF_PATH.exec(path);
    assertLiveSocketHandshake(request, SCREEN_MONITOR_PROTOCOL);
    const monitors = env.EVENT_SCREEN_MONITORS;
    if (!monitors) throw new AppError(503, "SCREEN_MONITOR_UNAVAILABLE", "The screen monitor is not available.");
    let admission: ScreenMonitorAdmission;
    try {
      admission = screen
        ? await admitScreen(request, env, decodeURIComponent(screen[1]!))
        : await admitStaff(request, env, decodeURIComponent(staff![1]!));
    } catch (error) {
      if (isAppError(error) && error.status >= 400 && error.status < 500)
        return refusedLiveSocket(error, SCREEN_MONITOR_PROTOCOL);
      throw error;
    }
    return await monitors.getByName(screenMonitorName(admission.eventId)).fetch(
      new Request("https://event-screen-monitor/connect", {
        headers: { upgrade: "websocket", [SCREEN_MONITOR_ADMISSION_HEADER]: JSON.stringify(admission) },
      }),
    );
  } catch (error) {
    return handleError(error);
  }
}
