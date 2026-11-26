import { REPRESENTATIVE_ROLE_IDS } from "../../../assets/shared/schemas/representative-roles";
import { organizationContactRoleActivePredicate } from "./organization-contact-role";

const SQL_ALIAS = /^[a-z_]+$/;
const SQL_COLUMN = /^[a-z_]+\.[a-z_]+$/;

function assertAlias(alias: string): string {
  if (!SQL_ALIAS.test(alias)) throw new Error("Invalid sponsorship SQL alias");
  return alias;
}

/**
 * Joins terms as a balanced AND tree. SQLite parses `a AND b AND c …` left-deep, one level per term, and these
 * sponsor predicates nest inside authorization SQL that is already close to D1's expression-depth limit.
 */
function allOf(terms: readonly string[]): string {
  if (terms.length === 1) return terms[0]!;
  const middle = Math.ceil(terms.length / 2);
  return `(${allOf(terms.slice(0, middle))} AND ${allOf(terms.slice(middle))})`;
}

function activeSponsorshipStageTerms(sponsorAlias: string): string[] {
  return [
    `${sponsorAlias}.pipeline_stage='active'`,
    `${sponsorAlias}.ended_reason IS NULL`,
    `COALESCE(${sponsorAlias}.renewal_date,'9999-12-31')>strftime('%Y-%m-%d','now')`,
  ];
}

function activeEventSponsorTerms(sponsorAlias: string): string[] {
  return [
    `${sponsorAlias}.sponsor_type='event'`,
    ...activeSponsorshipStageTerms(sponsorAlias),
    `${sponsorAlias}.event_id IS NOT NULL`,
  ];
}

export function activeEventSponsorSql(sponsorAlias: string): string {
  return allOf(activeEventSponsorTerms(sponsorAlias));
}

function activeConsortiumSponsorTerms(sponsorAlias: string): string[] {
  return [
    `${sponsorAlias}.sponsor_type='consortium'`,
    ...activeSponsorshipStageTerms(sponsorAlias),
    `${sponsorAlias}.tier IS NOT NULL`,
  ];
}

/** Consortium staff keep capturing, and uploading offline scans, this long after an admitting event ends. */
const CONSORTIUM_CAPTURE_GRACE = "-2 days";

function captureWindowOpenSql(eventAlias: string): string {
  return `COALESCE(${eventAlias}.ends_at,'9999-12-31')>strftime('%Y-%m-%dT%H:%M:%fZ','now','${CONSORTIUM_CAPTURE_GRACE}')`;
}

/**
 * A sponsorship that can hold leads at some event: an active event sponsorship, or an active consortium
 * sponsorship whose tier at least one event admits for lead capture. For `capture`, that event must not have
 * ended beyond the grace period, so an admission never leaves the organization's staff capturing for good;
 * reading keeps every admitting event, so leads stay reviewable after the event. Pair it with
 * {@link activeLeadSponsorOfEventSql} wherever the event is known.
 */
export function activeLeadSponsorshipSql(sponsorAlias: string, purpose: "capture" | "read" = "read"): string {
  const sponsor = assertAlias(sponsorAlias);
  const admitted =
    purpose === "capture"
      ? `EXISTS(SELECT 1 FROM event_consortium_lead_tiers any_lead_tier
          JOIN events capturing_event ON capturing_event.id=any_lead_tier.event_id
          WHERE any_lead_tier.tier=${sponsor}.tier
            AND ${captureWindowOpenSql("capturing_event")})`
      : `EXISTS(SELECT 1 FROM event_consortium_lead_tiers any_lead_tier WHERE any_lead_tier.tier=${sponsor}.tier)`;
  return `(${activeEventSponsorSql(sponsor)} OR ${allOf([...activeConsortiumSponsorTerms(sponsor), admitted])})`;
}

/**
 * The sponsorships that hold leads at one event: its own active event sponsorships, and the active consortium
 * sponsorships whose tier the event admits for lead capture. An organization that also sponsors the event
 * directly captures only as that event sponsor, so it scans into one lead list per event. Consortium capture
 * also closes two days after the event ends. For `read`, a
 * consortium sponsorship that already holds leads there stays readable, so those leads never disappear.
 * `eventColumn` is a column reference, never a placeholder, because the predicate repeats it.
 */
export function activeLeadSponsorOfEventSql(
  sponsorAlias: string,
  eventColumn: string,
  purpose: "capture" | "read" = "capture",
): string {
  const sponsor = assertAlias(sponsorAlias);
  if (!SQL_COLUMN.test(eventColumn)) throw new Error("Invalid event SQL column");
  const directSponsor = allOf([
    `direct_sponsor.organization_id=${sponsor}.organization_id`,
    `direct_sponsor.event_id=${eventColumn}`,
    ...activeEventSponsorTerms("direct_sponsor"),
  ]);
  const noDirectSponsor = `NOT EXISTS(SELECT 1 FROM sponsorships direct_sponsor WHERE ${directSponsor})`;
  return `(${allOf([`${sponsor}.event_id=${eventColumn}`, ...activeEventSponsorTerms(sponsor)])} OR ${allOf([
    ...activeConsortiumSponsorTerms(sponsor),
    purpose === "capture"
      ? `EXISTS(SELECT 1 FROM event_consortium_lead_tiers event_lead_tier
          JOIN events lead_tier_event ON lead_tier_event.id=event_lead_tier.event_id
          WHERE event_lead_tier.event_id=${eventColumn} AND event_lead_tier.tier=${sponsor}.tier
            AND ${captureWindowOpenSql("lead_tier_event")})`
      : `EXISTS(SELECT 1 FROM event_consortium_lead_tiers event_lead_tier
          WHERE event_lead_tier.event_id=${eventColumn} AND event_lead_tier.tier=${sponsor}.tier)`,
    purpose === "read"
      ? `(${noDirectSponsor} OR EXISTS(SELECT 1 FROM event_sponsor_leads held_lead
          WHERE held_lead.event_id=${eventColumn} AND held_lead.sponsor_id=${sponsor}.id))`
      : noDirectSponsor,
  ])})`;
}

/** One active capturing lead sponsorship at one event, by id; bind the sponsorship id, then the event id. */
export const LEAD_SPONSOR_OF_EVENT_SQL = `SELECT sponsor.id FROM events scoped_event JOIN sponsorships sponsor ON sponsor.id=?
  WHERE scoped_event.id=? AND ${activeLeadSponsorOfEventSql("sponsor", "scoped_event.id")}`;

/** {@link LEAD_SPONSOR_OF_EVENT_SQL} for reading the leads it already holds. */
export const LEAD_SPONSOR_READ_OF_EVENT_SQL = `SELECT sponsor.id FROM events scoped_event JOIN sponsorships sponsor ON sponsor.id=?
  WHERE scoped_event.id=? AND ${activeLeadSponsorOfEventSql("sponsor", "scoped_event.id", "read")}`;

/** Live, exact sponsor capture access for an active representative of its organization. */
export function sponsorOrganizationCapturePredicateSql(identityAlias: string, sponsorAlias: string): string {
  return allOf([
    `${identityAlias}.organization_id IS NOT NULL`,
    `${identityAlias}.started_at IS NOT NULL`,
    `${identityAlias}.ended_at IS NULL`,
    `${identityAlias}.blocked_at IS NULL`,
    activeLeadSponsorshipSql(sponsorAlias, "capture"),
  ]);
}

/** Internal SQL expressions only; bind the user and sponsor values at each caller. */
export function sponsorOrganizationCaptureExistsSql(
  userExpression: string,
  sponsorExpression?: string,
  eventExpression?: string,
): string {
  return `EXISTS(SELECT 1 FROM identities linked_identity
    JOIN sponsorships linked_sponsor ON linked_sponsor.organization_id=linked_identity.organization_id
    JOIN users linked_operator ON linked_operator.id=linked_identity.user_id
    WHERE ${allOf([
      `linked_identity.user_id=${userExpression}`,
      "linked_operator.active=1",
      "linked_operator.pii_redacted_at IS NULL",
      "linked_operator.merged_into_user_id IS NULL",
      sponsorOrganizationCapturePredicateSql("linked_identity", "linked_sponsor"),
      ...(sponsorExpression ? [`linked_sponsor.id=${sponsorExpression}`] : []),
      ...(eventExpression ? [activeLeadSponsorOfEventSql("linked_sponsor", eventExpression)] : []),
    ])})`;
}

function verifiedSponsorMailboxSql(userAlias: string, sponsorAlias: string): string {
  const mailbox = `lower(trim(${sponsorAlias}.contact_email))`;
  return `(${sponsorAlias}.contact_email IS NOT NULL AND (
    (${userAlias}.email_verified_at IS NOT NULL AND ${userAlias}.normalized_email=${mailbox})
    OR EXISTS(SELECT 1 FROM user_emails verified_email
      WHERE verified_email.user_id=${userAlias}.id AND verified_email.verified_at IS NOT NULL
        AND verified_email.normalized_email=${mailbox})
  ))`;
}

/** Only the verified sponsorship mailbox or its member organization's active primary contact sees all leads. */
export function sponsorLeadViewerPredicateSql(userExpression: string, sponsorAlias: string): string {
  return `${activeLeadSponsorshipSql(sponsorAlias)}
    AND EXISTS(SELECT 1 FROM users viewer WHERE ${allOf([
      `viewer.id=${userExpression}`,
      "viewer.active=1",
      "viewer.pii_redacted_at IS NULL",
      "viewer.merged_into_user_id IS NULL",
    ])}
      AND (
        ${verifiedSponsorMailboxSql("viewer", sponsorAlias)}
        OR EXISTS(SELECT 1 FROM members member
          JOIN user_roles role ON role.context_type='organization' AND role.context_id=member.id
            AND role.role_id='${REPRESENTATIVE_ROLE_IDS.primaryContact}' AND role.user_id=viewer.id
          JOIN identities identity ON identity.id=role.identity_id AND identity.user_id=viewer.id
            AND identity.organization_id=${sponsorAlias}.organization_id
          JOIN identity_member_capacities capacity
            ON capacity.identity_id=identity.id AND capacity.member_id=member.id
          WHERE member.organization_id=${sponsorAlias}.organization_id AND member.status='active'
            AND ${organizationContactRoleActivePredicate(
              "role",
              "viewer",
              "identity",
              "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            )})
      ))`;
}

/** A separate lookup over required permissions keeps sponsor policy within D1's expression-depth limit. */
export function sponsorLeadCapacityForRequirements(userId: string, permissions: readonly string[]) {
  const predicates: string[] = [];
  if (permissions.includes("agenda:leads_capture"))
    predicates.push(
      `(target.permission='agenda:leads_capture' AND ${sponsorOrganizationCaptureExistsSql("?", "sponsor.id")})`,
    );
  if (permissions.includes("agenda:leads_view") || permissions.includes("agenda:leads_export"))
    predicates.push(`(target.permission IN ('agenda:leads_view','agenda:leads_export')
      AND ${sponsorLeadViewerPredicateSql("?", "sponsor")})`);
  if (!predicates.length) return null;
  return {
    sql: `SELECT target.permission, sponsor.id
          FROM required target JOIN sponsorships sponsor ON sponsor.id=target.context_id
         WHERE target.context_type='event_sponsor' AND (${predicates.join(" OR ")})`,
    bindings: predicates.map(() => userId),
  };
}

/** Internal SQL expressions only; callers bind user and sponsor IDs. */
export function sponsorLeadViewerExistsSql(userExpression: string, sponsorExpression: string): string {
  return `EXISTS(SELECT 1 FROM sponsorships viewer_sponsor
    WHERE viewer_sponsor.id=${sponsorExpression}
      AND ${sponsorLeadViewerPredicateSql(userExpression, "viewer_sponsor")})`;
}

/** Staff sign-in needs only the mailbox path; organization contacts already hold a user role. */
export function sponsorContactMailboxExistsSql(userExpression: string): string {
  return `EXISTS(SELECT 1 FROM sponsorships contact_sponsor JOIN users contact_user
    ON contact_user.id=${userExpression}
    WHERE ${activeLeadSponsorshipSql("contact_sponsor")}
      AND contact_user.active=1 AND contact_user.pii_redacted_at IS NULL
      AND contact_user.merged_into_user_id IS NULL
      AND ${verifiedSponsorMailboxSql("contact_user", "contact_sponsor")})`;
}
