import { useEffect, useState } from "preact/hooks";
import type { EventEmailCampaignPreviewInput } from "../../../shared/schemas/event-email-campaigns";
import { eventDaysManagementResponseSchema } from "../../../shared/schemas/event-configuration";
import { getJson } from "../../shared/api-client";
import type { TemplateHelperCategory } from "../../shared/email-template-helpers";

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
