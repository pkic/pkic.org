import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { formatNumber } from "../../../shared/format-number";
import type { BadgePrintAction } from "../../../shared/schemas/event-badge-printing";
import type { BadgePrintingContext } from "../../../shared/schemas/route-contracts-event-badges";
import { BADGE_LABEL_PRINTING_CONTEXT } from "../../../shared/badge-label-policy";
import { badgeFaceLayout, badgePrintPreset, badgePrintPageDimensions } from "../../../shared/badge-print-layout";
import { BadgeDocumentFrame } from "./BadgeDocumentFrame";
import {
  badgePrintCsv,
  badgePrintHtml,
  downloadBadgeArtifact,
  type PrintableBadgePrint,
} from "./badge-print-artifacts";
import "./BadgePrintPreview.css";

/** Executes one requested output. CSV never mounts a document or generates artwork. */
export function BadgePrintCommand({
  badges,
  action,
  beforeRelease,
  loadPrintingContext,
  onProgress,
  onComplete,
  onError,
  fresh = false,
  assertCurrent,
}: {
  badges: readonly PrintableBadgePrint[];
  action: Exclude<BadgePrintAction, "preview">;
  beforeRelease: () => Promise<boolean>;
  loadPrintingContext: () => Promise<BadgePrintingContext>;
  onProgress: (message: string) => void;
  onComplete: () => void;
  onError: (message: string) => void;
  fresh?: boolean;
  assertCurrent?: () => void;
}) {
  const [document, setDocument] = useState<{
    html: string;
    printing: BadgePrintingContext;
    badges: readonly PrintableBadgePrint[];
  } | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const live = useRef(true);
  const released = useRef(false);
  const owner = useRef({ badges, action, fresh });
  owner.current = { badges, action, fresh };
  const isCurrent = useCallback(
    () =>
      live.current &&
      owner.current.badges === badges &&
      owner.current.action === action &&
      owner.current.fresh === fresh,
    [badges, action, fresh],
  );
  const callbacks = useRef({ beforeRelease, loadPrintingContext, onProgress, onComplete, onError, assertCurrent });
  callbacks.current = { beforeRelease, loadPrintingContext, onProgress, onComplete, onError, assertCurrent };
  const fullBadge = action === "badges" || action === "badge_pdf";
  const layout =
    document?.printing.template && fullBadge
      ? {
          ...badgeFaceLayout(document.printing.template.widthMm, document.printing.template.heightMm),
          sides: "front_back" as const,
        }
      : badgePrintPreset("brother_dk_1208");
  useEffect(() => {
    live.current = true;
    released.current = false;
    setDocument(null);
    void (async () => {
      try {
        if (action === "label_csv") {
          if (!fresh && !(await callbacks.current.beforeRelease())) return;
          if (!isCurrent()) return;
          callbacks.current.assertCurrent?.();
          // Fresh rows were just authorized by the batch endpoint; no preview needs revalidation.
          downloadBadgeArtifact(badgePrintCsv(badges), "text/csv;charset=utf-8", "attendee-labels.csv");
          callbacks.current.onComplete();
          return;
        }
        callbacks.current.onProgress("Building print document…");
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (!isCurrent()) return;
        const printing = fullBadge ? await callbacks.current.loadPrintingContext() : BADGE_LABEL_PRINTING_CONTEXT;
        if (!isCurrent()) return;
        if (fullBadge && !printing.template) throw new Error("No badge design is configured for this event.");
        const settings =
          fullBadge && printing.template
            ? {
                ...badgeFaceLayout(printing.template.widthMm, printing.template.heightMm),
                sides: "front_back" as const,
              }
            : badgePrintPreset("brother_dk_1208");
        const html = badgePrintHtml(badges, settings, printing, fullBadge ? "event_badge" : "name_qr");
        setDocument({ html, printing, badges });
        callbacks.current.onProgress("Loading print pages…");
      } catch (cause) {
        if (isCurrent())
          callbacks.current.onError(cause instanceof Error ? cause.message : "Could not prepare this file.");
      }
    })();
    return () => {
      live.current = false;
    };
  }, [badges, action, fullBadge, fresh, isCurrent]);
  async function ready() {
    if (released.current || !document || document.badges !== badges || !isCurrent()) return;
    released.current = true;
    try {
      let file: Blob | undefined;
      if (action === "label_pdf" || action === "badge_pdf") {
        callbacks.current.onProgress("Creating PDF…");
        const { badgePrintPdf } = await import("./badge-print-pdf");
        file = await badgePrintPdf(
          frame.current!.contentDocument!,
          badgePrintPageDimensions(layout.page),
          isCurrent,
          document.html,
          (completed, total) => {
            if (isCurrent())
              callbacks.current.onProgress(`Creating PDF… ${formatNumber(completed)} of ${formatNumber(total)} pages`);
          },
        );
      }
      callbacks.current.onProgress("Checking print access…");
      if (!(await callbacks.current.beforeRelease()) || !isCurrent()) return;
      if (
        fullBadge &&
        JSON.stringify(await callbacks.current.loadPrintingContext()) !== JSON.stringify(document.printing)
      )
        throw new Error("The badge design changed. Try printing again.");
      if (!isCurrent()) return;
      callbacks.current.assertCurrent?.();
      if (file)
        downloadBadgeArtifact(file, "application/pdf", fullBadge ? "attendee-badges.pdf" : "attendee-labels.pdf");
      else {
        callbacks.current.onProgress("Opening print dialog…");
        const target = frame.current?.contentWindow;
        if (!target) throw new Error("The print document is no longer available.");
        target.addEventListener(
          "afterprint",
          () => {
            if (isCurrent()) callbacks.current.onComplete();
          },
          { once: true },
        );
        target.print();
        return;
      }
      if (isCurrent()) callbacks.current.onComplete();
    } catch (cause) {
      if (isCurrent())
        callbacks.current.onError(cause instanceof Error ? cause.message : "Could not print this document.");
    }
  }
  return document ? (
    <BadgeDocumentFrame
      decorative
      frameRef={frame}
      className="pk-badge-print-command"
      title="Prepared print document"
      html={document.html}
      onReady={() => void ready()}
      onError={(message) => {
        if (isCurrent()) callbacks.current.onError(message);
      }}
    />
  ) : null;
}
