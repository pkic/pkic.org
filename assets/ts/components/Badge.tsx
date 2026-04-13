import { h } from "preact";

const STATUS_COLOR: Record<string, string> = {
  // registration
  registered: "success",
  pending_email_confirmation: "warning",
  waitlisted: "info",
  cancelled: "secondary",
  // invite / proposal-invite
  sent: "info",
  accepted: "success",
  declined: "danger",
  expired: "secondary",
  revoked: "warning",
  // entity / form
  active: "success",
  inactive: "secondary",
  archived: "dark",
  draft: "secondary",
  // proposal statuses
  submitted: "primary",
  under_review: "info",
  needs_work: "warning",
  "needs-work": "warning",
  withdrawn: "secondary",
  // review recommendation
  accept: "success",
  reject: "danger",
  // decision
  // "accepted" and "rejected" already covered above
  rejected: "danger",
  // permissions / roles
  organizer: "info",
  program_committee: "primary",
  moderator: "warning",
  volunteer: "secondary",
  // user roles
  admin: "danger",
  user: "secondary",
  guest: "light",
  // attendee roles on badge
  speaker: "success",
  panelist: "warning",
  staff: "secondary",
  attendee: "primary",
  // outbox
  queued: "secondary",
  sending: "info",
  failed: "danger",
  retrying: "warning",
  // calendar rsvp
  rsvp_accepted: "success",
  rsvp_declined: "danger",
  rsvp_tentative: "warning",
};

interface BadgeProps {
  status: string;
  label?: string;
}

export function Badge({ status, label }: BadgeProps) {
  const color = STATUS_COLOR[status] ?? "secondary";
  return <span class={`badge text-bg-${color}`}>{label ?? status}</span>;
}
