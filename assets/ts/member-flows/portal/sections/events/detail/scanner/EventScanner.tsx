import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { EventScannerCapture } from "./EventScannerCapture";

export interface EventScannerProps {
  slug: string;
  operatorUserId: string;
  occurrenceId?: string | null;
  sponsorId?: string;
  sponsorName?: string;
  canAdmitExceptions?: boolean;
  canExportLeads?: boolean;
  allowedActions?: readonly EventScanRequest["action"][];
  collectorContext?: ScannerOfflineContext;
  onCheckSignIn?: () => void;
}

/** Refuse unsupported native browser features before capture hooks initialize. */
export function EventScanner(props: EventScannerProps) {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    return (
      <ErrorAlert error="The scanner requires a secure connection. Open this site using HTTPS, or use localhost on this computer. Native secure browser features are unavailable on this connection." />
    );
  }
  return <EventScannerCapture {...props} />;
}
