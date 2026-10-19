/** The permission catalog owns display grouping and access semantics, including actions without read/write suffixes. */
export const PERMISSION_DOMAINS = {
  membership: "Membership",
  identities: "Identities",
  events: "Events",
  groups: "Groups",
  "email-templates": "Email templates",
  forms: "Forms",
  email: "Email",
  donations: "Donations",
  users: "Users",
  audit: "Audit history",
  analytics: "Analytics",
  retention: "Data retention",
  scheduler: "Scheduled jobs",
  site: "Website publication",
  access: "Roles and permissions",
  organizations: "Organizations",
  sponsorships: "Sponsorships",
  votes: "Votes",
  proposals: "Proposals",
  agenda: "Agenda and attendance",
  admin: "Platform settings",
} as const;

/** Keys are the canonical OAuth scopes and API permission vocabulary. Presets never invent another scope. */
export const PERMISSION_METADATA = {
  "membership:read": { domain: "membership", access: "read", label: "View membership records" },
  "membership:write": { domain: "membership", access: "write", label: "Update membership records" },
  "identities:activate": { domain: "identities", access: "write", label: "Activate identities" },
  "membership:approve": { domain: "membership", access: "write", label: "Approve membership applications" },
  "events:read": { domain: "events", access: "read", label: "View event configuration" },
  "events:write": { domain: "events", access: "write", label: "Update event configuration" },
  "events:manage": { domain: "events", access: "write", label: "Manage events" },
  "groups:read": { domain: "groups", access: "read", label: "View group records" },
  "groups:write": { domain: "groups", access: "write", label: "Update group records" },
  "email-templates:read": { domain: "email-templates", access: "read", label: "View email templates" },
  "email-templates:write": { domain: "email-templates", access: "write", label: "Edit email templates" },
  "email-templates:manage": { domain: "email-templates", access: "write", label: "Manage email templates" },
  "forms:read": { domain: "forms", access: "read", label: "View forms and responses" },
  "forms:write": { domain: "forms", access: "write", label: "Manage forms and responses" },
  "email:read": { domain: "email", access: "read", label: "View email delivery records" },
  "email:manage": { domain: "email", access: "write", label: "Manage email delivery" },
  "donations:read": { domain: "donations", access: "read", label: "View donations" },
  "donations:sync": { domain: "donations", access: "write", label: "Synchronize donation payments" },
  "users:read": { domain: "users", access: "read", label: "View user records" },
  "users:write": { domain: "users", access: "write", label: "Update user records" },
  "users:anonymize": { domain: "users", access: "write", label: "Anonymize user data" },
  "audit:read": { domain: "audit", access: "read", label: "View audit history" },
  "analytics:read": { domain: "analytics", access: "read", label: "View analytics" },
  "retention:read": { domain: "retention", access: "read", label: "View retention policies" },
  "retention:run": { domain: "retention", access: "write", label: "Run data retention" },
  "scheduler:read": { domain: "scheduler", access: "read", label: "View scheduled jobs" },
  "scheduler:manage": { domain: "scheduler", access: "write", label: "Manage scheduled jobs" },
  "site:publish": { domain: "site", access: "write", label: "Publish the website" },
  "access:grant": { domain: "access", access: "write", label: "Grant permissions and roles" },
  "access:revoke": { domain: "access", access: "write", label: "Revoke permissions and roles" },
  "organizations:read": { domain: "organizations", access: "read", label: "View organization records" },
  "organizations:write": { domain: "organizations", access: "write", label: "Update organization records" },
  "organizations:content-review": { domain: "organizations", access: "write", label: "Review organization content" },
  "sponsorships:read": { domain: "sponsorships", access: "read", label: "View sponsorship records" },
  "sponsorships:write": { domain: "sponsorships", access: "write", label: "Manage sponsorships" },
  "votes:create": { domain: "votes", access: "write", label: "Create votes" },
  "votes:manage": { domain: "votes", access: "write", label: "Manage votes" },
  "proposals:read": { domain: "proposals", access: "read", label: "View proposals" },
  "proposals:score": { domain: "proposals", access: "write", label: "Score proposals" },
  "proposals:manage": { domain: "proposals", access: "write", label: "Manage proposals" },
  "proposals:edit_accepted_abstract": { domain: "proposals", access: "write", label: "Edit accepted abstracts" },
  "proposals:cancel_accepted": { domain: "proposals", access: "write", label: "Cancel accepted proposals" },
  "agenda:read": { domain: "agenda", access: "read", label: "View agenda configuration" },
  "agenda:write": { domain: "agenda", access: "write", label: "Edit the agenda" },
  "agenda:scan": {
    domain: "agenda",
    access: "write",
    label: "Check admission, admit attendees, and record attendance",
  },
  "agenda:check": { domain: "agenda", access: "read", label: "Check attendee admission eligibility" },
  "agenda:admit": { domain: "agenda", access: "write", label: "Admit attendees" },
  "agenda:attendance_record": { domain: "agenda", access: "write", label: "Record attendance" },
  "agenda:admit_exceptions": { domain: "agenda", access: "write", label: "Approve admission exceptions" },
  "agenda:attendance_read": { domain: "agenda", access: "read", label: "View attendance" },
  "agenda:attendance_correct": { domain: "agenda", access: "write", label: "Correct attendance" },
  "agenda:attendance_import": { domain: "agenda", access: "write", label: "Import attendance" },
  "agenda:appearance_approve": { domain: "agenda", access: "write", label: "Approve speaker appearances" },
  "agenda:leads_capture": { domain: "agenda", access: "write", label: "Capture sponsor leads" },
  "agenda:leads_view": { domain: "agenda", access: "read", label: "View sponsor leads" },
  "agenda:leads_export": { domain: "agenda", access: "read", label: "Export sponsor leads" },
  "agenda:live_moderate": { domain: "agenda", access: "write", label: "Moderate live sessions" },
  "admin:read": { domain: "admin", access: "read", label: "View platform settings" },
  "admin:write": { domain: "admin", access: "write", label: "Update platform settings" },
} as const satisfies Record<
  string,
  { domain: keyof typeof PERMISSION_DOMAINS; access: "read" | "write"; label: string }
>;

export type PermissionDomain = keyof typeof PERMISSION_DOMAINS;

/** Permissions grouped by their area in catalog order, each with its label and access; areas with none are left out. */
export function permissionAreas<P extends keyof typeof PERMISSION_METADATA>(permissions: readonly P[]) {
  return (Object.entries(PERMISSION_DOMAINS) as [PermissionDomain, string][]).flatMap(([key, label]) => {
    const inArea = permissions
      .filter((permission) => PERMISSION_METADATA[permission].domain === key)
      .map((permission) => ({
        permission,
        label: PERMISSION_METADATA[permission].label,
        access: PERMISSION_METADATA[permission].access,
      }));
    return inArea.length ? [{ key, label, permissions: inArea }] : [];
  });
}
