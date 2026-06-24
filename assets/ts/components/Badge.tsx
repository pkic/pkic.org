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
  resubmitted: "warning",
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
  bounced: "danger",
  retrying: "warning",
  // donations
  completed: "success",
  pending: "warning",
  // calendar rsvp
  rsvp_accepted: "success",
  rsvp_declined: "danger",
  rsvp_tentative: "warning",
  // registration mode
  open: "success",
  invite_only: "info",
  invite_or_open: "primary",
};

const STATUS_LABEL: Record<string, string> = {
  pending_email_confirmation: "Pending confirmation",
  under_review: "Under review",
  needs_work: "Needs work",
  "needs-work": "Needs work",
  program_committee: "Program committee",
  invite_only: "Invite only",
  invite_or_open: "Invite or open",
  rsvp_accepted: "RSVP accepted",
  rsvp_declined: "RSVP declined",
  rsvp_tentative: "RSVP tentative",
};

function formatStatus(status: string): string {
  return STATUS_LABEL[status] ?? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface BadgeProps {
  status: string;
  label?: string;
}

export function Badge({ status, label }: BadgeProps) {
  const color = STATUS_COLOR[status] ?? "secondary";
  return <span class={`badge text-bg-${color}`}>{label ?? formatStatus(status)}</span>;
}
