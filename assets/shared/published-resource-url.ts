import { parseEventFlowPath } from "./event-flow-paths";
import { z } from "zod";

export const publishedFormResourcesSchema = z.record(z.string(), z.json());

/** Canonical keys for public form configuration shipped with a static release. */
export function publishedResourceKey(url: string): string {
  const parsed = new URL(url, "https://publication.invalid");
  parsed.searchParams.sort();
  return parsed.pathname + parsed.search;
}

export function isPublishedFormResource(url: string): boolean {
  const path = new URL(url, "https://publication.invalid").pathname;
  return (
    path === "/api/v1/members/applications/form" ||
    path === "/api/v1/sponsors/tiers" ||
    /^\/api\/v1\/events\/[^/]+\/forms\/placements\/(event_registration|proposal_submission)$/.test(path)
  );
}

/** Ship an event's form configuration only on its own public workflow pages. */
export function publishedFormResourcesForPath(
  resources: z.infer<typeof publishedFormResourcesSchema>,
  pathname: string,
) {
  const flow = parseEventFlowPath(pathname);
  const prefix = flow ? `/api/v1/events/${encodeURIComponent(flow.eventSlug)}/` : null;
  return Object.fromEntries(
    Object.entries(resources).filter(
      ([key]) => !key.startsWith("/api/v1/events/") || (prefix !== null && key.startsWith(prefix)),
    ),
  );
}
