const STATUS_COLOR: Record<string, string> = {
  // registration
  registered: "success",
  pending_email_confirmation: "warning",
  waitlisted: "info",
  cancelled: "secondary",
  // waitlist offer lifecycle
  waiting: "warning",
  offered: "info",
  removed: "secondary",
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
  needs_revision: "warning",
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
  co_speaker: "success",
  proposer: "primary",
  panelist: "warning",
  staff: "secondary",
  attendee: "primary",
  // outbox
  queued: "secondary",
  sending: "info",
  delivered: "success",
  delivery_unknown: "warning",
  failed: "danger",
  bounced: "danger",
  retrying: "warning",
  // scheduled job runs
  succeeded: "success",
  abandoned: "secondary",
  budget_exhausted: "warning",
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
  // votes (derived lifecycle)
  scheduled: "info",
  closed: "secondary",
  canceled: "secondary",
  // vote outcomes
  passed: "success",
  // "failed" already covered above (outbox)
  not_quorate: "warning",
  // membership application stages
  received: "secondary",
  screening: "info",
  in_review: "info",
  on_hold: "warning",
  in_consultation: "info",
  ec_review: "warning",
  board_review: "warning",
  approved: "success",
  onboarding: "info",
  // ec review decision
  approve: "success",
  decline: "danger",
  // organization content review
  pending_review: "warning",
  // sponsorship pipeline stages
  new_inquiry: "light",
  contacted: "info",
  proposal_sent: "primary",
  negotiating: "warning",
  payment_pending: "warning",
  lapsed: "secondary",
};

const STATUS_LABEL: Record<string, string> = {
  pending_email_confirmation: "Pending confirmation",
  under_review: "Under review",
  needs_work: "Needs work",
  "needs-work": "Needs work",
  needs_revision: "Needs revision",
  co_speaker: "Co-speaker",
  program_committee: "Program committee",
  invite_only: "Invite only",
  invite_or_open: "Invite or open",
  rsvp_accepted: "RSVP accepted",
  rsvp_declined: "RSVP declined",
  rsvp_tentative: "RSVP tentative",
  delivery_unknown: "Delivery unknown",
  in_review: "In review",
  on_hold: "On hold",
  in_consultation: "In consultation",
  ec_review: "EC review",
  board_review: "Board review",
  pending_review: "Pending review",
  new_inquiry: "New inquiry",
  proposal_sent: "Proposal sent",
  payment_pending: "Payment pending",
  budget_exhausted: "Budget exhausted",
  not_quorate: "Not decided — turnout too low",
};

/**
 * The one canonical status → human label mapping. Use it directly for quiet
 * status text (the row-menu status slot, plain cells) and via <Badge> when a
 * colored chip is warranted.
 */
export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function statusColor(status: string): string {
  return STATUS_COLOR[status] ?? "secondary";
}

function formatStatus(status: string): string {
  return statusLabel(status);
}

interface BadgeProps {
  status: string;
  label?: string;
}

export function Badge({ status, label }: BadgeProps) {
  const color = STATUS_COLOR[status] ?? "secondary";
  return <span class={`badge text-bg-${color}`}>{label ?? formatStatus(status)}</span>;
}
