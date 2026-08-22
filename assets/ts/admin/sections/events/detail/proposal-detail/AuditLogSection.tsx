import { AuditLogTable } from "../../../../components/AuditLogTable";
import type { AuditLogEntry } from "../../../../../../shared/schemas/audit-log";

interface AuditDelta {
  from: unknown;
  to: unknown;
}

function isAuditDelta(value: unknown): value is AuditDelta {
  return value !== null && typeof value === "object" && "from" in value && "to" in value;
}

function auditDeltas(details: Record<string, unknown> | null | undefined): Array<[string, AuditDelta]> {
  if (!details) return [];
  return Object.entries(details).filter((entry): entry is [string, AuditDelta] => isAuditDelta(entry[1]));
}

function formatAuditValue(value: unknown): string {
  if (value == null || value === "") return "empty";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.length > 0 ? value.map(formatAuditValue).join(", ") : "empty";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function formatAction(entry: AuditLogEntry): string {
  switch (entry.action) {
    case "proposal_internal_comment_added":
      return "Internal comment added";
    case "proposal_review_upserted": {
      const deltas = auditDeltas(entry.details);
      const recommendation = deltas.find(([key]) => key === "recommendation")?.[1];
      const score = deltas.find(([key]) => key === "score")?.[1];
      const created = deltas.length > 0 && deltas.every(([, delta]) => delta.from == null);
      const recommendationLabel =
        typeof recommendation?.to === "string" ? recommendation.to.replace(/-/g, " ") : undefined;
      const scoreLabel = typeof score?.to === "number" ? ` (${score.to}/10)` : "";
      return recommendationLabel
        ? `Review ${created ? "created" : "updated"}: ${recommendationLabel}${scoreLabel}`
        : `Review ${created ? "created" : "updated"}`;
    }
    case "proposal_edited": {
      const deltaFields = auditDeltas(entry.details)
        .map(([key]) => key)
        .join(", ");
      const fields = deltaFields || (Array.isArray(entry.details?.fields) ? entry.details.fields.join(", ") : null);
      return fields ? `Proposal updated: ${fields}` : "Proposal updated";
    }
    case "proposal_decision_recorded": {
      const statusValue = entry.details?.finalStatus;
      const status = isAuditDelta(statusValue) ? statusValue.to : statusValue;
      return typeof status === "string" ? `Decision recorded: ${status.replace(/[_-]/g, " ")}` : "Decision recorded";
    }
    case "proposal_decision_email_queued": {
      const templateValue = entry.details?.templateKey;
      const template = isAuditDelta(templateValue) ? templateValue.to : templateValue;
      return typeof template === "string"
        ? `Decision email queued: ${template.replace(/_/g, " ")}`
        : "Decision email queued";
    }
    case "speaker_bio_updated":
      return "Speaker bio updated";
    case "speaker_profile_updated":
      return "Speaker profile updated";
    case "speaker_confirmed":
      return "Speaker confirmed participation";
    case "speaker_declined":
      return "Speaker declined participation";
    case "speaker_profile_request_resent":
      return "Speaker profile request resent";
    case "admin_opened_proposal_manage_page":
      return "Opened proposer manage page";
    default:
      return entry.action.replace(/_/g, " ");
  }
}

function AuditDetails({ details }: { details: Record<string, unknown> | null | undefined }) {
  if (!details || Object.keys(details).length === 0) return null;
  return (
    <div class="small text-body-secondary d-flex flex-column gap-1">
      {Object.entries(details).map(([key, value]) => (
        <div key={key} class="adm-pre-wrap">
          <strong>{key}</strong>
          {": "}
          {isAuditDelta(value)
            ? `${formatAuditValue(value.from)} → ${formatAuditValue(value.to)}`
            : formatAuditValue(value)}
        </div>
      ))}
    </div>
  );
}

export function AuditLogSection({ proposalId }: { proposalId: string }) {
  return (
    <AuditLogTable
      endpoint={`/api/v1/admin/proposals/${proposalId}/audit-log`}
      actionCell={(entry) => <span class="small">{formatAction(entry)}</span>}
      detailsCell={(entry) => <AuditDetails details={entry.details} />}
    />
  );
}
