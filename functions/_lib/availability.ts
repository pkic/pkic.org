import { z } from "zod";
import {
  AVAILABILITY_ERROR_CODE,
  maintenanceScheduleSchema,
  type MaintenanceChannel,
  type Availability,
} from "../../assets/shared/schemas/availability";
import { jsonNoStore } from "./http";
import type { Env } from "./types";
import { getStaticAssetsBinding } from "./static-assets";

const instant = z.iso.datetime({ precision: 3 });
/** Deployment configuration stays usable when D1 and the portal are unavailable. */
export function getAvailability(env: Env, now = Date.now(), channel: MaintenanceChannel = "http"): Availability {
  const emergency = (): Availability => ({
    mode: "emergency",
    message: "Online services are temporarily paused. Public information remains available. Please try again later.",
    endsAt: null,
    windows: [],
  });
  const mode = env.SERVICE_MODE || "normal";
  if (!["normal", "maintenance", "emergency"].includes(mode) || mode === "emergency") return emergency();
  let windows: Availability["windows"] = [];
  if (env.MAINTENANCE_SCHEDULE) {
    try {
      windows = maintenanceScheduleSchema
        .parse(JSON.parse(env.MAINTENANCE_SCHEDULE))
        .windows.filter((window) => window.enabled && Date.parse(window.endsAt) > now)
        .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    } catch {
      return emergency();
    }
  }
  const active = windows.filter(
    (window) => window.policy === "pause" && window.channels.includes(channel) && Date.parse(window.startsAt) <= now,
  );
  const start = env.MAINTENANCE_STARTS_AT;
  const end = env.MAINTENANCE_ENDS_AT;
  if (
    (start && !instant.safeParse(start).success) ||
    (end && !instant.safeParse(end).success) ||
    (start && end && Date.parse(end) <= Date.parse(start)) ||
    (start && !end)
  )
    return emergency();
  const withinWindow = Boolean(start && end && now >= Date.parse(start) && now < Date.parse(end));
  const immediate = mode === "maintenance" && (!end || now < Date.parse(end));
  if (immediate || withinWindow || active.length) {
    const manualMessage = "Online services are temporarily unavailable for maintenance. Please try again later.";
    let until = Math.max(
      now,
      ...active.map((window) => Date.parse(window.endsAt)),
      (immediate || withinWindow) && end ? Date.parse(end) : now,
    );
    // Include contiguous overlapping windows when reporting expected restoration.
    for (const window of windows) {
      if (window.policy === "pause" && window.channels.includes(channel) && Date.parse(window.startsAt) <= until)
        until = Math.max(until, Date.parse(window.endsAt));
    }
    return {
      mode: "maintenance",
      message: [...(immediate || withinWindow ? [manualMessage] : []), ...active.map((window) => window.message)].join(
        " ",
      ),
      endsAt: immediate && !end ? null : new Date(until).toISOString(),
      windows,
    };
  }
  return { mode: "normal", message: "Online services are available.", endsAt: null, windows };
}

export function apiStatusResponse(env: Env): Response {
  const availability = getAvailability(env);
  return jsonNoStore({
    name: "PKI Consortium API",
    version: "v1",
    docs: "/api/v1/redocs",
    status: availability.mode === "normal" ? "ok" : "unavailable",
    availability,
  });
}

export function unavailableResponse(availability: Availability): Response {
  const retry = availability.endsAt
    ? Math.max(1, Math.ceil((Date.parse(availability.endsAt) - Date.now()) / 1000))
    : 60;
  return jsonNoStore(
    { error: { code: AVAILABILITY_ERROR_CODE, message: availability.message, details: availability } },
    503,
    { "retry-after": String(retry) },
  );
}

/** Static content stays on the asset binding; private routes never fall back to public data. */
export async function availabilityResponse(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if ((path === "/api/v1" || path === "/api/v1/") && ["GET", "HEAD"].includes(request.method))
    return apiStatusResponse(env);
  const availability = getAvailability(env);
  if (availability.mode === "normal") return null;
  const dynamic = /^\/(api(?:\/|$)|\.well-known(?:\/|$)|r(?:\/|$)|og(?:\/|$)|donate\/r(?:\/|$))/.test(path);
  if (!dynamic && ["GET", "HEAD"].includes(request.method)) {
    const assets = getStaticAssetsBinding(env);
    if (assets) return assets.fetch(request);
    if (env.DEV_STATIC_ORIGIN) {
      const local = new URL(request.url);
      const origin = new URL(env.DEV_STATIC_ORIGIN);
      local.protocol = origin.protocol;
      local.host = origin.host;
      return fetch(new Request(local, request));
    }
  }
  if (!path.startsWith("/api") && request.method === "GET" && request.headers.get("accept")?.includes("text/html")) {
    const assets = getStaticAssetsBinding(env);
    if (assets) {
      const holding = await assets.fetch(new Request(new URL("/maintenance/", request.url)));
      if (holding.ok) {
        const headers = new Headers(holding.headers);
        headers.set("cache-control", "no-store");
        headers.set("retry-after", unavailableResponse(availability).headers.get("retry-after") ?? "60");
        return new Response(holding.body, { status: 503, headers });
      }
    }
  }
  return unavailableResponse(availability);
}
