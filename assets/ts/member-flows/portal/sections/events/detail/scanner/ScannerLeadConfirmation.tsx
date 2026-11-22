import type { z } from "zod";
import type { sponsorLeadConfirmationSchema } from "../../../../../../../shared/schemas/event-sponsor-lead-list";
import "./ScannerLeadConfirmation.css";

export type LeadConfirmation = z.infer<typeof sponsorLeadConfirmationSchema>;

/** Online-only profile details for the exact lead this operator just captured. */
export function ScannerLeadConfirmation({ confirmation }: { confirmation: LeadConfirmation }) {
  if (!confirmation.name && !confirmation.title && !confirmation.organization) return null;
  return (
    <div class="pk-scanner-lead-confirmation">
      {confirmation.name && <strong>{confirmation.name}</strong>}
      {(confirmation.title || confirmation.organization) && (
        <span>{[confirmation.title, confirmation.organization].filter(Boolean).join(" · ")}</span>
      )}
    </div>
  );
}
