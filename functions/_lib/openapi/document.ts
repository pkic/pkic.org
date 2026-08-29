/**
 * Document-level OpenAPI metadata.
 *
 * The spec previously carried only a title and version, so the rendered
 * reference opened with no explanation of what the API is, how to authenticate,
 * or which host to call — and its sidebar was a flat, alphabetical list of
 * every tag with no descriptions. Grouping and describing the tags is what
 * turns that list into a navigable reference.
 */

export const OPENAPI_INFO = {
  title: "PKI Consortium API",
  version: "v1",
  description: [
    "The PKI Consortium platform API. It serves the public website, the member",
    "portal, and integrations.",
    "",
    "## Authentication",
    "",
    "Most operations require a session bearer token, obtained through the",
    "authentication endpoints. Operations that need one declare a",
    "`BearerAuth` requirement together with the exact permissions they check;",
    "an operation with no declared requirement has not yet been annotated and",
    "should not be assumed public.",
    "",
    "Some flows are authorised by a capability carried in the request itself —",
    "a management link or a signed invitation — rather than by a session.",
    "Those publish no session requirement because a bearer token is not what",
    "grants access.",
    "",
    "## Conventions",
    "",
    "Listing endpoints share one query contract: `q` for search, `sort` for an",
    "allow-listed column with a `-` prefix for descending, and `limit` /",
    "`offset` for pagination. They return the rows alongside a `page` object.",
    "Filtering, sorting, counting, and pagination happen in the database, so a",
    "page is never a slice of a larger fetched set.",
    "",
    "Errors share one envelope: an `error` object with a stable `code`, a",
    "human-readable `message`, and optional `details`. Clients should branch on",
    "`code` rather than on the message text.",
    "",
    "Timestamps are ISO-8601 UTC with millisecond precision and an explicit",
    "`Z`. Values that represent a wall clock also carry an IANA time zone.",
  ].join("\n"),
} as const;

/** Ordered tag descriptions. Order here is the order ReDoc renders. */
export const OPENAPI_TAGS: readonly { name: string; description: string }[] = [
  { name: "Authentication", description: "Session sign-in, sign-out, and the current session." },
  { name: "Passkeys", description: "WebAuthn credential registration and authentication." },

  { name: "Events", description: "The event catalogue and one event's configuration." },
  { name: "Event registrations", description: "Attendee registration, attendance days, and waitlists." },
  { name: "Event proposals", description: "Submitted session proposals for an event." },
  { name: "Proposals", description: "Public proposal submission." },
  { name: "Proposal management", description: "Programme-committee review and decisions." },
  { name: "Proposal reviews", description: "Individual reviewer scores and comments." },
  { name: "Proposal speakers", description: "Speakers on a proposal, and their invitations." },
  { name: "Proposal presentations", description: "Uploaded presentation files and their versions." },
  { name: "Proposal programs", description: "Programme membership for a proposal." },
  { name: "Speakers", description: "Speaker records and their profiles." },
  { name: "Presentations", description: "Presentation files, versions, and archives." },
  { name: "Headshots", description: "Speaker headshot upload and review." },
  { name: "Event invites", description: "Attendee and speaker invitations to an event." },
  { name: "Meetings", description: "Recurring meeting series, occurrences, and guest access." },
  { name: "Calendar", description: "Generated calendar artefacts and inbound RSVP handling." },
  { name: "Invites", description: "Invitation issue, acceptance, and decline." },
  { name: "Registrations", description: "Self-service registration management by link." },

  { name: "Groups", description: "Working groups, committees, and other collaboration groups." },
  { name: "Votes", description: "Votes and ballots." },
  { name: "Group Vote Management", description: "Managing a group's votes." },
  { name: "Group Vote Proposals", description: "Proposing a vote to a group." },
  { name: "Forms", description: "Reusable form definitions, placements, and responses." },

  { name: "Members", description: "The member directory." },
  { name: "Membership", description: "Membership applications, categories, and workflow settings." },
  { name: "Organizations", description: "Member organizations and their representatives." },
  { name: "Organization content reviews", description: "Review of organization-submitted content." },
  { name: "Leadership", description: "Board and Executive Council positions." },
  { name: "Users", description: "User records and their administration." },

  { name: "Sponsors", description: "Sponsors and sponsorship." },
  { name: "Sponsorship", description: "Sponsorship inquiry, tiers, and checkout." },
  { name: "Sponsorships", description: "The sponsorship pipeline." },
  { name: "Donations", description: "Donations and payment handling." },

  { name: "Email", description: "The outbound email outbox and reminder runs." },
  { name: "Email templates", description: "Versioned email templates." },
  { name: "Email campaigns", description: "Composed campaigns and their sends." },
  { name: "Reminders", description: "Reminder cycles that queue into the outbox." },
  { name: "Scheduler", description: "Recurring jobs, their schedule, and their outcomes." },
  { name: "Retention", description: "Data retention policy and redaction." },
  { name: "Analytics", description: "Platform and event analytics." },
  { name: "Statistics", description: "Aggregate counts and reporting figures." },
  { name: "Audit log", description: "The audit trail." },
  { name: "Permissions", description: "Permission grants." },
  { name: "Roles", description: "Roles and their permissions." },
  { name: "System", description: "Platform-wide administration." },

  { name: "Public", description: "Endpoints served to anonymous visitors." },
];

/**
 * ReDoc renders these as sidebar sections. Any tag omitted here still appears,
 * so a new tag is never hidden by forgetting to group it.
 */
export const OPENAPI_TAG_GROUPS: readonly { name: string; tags: string[] }[] = [
  { name: "Authentication", tags: ["Authentication", "Passkeys"] },
  {
    name: "Events and meetings",
    tags: [
      "Events",
      "Event registrations",
      "Event proposals",
      "Proposals",
      "Proposal management",
      "Proposal reviews",
      "Proposal speakers",
      "Proposal presentations",
      "Proposal programs",
      "Speakers",
      "Presentations",
      "Headshots",
      "Event invites",
      "Meetings",
      "Calendar",
      "Invites",
      "Registrations",
    ],
  },
  {
    name: "Groups and collaboration",
    tags: ["Groups", "Votes", "Group Vote Management", "Group Vote Proposals", "Forms"],
  },
  {
    name: "Membership",
    tags: ["Members", "Membership", "Organizations", "Organization content reviews", "Leadership", "Users"],
  },
  {
    name: "Sponsorship and donations",
    tags: ["Sponsors", "Sponsorship", "Sponsorships", "Donations"],
  },
  {
    name: "Platform operations",
    tags: [
      "Email",
      "Email templates",
      "Email campaigns",
      "Reminders",
      "Scheduler",
      "Retention",
      "Analytics",
      "Statistics",
      "Audit log",
      "Permissions",
      "Roles",
      "System",
    ],
  },
  { name: "Public", tags: ["Public"] },
];
