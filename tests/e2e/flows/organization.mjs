/** @import { Flow } from "./types.mjs" */

/** @type {Flow} */
export const ORGANIZATION_FLOW = {
  id: "organization",
  title: "Organization — the record its own people keep",
  purpose:
    "A member organization's public record is maintained by its own contacts and reviewed before it is published, and the people who may act for it are added and removed by the contact who holds that authority rather than by staff.",
  personas: ["primary contact", "secondary contact", "representative", "staff", "individual member"],
  steps: [
    {
      id: "10.1",
      title: "A contact submits logo and content changes for review, then withdraws each",
      status: "covered",
      note: "Nothing a member writes reaches the public site unreviewed, and a submission can be taken back before it is decided.",
    },
    {
      id: "10.2",
      title: "The primary contact nominates a secondary contact, and withdraws the nomination",
      status: "covered",
    },
    {
      id: "10.3",
      title: "An individual identity sees the individual-membership fallback, not an organization page",
      status: "covered",
    },
    {
      id: "10.4",
      title: "A contact adds a colleague, and can take that access away again",
      status: "covered",
      note: "Self-service in both directions. Access somebody can grant but not revoke accumulates.",
    },
    {
      id: "10.5",
      title: "A representative sees their organization, their role, and a pending review",
      status: "covered",
    },
    {
      id: "10.6",
      title: "Somebody who represents nothing sees an honest empty state",
      status: "covered",
    },
    {
      id: "10.7",
      title: "Staff manage organizations, link a representative, edit the record, and remove a logo",
      status: "unit",
      note: "Covered in portal-system-organizations, portal-organization-forms, portal-identity-linking and portal-organization-logo: creation has its own address and opens the new record, the representative is chosen from a user search rather than typed as an id, the record edits in place through one update, and the logo uploads and removes behind a confirmation. Worker behavior is covered in organization-management and admin-organizations.",
    },
    {
      id: "10.8",
      title: "An uploaded SVG logo is sanitized before it is served",
      status: "unit",
      note: "Covered in svg-logo-uploads: hostile SVGs go through both upload endpoints and the stored object, the bytes the browser is served, is read back free of scripts, handlers and editor cruft.",
    },
    {
      id: "10.9",
      title: "An organization left with no representative can be claimed again from its verified domain",
      status: "unit",
      note: "Covered in organization-identity-platform: with every affiliation ended, the claimed domain still resolves to the organization that claimed it, so a colleague arriving on a verified address rejoins the one that exists instead of founding a duplicate beside it. The claim outliving the people who made it is the property the recovery depends on.",
    },
    {
      id: "10.10",
      title: "An organization with no representative loses its membership after a grace period",
      status: "absent",
      note: "DECIDED: flag the organization the day its last affiliation ends, and lapse the membership twelve months later, with the period configurable rather than compiled in. A member nobody speaks for cannot receive notice, vote, or accept an agreement — but the last person leaving is usually a handover rather than a withdrawal, and a full year is long enough that a slow one never costs a member their standing. Neither the flag nor the timer is built.",
    },
  ],
};
