import { useState, type MutableRef } from "preact/hooks";
import { sponsorLeadConfirmationSchema } from "../../../../../../../shared/schemas/event-sponsor-lead-list";
import type {
  EventScanResponse,
  EventScanRequest,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import type { LeadConfirmation } from "./ScannerLeadConfirmation";

/** Only an online receipt for the displayed operation may reveal its current profile. */
export function useSponsorLeadConfirmation({
  action,
  slug,
  sponsorId,
  collector,
  online,
  authorityPaused,
  lastOperation,
  presentReceipt,
}: {
  action: EventScanRequest["action"];
  slug: string;
  sponsorId?: string;
  collector: boolean;
  online: boolean;
  authorityPaused: MutableRef<boolean>;
  lastOperation: MutableRef<string | null>;
  presentReceipt: (receipt: EventScanResponse) => void;
}) {
  const [confirmation, setConfirmation] = useState<(LeadConfirmation & { operationId: string }) | null>(null);
  function showReceipt(receipt: EventScanResponse) {
    presentReceipt(receipt);
    if (
      action !== "lead" ||
      !sponsorId ||
      collector ||
      !online ||
      authorityPaused.current ||
      receipt.outcome !== "eligible" ||
      !receipt.recorded ||
      receipt.operationId !== lastOperation.current
    )
      return;
    void (async () => {
      try {
        const response = await fetch(
          `/api/v1/events/${encodeURIComponent(slug)}/sponsors/${encodeURIComponent(sponsorId)}/leads/confirmations/${encodeURIComponent(receipt.operationId)}`,
          { credentials: "same-origin", signal: AbortSignal.timeout(5000) },
        );
        if (!response.ok) return;
        const parsed = sponsorLeadConfirmationSchema.safeParse(await response.json());
        if (parsed.success && receipt.operationId === lastOperation.current && !authorityPaused.current)
          setConfirmation({ operationId: receipt.operationId, ...parsed.data });
      } catch {
        // A saved receipt stands on its own; profile details are an online convenience.
      }
    })();
  }
  return {
    confirmation,
    showReceipt,
    clearConfirmation: () => setConfirmation(null),
    /** A note saved for the lead on screen updates its confirmation, so the next edit starts from it. */
    updateConfirmationNote: (leadId: string, note: string | null) =>
      setConfirmation((current) => (current?.leadId === leadId ? { ...current, note } : current)),
  };
}
