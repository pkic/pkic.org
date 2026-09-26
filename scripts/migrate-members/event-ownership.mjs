import { EVENT_NAME_ALIASES } from "./constants.mjs";
import { sqlString } from "../lib/sql.mjs";

function legacyEventSlugs() {
  return [...Object.values(EVENT_NAME_ALIASES).map((event) => event.slug), "pqc-conference-amsterdam-nl"];
}

/** Known imported PQC conferences belong to the PQC working group. Preserve later staff assignments. */
export function legacyEventOwnershipSql() {
  const slugs = legacyEventSlugs();
  return `UPDATE events SET owner_group_id = (SELECT id FROM groups WHERE slug = 'pqc'),
    profile_key = COALESCE(profile_key, 'conference'),
    source_mode = COALESCE(source_mode, 'hugo'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE owner_group_id IS NULL AND slug IN (${slugs.map(sqlString).join(", ")})
      AND EXISTS (SELECT 1 FROM groups WHERE slug = 'pqc');`;
}

/**
 * The registration and proposal questions the public site attached to those
 * conferences are event-scoped forms with no placement: the placement model
 * arrived with the portal, and the schema migration only placed the
 * membership application. Without a placement a form is invisible to the
 * owning group — its Forms tab lists placements, and the event's registration
 * settings read the attached form through one — even though the event route
 * still serves it. Once the conference belongs to the group, each of its
 * forms gets the placement a portal-authored form would have had, owned by
 * the same group and open to the audience its purpose implies.
 */
export function legacyEventFormPlacementSql() {
  const slugs = legacyEventSlugs();
  return `INSERT OR IGNORE INTO form_placements
    (id, form_id, owner_group_id, context_type, context_ref, audience, active, opens_at, closes_at, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), f.id, e.owner_group_id, 'event', e.id,
         CASE f.purpose WHEN 'event_registration' THEN 'attendee' WHEN 'proposal_submission' THEN 'speaker' ELSE f.purpose END,
         CASE WHEN f.status = 'active' THEN 1 ELSE 0 END, NULL, NULL,
         strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM forms f
    JOIN events e ON e.id = f.scope_ref
   WHERE f.scope_type = 'event'
     AND e.owner_group_id IS NOT NULL
     AND e.slug IN (${slugs.map(sqlString).join(", ")})
     AND NOT EXISTS (
       SELECT 1 FROM form_placements fp
        WHERE fp.form_id = f.id AND fp.context_type = 'event' AND fp.context_ref = e.id
     );`;
}
