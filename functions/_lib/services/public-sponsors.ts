import { all, first } from "../db/queries";
import type { DatabaseLike } from "../types";

/**
 * Public sponsor display. D1 is the source
 * of truth — `organizations.sponsor_tier` (consortium sponsors, written by
 * `advanceSponsorshipStage` in sponsorship.ts) and active `sponsorships` rows
 * (non-member consortium sponsors, and all event sponsors). Mirrors the
 * "static shell + client-fetch" architecture members-directory.ts already
 * uses for the member directory.
 *
 * A single flat item shape merges general/consortium standing (`tier`) with
 * an optional event-specific standing (`eventTier`) on the same record —
 * matching the old build-time `data/members/*.yaml`/`data/sponsors.yaml`
 * shape, where one sponsor object carried both `sponsor.level` and
 * `sponsor.sponsoring.<event>.level`. This lets callers (the sponsors-wall
 * Preact component) port the old Hugo filtering/grouping logic almost
 * directly.
 */

export interface PublicSponsorItem {
  id: string;
  name: string;
  website: string | null;
  logoUrl: string | null;
  /** Consortium-wide tier (Bronze..Diamond), or null if not a consortium sponsor. */
  tier: string | null;
  /** This event's tier (Ambassador..Leader), only set when ?eventName= matched an event this sponsor sponsors. */
  eventTier: string | null;
}

/**
 * Event name -> D1 events.slug, for the small, fixed set of historical event
 * names the `sponsoring="<Event Name>"` shortcode param uses across each
 * event's content/events/.../index.md. Mirrors the slug half of
 * scripts/migrate-members-yaml-to-d1.mjs's EVENT_NAME_ALIASES — keep the two
 * in sync if a new event with sponsors launches.
 */
const EVENT_SLUG_BY_NAME: Record<string, string> = {
  "Post-Quantum Cryptography Conference Amsterdam 2023": "pqc-conference-amsterdam-nl-2023",
  "Post-Quantum Cryptography Conference Austin 2025": "pqc-conference-austin-us-2025",
  "Post-Quantum Cryptography Conference Kuala Lumpur 2025": "pqc-conference-kuala-lumpur-my-2025",
};

interface ConsortiumOrgRow {
  id: string;
  name: string;
  website: string | null;
  logo_r2_key: string | null;
  sponsor_tier: string;
}

interface NonMemberConsortiumRow {
  id: string;
  non_member_name: string;
  non_member_website: string | null;
  non_member_logo_r2_key: string | null;
  tier: string | null;
}

interface EventSponsorRow {
  id: string;
  organization_id: string | null;
  org_name: string | null;
  org_website: string | null;
  org_logo_r2_key: string | null;
  non_member_name: string | null;
  non_member_website: string | null;
  non_member_logo_r2_key: string | null;
  tier: string | null;
}

/**
 * `eventName` is the free-text string content pages already pass to the
 * `sponsors`/`sponsors-level`/`sponsors-strip` shortcodes (e.g.
 * "Post-Quantum Cryptography Conference Austin 2025") — resolved to a real
 * D1 event via `EVENT_SLUG_BY_NAME`. Unrecognized/omitted names simply
 * return the consortium-only list, same as the old collect.html behaviour
 * when no sponsor happened to match the given `sponsoring` key.
 */
export async function listPublicSponsors(
  db: DatabaseLike,
  params: { eventName?: string } = {},
): Promise<PublicSponsorItem[]> {
  const items = new Map<string, PublicSponsorItem>();

  const [orgRows, nonMemberRows] = await Promise.all([
    all<ConsortiumOrgRow>(
      db,
      `SELECT id, name, website, logo_r2_key, sponsor_tier FROM organizations WHERE sponsor_tier IS NOT NULL`,
    ),
    all<NonMemberConsortiumRow>(
      db,
      `SELECT id, non_member_name, non_member_website, non_member_logo_r2_key, tier
       FROM sponsorships
       WHERE sponsor_type = 'consortium' AND organization_id IS NULL
         AND pipeline_stage = 'active' AND non_member_name IS NOT NULL`,
    ),
  ]);

  for (const row of orgRows) {
    items.set(`org:${row.id}`, {
      id: row.id,
      name: row.name,
      website: row.website,
      logoUrl: row.logo_r2_key ? `/api/v1/members/${row.id}/logo` : null,
      tier: row.sponsor_tier,
      eventTier: null,
    });
  }

  for (const row of nonMemberRows) {
    items.set(`sponsorship:${row.id}`, {
      id: row.id,
      name: row.non_member_name,
      website: row.non_member_website,
      logoUrl: row.non_member_logo_r2_key ? `/api/v1/sponsors/${row.id}/logo` : null,
      tier: row.tier,
      eventTier: null,
    });
  }

  const eventSlug = params.eventName ? EVENT_SLUG_BY_NAME[params.eventName] : undefined;
  if (eventSlug) {
    const event = await first<{ id: string }>(db, `SELECT id FROM events WHERE slug = ?`, [eventSlug]);
    if (event) {
      const eventRows = await all<EventSponsorRow>(
        db,
        `SELECT sp.id, sp.organization_id, o.name AS org_name, o.website AS org_website, o.logo_r2_key AS org_logo_r2_key,
                sp.non_member_name, sp.non_member_website, sp.non_member_logo_r2_key, sp.tier
         FROM sponsorships sp
         LEFT JOIN organizations o ON o.id = sp.organization_id
         WHERE sp.sponsor_type = 'event' AND sp.event_id = ? AND sp.pipeline_stage = 'active'`,
        [event.id],
      );

      for (const row of eventRows) {
        const key = row.organization_id ? `org:${row.organization_id}` : `sponsorship:${row.id}`;
        const existing = items.get(key);
        if (existing) {
          existing.eventTier = row.tier;
          continue;
        }
        items.set(key, {
          id: row.organization_id ?? row.id,
          name: row.organization_id ? (row.org_name ?? "Unknown organization") : (row.non_member_name ?? "Sponsor"),
          website: row.organization_id ? row.org_website : row.non_member_website,
          logoUrl: row.organization_id
            ? row.org_logo_r2_key
              ? `/api/v1/members/${row.organization_id}/logo`
              : null
            : row.non_member_logo_r2_key
              ? `/api/v1/sponsors/${row.id}/logo`
              : null,
          tier: null,
          eventTier: row.tier,
        });
      }
    }
  }

  return Array.from(items.values());
}

/** `id` is a `sponsorships.id` — org-tied sponsor logos are served via GET /api/v1/members/:id/logo instead. */
export async function getNonMemberSponsorLogoR2Key(db: DatabaseLike, id: string): Promise<string | null> {
  const row = await first<{ non_member_logo_r2_key: string | null }>(
    db,
    `SELECT non_member_logo_r2_key FROM sponsorships WHERE id = ?`,
    [id],
  );
  return row?.non_member_logo_r2_key ?? null;
}
