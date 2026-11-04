import { vi } from "vitest";
import {
  EVENT_ID,
  REGISTRATION_ENDPOINT,
  MANAGE_ACCESS_ENDPOINT,
  json,
  registrationList,
  attendanceDetail,
} from "./group-event-attendance-fixtures";
import { configuredDays } from "./configured-days";

export function installAttendanceApi(waitlisted: boolean) {
  const requests: Array<{ path: string; method: string; body?: unknown; search?: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      requests.push({ path: url.pathname, method, body, search: url.search });
      if (method === "GET" && url.pathname.endsWith(`/events/${EVENT_ID}/days`)) return json(configuredDays());
      if (method === "GET" && url.pathname.endsWith(`/events/${EVENT_ID}/registrations`)) {
        return json(registrationList());
      }
      if (method === "GET" && url.pathname === REGISTRATION_ENDPOINT) return json(attendanceDetail(waitlisted));
      if (method === "PATCH" && url.pathname === `${REGISTRATION_ENDPOINT}/day-attendance`) {
        return json({ success: true });
      }
      if (method === "PATCH" && url.pathname === REGISTRATION_ENDPOINT) {
        const detail = attendanceDetail(waitlisted);
        return json({ success: true, ...detail, registration: { ...detail.registration, status: "cancelled" } });
      }
      if (method === "POST" && url.pathname === MANAGE_ACCESS_ENDPOINT) {
        return json({ manageUrl: "https://portal.example.test/events/architecture-workshop/manage#token" });
      }
      if (method === "POST" && url.pathname === `${REGISTRATION_ENDPOINT}/notifications`) {
        return json({ success: true, message: "Email queued" });
      }
      if (method === "POST" && url.pathname === `${REGISTRATION_ENDPOINT}/admissions`) {
        return json({
          success: true,
          registration: attendanceDetail(false).registration,
          admittedDayDates: ["2026-09-01"],
        });
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    }),
  );
  return requests;
}
