import { Fragment } from "preact";

import { AuditLogTable } from "../AuditLogTable";
import type { AuditLogEntry } from "../../../shared/schemas/audit-log";
// `pk-answer-pre` is written here as a class name rather than reached through
// a component, so this module has to pull its stylesheet into its own chunk.
// Without the import the deltas render unwrapped and nothing complains.
import "../../ui/Content.css";

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

export function proposalAuditActionLabel(entry: AuditLogEntry): string {
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
    case "proposal_access_link_issued":
      return "Opened proposer manage page";
    default:
      return entry.action.replace(/_/g, " ");
  }
}

export function ProposalAuditDetails({ details }: { details: Record<string, unknown> | null | undefined }) {
  if (!details || Object.keys(details).length === 0) return null;
  // A term and its value per row, so each key is announced with the value it
  // belongs to rather than as one run-on paragraph reading "keyA: x → y keyB:
  // …". The pairs are direct children of the `dl`: `pk-datalist` is a grid
  // over `dl > dt` and `dl > dd`, so a wrapper between them takes both out of
  // it. `pk-answer-pre` on the value keeps a delta's own line breaks and lets
  // a long identifier wrap instead of widening the column.
  return (
    <dl class="pk-datalist pk-small">
      {Object.entries(details).map(([key, value]) => (
        <Fragment key={key}>
          <dt>{key}</dt>
          <dd class="pk-answer-pre">
            {isAuditDelta(value)
              ? `${formatAuditValue(value.from)} → ${formatAuditValue(value.to)}`
              : formatAuditValue(value)}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** Shared, server-paginated audit rendering for a single proposal. */
export function ProposalAuditLog({ endpoint }: { endpoint: string }) {
  return (
    // The proposal detail page stacks several tables, so the history says
    // whose history it is rather than sharing the generic default caption
    // with every other audit table on the page.
    <AuditLogTable
      caption="Proposal history"
      endpoint={endpoint}
      actionCell={(entry) => <span class="pk-small">{proposalAuditActionLabel(entry)}</span>}
      detailsCell={(entry) => <ProposalAuditDetails details={entry.details} />}
    />
  );
}
