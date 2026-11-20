import { useEffect, useRef } from "preact/hooks";
import { BADGE_LABEL_DEFAULT_COPIES } from "../../../../../../../shared/badge-label-policy";
import type { PortalSession } from "../../../../types";
import { BadgeDocumentFrame } from "../../../../../../components/event-badges/BadgeDocumentFrame";
import { useBadgeLabelPrinting } from "../badges/useBadgeLabelPrinting";
import type { ScannerStatus } from "./ScannerStatus";
import "../badges/BadgeLabelDesk.css";

/** Print the held badge through the same job as the print desk without leaving collection. */
export function BadgeCollectionPrinter({
  slug,
  session,
  credential,
  onStatus,
  onBusy,
}: {
  slug: string;
  session: PortalSession;
  credential: string;
  onStatus: (status: ScannerStatus) => void;
  onBusy: (busy: boolean) => void;
}) {
  const printing = useBadgeLabelPrinting(slug, session, BADGE_LABEL_DEFAULT_COPIES, "name_qr", "front_back", () => {});
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    printing.scan(credential);
  }, [credential, printing]);
  useEffect(() => {
    if (printing.busy || printing.job || printing.error) onBusy(printing.busy);
    if (printing.error)
      onStatus({
        key: `print:${credential}:error`,
        tone: "denied",
        title: "Could not print",
        detail: printing.error,
        record: false,
      });
    else if (printing.busy)
      onStatus({
        key: `print:${credential}:busy`,
        tone: "unverified",
        title: "Preparing badge for printing…",
        record: false,
      });
    else if (printing.job)
      onStatus({
        key: `print:${printing.job.key}`,
        tone: "unverified",
        title: "Print requested",
        record: false,
      });
  }, [credential, onBusy, onStatus, printing.busy, printing.error, printing.job]);
  return printing.job ? (
    <BadgeDocumentFrame
      key={printing.job.key}
      frameRef={printing.frame}
      className="pk-label-desk__print-document"
      title="Attendee label print document"
      html={printing.html}
      onReady={() => void printing.printReady()}
      onError={printing.documentError}
      decorative
    />
  ) : null;
}
