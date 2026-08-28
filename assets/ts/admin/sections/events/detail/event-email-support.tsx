import { useEffect, useState } from "preact/hooks";
import type { EmailMessageType } from "../../../../../shared/schemas/email-templates";
import type { EventRegistrationStatusFilter } from "../../../../../shared/schemas/event-registrations";
import type { AttendanceType } from "../../../../../shared/schemas/registration";
import { api } from "../../../api";
import { adminEventEmailSupportDaysResponseSchema } from "../../../../../shared/schemas/admin-events";
import type { TemplateHelperCategory } from "../../../../shared/email-template-helpers";

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

export interface CampaignPayload {
  templateKey?: string;
  subjectOverride: string;
  bodyContent: string;
  messageType?: EmailMessageType;
  sendMode: "personal" | "bcc_batch";
  batchSize: number;
  filter: {
    audience: "attendees" | "speakers";
    attendeeStatus?: EventRegistrationStatusFilter;
    attendanceType?: "all" | AttendanceType;
    dayDate?: string;
    dayWaitlistStatus?: "all" | "active" | "waiting" | "offered" | "accepted" | "none";
    speakerStatus?: "all" | "confirmed" | "invited" | "pending";
  };
  previewToken?: string;
}

export function useDays(slug: string) {
  const [days, setDays] = useState<Array<{ day_date?: string; date?: string; label?: string | null }>>([]);
  useEffect(() => {
    api(`/api/v1/admin/events/${slug}/days`, adminEventEmailSupportDaysResponseSchema)
      .then((data) => setDays(data.days ?? []))
      .catch(() => {});
  }, [slug]);
  return days;
}

export function availableHelperLabelsForAudience(audience: "attendees" | "speakers"): Set<string> {
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

export function availablePartialsForAudience(audience: "attendees" | "speakers"): Set<string> {
  return audience === "attendees"
    ? new Set(["reg_details", "sponsors_block", "about_pkic", "donation_request"])
    : new Set(["sponsors_block", "about_pkic", "donation_request"]);
}
