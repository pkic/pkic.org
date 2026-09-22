import { useEffect, useState } from "preact/hooks";
import type {
  EventEmailCampaignAudience,
  EventEmailCampaignDayWaitlistFilter,
  EventEmailCampaignPreviewInput,
  EventEmailCampaignSendMode,
  EventEmailCampaignSpeakerStatusFilter,
} from "../../../shared/schemas/event-email-campaigns";
import { eventDaysManagementResponseSchema } from "../../../shared/schemas/event-configuration";
import { getJson } from "../../shared/api-client";
import type { TemplateHelperCategory } from "../../shared/email-template-helpers";

/**
 * How the composer words the campaign vocabularies the contract owns.
 *
 * Each map is total on its vocabulary, so a value added to
 * `event-email-campaigns` is a compile error here rather than a choice the
 * composer silently stops offering.
 */
export const SEND_MODE_LABELS: Record<EventEmailCampaignSendMode, string> = {
  personal: "Personal (1:1)",
  bcc_batch: "Broadcast BCC",
};

export const DAY_WAITLIST_FILTER_LABELS: Record<EventEmailCampaignDayWaitlistFilter, string> = {
  all: "Any state",
  active: "Active waitlist",
  waiting: "Waiting",
  offered: "Offer sent",
  accepted: "Accepted offer",
  none: "Not waitlisted",
};

export const SPEAKER_STATUS_FILTER_LABELS: Record<EventEmailCampaignSpeakerStatusFilter, string> = {
  all: "All active",
  confirmed: "Confirmed",
  invited: "Invited",
  pending: "Pending",
};

export const HELPER_CATEGORIES: TemplateHelperCategory[] = ["Variables", "Conditions", "CTAs"];
export const PERSONAL_ONLY_HELPERS = new Set([
  "firstName",
  "lastName",
  "email",
  "organizationName",
  "jobTitle",
  "status",
  "statusLabel",
  "registrationStatus",
  "registrationStatusLabel",
  "isWaitlisted",
  "hasActiveDayWaitlist",
  "waitlistedDayCount",
  "if isWaitlisted",
  "if hasActiveDayWaitlist",
  "attendanceType",
  "attendanceLabel",
  "manageUrl",
  "proposalTitle",
  "proposalAbstract",
  "speakerStatus",
  "acceptedTermsText",
  "if firstName",
  "if eq status",
  "if acceptedTermsText",
  "each customAnswerRows",
  "each dayAttendance",
]);

export function highlightBody(src: string): string {
  return src
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/({{[^}]*}})/g, '<mark class="adm-template-token-mark">$1</mark>');
}

export function SnippetBtn({
  snippet,
  label,
  personal,
  personalOnly,
  onInsert,
}: {
  snippet: string;
  label: string;
  personal: boolean;
  personalOnly?: boolean;
  onInsert: (snippet: string) => void;
}) {
  const disabled = personalOnly && !personal;
  return (
    <button
      type="button"
      class={`btn btn-sm btn-outline-secondary${disabled ? " adm-snippet-disabled" : ""}`}
      title={disabled ? "Only available in Personal mode" : snippet}
      onClick={() => !disabled && onInsert(snippet)}
    >
      {label}
    </button>
  );
}

export type CampaignPayload = EventEmailCampaignPreviewInput & {
  previewToken?: string;
};

export function useDays(daysPath: string) {
  const [days, setDays] = useState<Array<{ day_date?: string; date?: string; label?: string | null }>>([]);
  useEffect(() => {
    getJson(daysPath, eventDaysManagementResponseSchema)
      .then((data) => setDays(data.days ?? []))
      .catch(() => {});
  }, [daysPath]);
  return days;
}

export function availableHelperLabelsForAudience(audience: EventEmailCampaignAudience): Set<string> {
  if (audience === "attendee_invitations" || audience === "speaker_invitations") {
    return new Set([
      "eventName",
      "eventUrl",
      "eventTimezone",
      "firstName",
      "lastName",
      "email",
      audience === "attendee_invitations" ? "registrationUrl" : "proposalUrl",
      "if firstName",
      "else block",
      "unless",
      "CTA button",
    ]);
  }
  if (audience === "attendees") {
    return new Set([
      "eventName",
      "eventUrl",
      "eventTimezone",
      "firstName",
      "lastName",
      "email",
      "organizationName",
      "jobTitle",
      "status",
      "statusLabel",
      "registrationStatus",
      "registrationStatusLabel",
      "isWaitlisted",
      "hasActiveDayWaitlist",
      "waitlistedDayCount",
      "attendanceType",
      "attendanceLabel",
      "manageUrl",
      "registrationUrl",
      "if firstName",
      "if eq status",
      "if isWaitlisted",
      "if hasActiveDayWaitlist",
      "else block",
      "unless",
      "each customAnswerRows",
      "CTA button",
    ]);
  }
  return new Set([
    "eventName",
    "eventUrl",
    "eventTimezone",
    "firstName",
    "lastName",
    "email",
    "organizationName",
    "jobTitle",
    "proposalTitle",
    "proposalAbstract",
    "speakerStatus",
    "proposalUrl",
    "if firstName",
    "else block",
    "unless",
    "each customAnswerRows",
    "CTA button",
  ]);
}

export function availablePartialsForAudience(audience: EventEmailCampaignAudience): Set<string> {
  return audience === "attendees"
    ? new Set(["reg_details", "sponsors_block", "about_pkic", "donation_request"])
    : new Set(["sponsors_block", "about_pkic", "donation_request"]);
}
