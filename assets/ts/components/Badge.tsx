import { Badge as ToneBadge, type BadgeTone } from "../ui/Badge";

/**
 * The product's status vocabulary, mapped onto the design system's six tones.
 *
 * This is deliberately NOT in the design system. "ec_review" and
 * "budget_exhausted" are this product's words; a Badge that knew them would
 * be a Badge that could not be reused. The system owns the six tones and how
 * they look; this owns which of our statuses mean what.
 *
 * The map used to name Bootstrap colours, including `dark` and `light` as
 * two more shades of grey. Those collapse into `neutral`: the distinction
 * between an archived thing and a draft one was carried by colour alone,
 * which is exactly the signal nobody can rely on, and the label says it.
 */
const STATUS_TONE: Record<string, BadgeTone> = {
  // registration
  registered: "ok",
  pending_email_confirmation: "warn",
  waitlisted: "info",
  cancelled: "neutral",
  // waitlist offer lifecycle
  waiting: "warn",
  offered: "info",
  removed: "neutral",
  // invite / proposal-invite
  sent: "info",
  accepted: "ok",
  declined: "danger",
  expired: "neutral",
  revoked: "warn",
  // entity / form
  active: "ok",
  inactive: "neutral",
  archived: "neutral",
  draft: "neutral",
  // proposal statuses
  submitted: "accent",
  resubmitted: "warn",
  under_review: "info",
  needs_work: "warn",
  "needs-work": "warn",
  needs_revision: "warn",
  withdrawn: "neutral",
  // review recommendation
  accept: "ok",
  reject: "danger",
  // decision
  // "accepted" and "rejected" already covered above
  rejected: "danger",
  // permissions / roles
  organizer: "info",
  program_committee: "accent",
  moderator: "warn",
  volunteer: "neutral",
  // user roles
  admin: "danger",
  user: "neutral",
  guest: "neutral",
  // attendee roles on badge
  speaker: "ok",
  co_speaker: "ok",
  proposer: "accent",
  panelist: "warn",
  staff: "neutral",
  attendee: "accent",
  // outbox
  queued: "neutral",
  sending: "info",
  delivered: "ok",
  delivery_unknown: "warn",
  failed: "danger",
  bounced: "danger",
  retrying: "warn",
  // scheduled job runs
  succeeded: "ok",
  abandoned: "neutral",
  budget_exhausted: "warn",
  // donations
  completed: "ok",
  pending: "warn",
  // calendar rsvp
  rsvp_accepted: "ok",
  rsvp_declined: "danger",
  rsvp_tentative: "warn",
  // registration mode
  open: "ok",
  invite_only: "info",
  invite_or_open: "accent",
  // votes (derived lifecycle)
  scheduled: "info",
  closed: "neutral",
  canceled: "neutral",
  // vote outcomes
  passed: "ok",
  // "failed" already covered above (outbox)
  not_quorate: "warn",
  // membership application stages
  received: "neutral",
  screening: "info",
  in_review: "info",
  on_hold: "warn",
  in_consultation: "info",
  ec_review: "warn",
  board_review: "warn",
  approved: "ok",
  onboarding: "info",
  // ec review decision
  approve: "ok",
  decline: "danger",
  // organization content review
  pending_review: "warn",
  // vote proposals
  open_for_endorsement: "warn",
  endorsed: "ok",
  // sponsorship pipeline stages
  new_inquiry: "neutral",
  contacted: "info",
  proposal_sent: "accent",
  negotiating: "warn",
  payment_pending: "warn",
  lapsed: "neutral",
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
  open_for_endorsement: "Open for endorsement",
};

/**
 * The one canonical status → human label mapping. Use it directly for quiet
 * status text (the row-menu status slot, plain cells) and via <Badge> when a
 * colored chip is warranted.
 */
export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The design-system tone a status carries. Unknown statuses read as neutral. */
export function statusTone(status: string): BadgeTone {
  return STATUS_TONE[status] ?? "neutral";
}

interface BadgeProps {
  status: string;
  label?: string;
}

/**
 * A status as a pill. The vocabulary is ours; the pill is the system's, so it
 * carries the tone dot that keeps status from resting on colour alone.
 */
export function Badge({ status, label }: BadgeProps) {
  return <ToneBadge tone={statusTone(status)}>{label ?? statusLabel(status)}</ToneBadge>;
}
