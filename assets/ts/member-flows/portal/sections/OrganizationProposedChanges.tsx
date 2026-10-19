/**
 * What an organization content submission proposed, field by field. The
 * pending banner and the submission history read the same list, so a
 * representative recognizes a past submission by the values they sent.
 */
import { Markdown } from "../../../ui/Markdown";
import { ORGANIZATION_CONTENT_FIELD_LABELS } from "../../../shared/organization-content";
import type { MyOrganizationReview } from "../types";

const LOGO = "Logo";

function fieldLabel(field: string): string {
  return ORGANIZATION_CONTENT_FIELD_LABELS[field] ?? field;
}

/** The changed fields by name, the logo last, for a one-line summary. */
export function proposedChangeLabels(review: MyOrganizationReview): string[] {
  return [...Object.keys(review.proposedChanges).map(fieldLabel), ...(review.hasLogoChange ? [LOGO] : [])];
}

function isCleared(value: unknown): boolean {
  return value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

/** A profile link travels as an object; its address is what the person typed. */
function listItem(value: unknown): string {
  if (value && typeof value === "object" && "url" in value) return String(value.url);
  return String(value);
}

export function ProposedChanges({ review }: { review: MyOrganizationReview }) {
  const fields = Object.entries(review.proposedChanges);
  return (
    <ul class="pk-stack pk-stack--tight pk-small">
      {fields.map(([field, value]) => (
        <li key={field}>
          <strong>{fieldLabel(field)}:</strong>{" "}
          {isCleared(value) ? (
            <em>(cleared)</em>
          ) : field === "contentMarkdown" ? (
            <Markdown markdown={String(value)} />
          ) : Array.isArray(value) ? (
            value.map(listItem).join(", ")
          ) : (
            String(value)
          )}
        </li>
      ))}
      {review.hasLogoChange && (
        <li>
          <strong>{LOGO}:</strong> a new logo
        </li>
      )}
    </ul>
  );
}
