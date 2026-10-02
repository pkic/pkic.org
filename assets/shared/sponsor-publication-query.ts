import { sponsorsListQuerySchema } from "./schemas/public-sponsors";

/** The shortcode's published selection uses the canonical sponsor query contract. */
export function sponsorPublicationQuery(data: Record<string, string | undefined>) {
  const eventSlug = data.eventSlug || data["event-slug"];
  return sponsorsListQuerySchema.parse({
    eventSlug: eventSlug || undefined,
    eventName: eventSlug ? undefined : data.eventName || data.sponsoring || undefined,
    level: data.level && data.level !== "all" ? data.level : undefined,
    minWeight: data.mode === "strip" ? Number(data.minWeight ?? 5) : undefined,
    sort: "-weight",
    limit: data.mode === "strip" ? Number(data.maxItems ?? 200) : 200,
    offset: 0,
  });
}

export function sponsorPublicationKey(data: Record<string, string | undefined>): string {
  return JSON.stringify(sponsorPublicationQuery(data));
}
