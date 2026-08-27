import { slugPattern } from "./schemas/api-common";

export const EVENT_FLOW_SUFFIXES = {
  registration: "register",
  registrationConfirm: "register/confirm",
  registrationManage: "register/manage",
  proposal: "propose",
  proposalManage: "propose/manage",
  speakerManage: "propose/speaker",
  speakerPresentation: "propose/presentation",
  inviteDecline: "invite/decline",
} as const;

export type EventFlowKind = keyof typeof EVENT_FLOW_SUFFIXES;

const flowBySuffix = new Map<string, EventFlowKind>(
  Object.entries(EVENT_FLOW_SUFFIXES).map(([flow, suffix]) => [suffix, flow as EventFlowKind]),
);

export interface EventFlowPathContext {
  eventSlug: string;
  eventBasePath: string;
  flow: EventFlowKind;
}

/** Builds one canonical event-flow path from the shared suffix registry. */
export function buildEventFlowPath(eventBasePath: string, flow: EventFlowKind): string {
  const base = eventBasePath.endsWith("/") ? eventBasePath : `${eventBasePath}/`;
  return `${base}${EVENT_FLOW_SUFFIXES[flow]}/`;
}

/**
 * Parses only the canonical event-flow paths owned by the platform. Both the
 * current year-scoped form and the legacy yearless form are supported. Other
 * event pages deliberately remain outside this parser and the Worker fallback.
 */
export function parseEventFlowPath(pathname: string): EventFlowPathContext | null {
  if (pathname.includes("%") || pathname.includes("\\")) return null;
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "events") return null;

  // Try the yearless grammar first so a valid four-digit slug remains
  // reachable at /events/2026/register/. A year-scoped path has an extra
  // segment and therefore cannot accidentally match a known flow suffix.
  for (const slugIndex of [1, 2]) {
    if (slugIndex === 2 && !/^\d{4}$/.test(segments[1] ?? "")) continue;
    const eventSlug = segments[slugIndex];
    if (!eventSlug || !slugPattern.test(eventSlug)) continue;

    const suffix = segments.slice(slugIndex + 1).join("/");
    const flow = flowBySuffix.get(suffix);
    if (!flow) continue;

    return {
      eventSlug,
      eventBasePath: `/${segments.slice(0, slugIndex + 1).join("/")}/`,
      flow,
    };
  }
  return null;
}
