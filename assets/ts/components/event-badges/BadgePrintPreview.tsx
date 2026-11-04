import type { BadgePrintAction } from "../../../shared/schemas/event-badge-printing";
import { formatNumber } from "../../../shared/format-number";
import { useMeasuredWidth } from "../../hooks/useMeasuredWidth";
import { badgePrintPageDimensions } from "../../../shared/schemas/badge-print-layout";
import { badgeLabelSvg } from "../../../shared/badge-label-svg";
import { isBrotherDk1208Paper } from "../../../shared/badge-label-policy";
import { useHashQueryParam } from "../../hooks/useHashQueryParam";
import { BadgeDocumentFrame } from "./BadgeDocumentFrame";
import type { BadgePrintingContext } from "../../../shared/schemas/route-contracts-event-badges";
import type { BadgePrintDesign } from "../../../shared/schemas/event-badge-template";
import { badgeFaceLayout, badgePrintPreset } from "../../../shared/badge-print-layout";
import { BadgePrintLayoutEditor } from "./BadgePrintLayoutEditor";
import { badgeSvgArchive } from "./badge-svg-archive";
import { TabList } from "../../ui/TabList";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Button } from "../../ui/Button";
import { DownloadAction } from "../../ui/DownloadAction";
import { Alert } from "../../ui/Alert";
import {
  badgePrintCsv,
  badgePrintCredential,
  badgePrintHtml,
  downloadBadgeArtifact,
  type BadgePrintLayout,
  type PrintableBadgePrint,
} from "./badge-print-artifacts";
import "./BadgePrintPreview.css";

export function BadgePrintPreview({
  badges,
  action = "preview",
  initialDesign = "name_qr",
  beforeRelease,
  printing,
  loadPrintingContext,
}: {
  badges: readonly PrintableBadgePrint[];
  action?: BadgePrintAction;
  initialDesign?: BadgePrintDesign;
  printing: BadgePrintingContext;
  loadPrintingContext?: () => Promise<BadgePrintingContext>;
  /** Reprints recheck live metadata before releasing any private print file. */
  beforeRelease?: () => Promise<boolean>;
}) {
  const { element, width: availableWidth } = useMeasuredWidth();
  const [completePrinting, setCompletePrinting] = useState<BadgePrintingContext | null>(null);
  const context = completePrinting ?? printing;
  const [layout, setLayout] = useState<BadgePrintLayout>(() =>
    initialDesign === "event_badge" && printing.template
      ? { ...badgeFaceLayout(printing.template.widthMm, printing.template.heightMm), sides: "front_back" }
      : badgePrintPreset("brother_dk_1208"),
  );
  const [design, setDesign] = useState<BadgePrintDesign>(initialDesign);
  const [tab, setTab] = useHashQueryParam("printView", "preview");
  const [error, setError] = useState("");
  const archiveBuilding = useRef(false);
  const owner = useRef(badges);
  owner.current = badges;
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const live = useRef(true);
  const checking = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  const csvAvailable = badges.length > 0 && badges.every((badge) => badgePrintCredential(badge));
  async function release(action: () => void) {
    if (checking.current || !live.current) return;
    if (!beforeRelease) {
      action();
      return;
    }
    checking.current = true;
    setBusy(true);
    try {
      if (
        design === "event_badge" &&
        loadPrintingContext &&
        JSON.stringify(await loadPrintingContext()) !== JSON.stringify(context)
      ) {
        setError("The badge artwork changed. Reload the print layout.");
        return;
      }
      if ((await beforeRelease()) && live.current) action();
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : "Could not check this print document.");
    } finally {
      checking.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function applyFullBadge(download: boolean) {
    if (checking.current || archiveBuilding.current || !live.current) return;
    const owned = badges;
    checking.current = true;
    setBusy(true);
    setError("");
    try {
      const complete = loadPrintingContext ? await loadPrintingContext() : context;
      if (!live.current || owner.current !== owned) return;
      if (!complete.template) throw new Error("No full badge artwork is configured for this event.");
      const fullLayout: BadgePrintLayout = {
        ...badgeFaceLayout(complete.template.widthMm, complete.template.heightMm),
        sides: "front_back",
      };
      if (download) {
        if (beforeRelease && !(await beforeRelease())) return;
        if (!live.current || owner.current !== owned) return;
        downloadBadgeArtifact(
          badgePrintHtml(owned, fullLayout, complete, "event_badge"),
          "text/html;charset=utf-8",
          "attendee-badges-full.html",
        );
      } else {
        setCompletePrinting(complete);
        setLayout(fullLayout);
        setDesign("event_badge");
        setReady(false);
        setTab("preview");
      }
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : "Could not load the badge artwork.");
    } finally {
      checking.current = false;
      if (live.current) setBusy(false);
    }
  }
  const started = useRef(false);
  const performed = useRef(false);
  useEffect(() => {
    if ((action !== "badges" && action !== "badge_pdf") || started.current) return;
    started.current = true;
    void useFullBadge(false);
  }, [action]);
  useEffect(() => {
    if (action === "preview" || performed.current || busy) return;
    if (action === "label_csv") {
      performed.current = true;
      void release(() => downloadBadgeArtifact(badgePrintCsv(badges), "text/csv;charset=utf-8", "attendee-labels.csv"));
    } else if (ready && ((action !== "badges" && action !== "badge_pdf") || design === "event_badge")) {
      performed.current = true;
      if (action === "label_pdf" || action === "badge_pdf") void downloadPdf();
      else void release(() => frame.current?.contentWindow?.print());
    }
  }, [action, ready, busy, design]);
  async function downloadPdf() {
    if (archiveBuilding.current || checking.current || !frame.current?.contentDocument) return;
    const owned = badges;
    archiveBuilding.current = true;
    setBusy(true);
    setError("");
    try {
      const { badgePrintPdf } = await import("./badge-print-pdf");
      const document = frame.current.contentDocument;
      if (!document) throw new Error("The print document is unavailable.");
      const file = await badgePrintPdf(
        document,
        badgePrintPageDimensions(layout.page),
        () => live.current && owner.current === owned,
        html,
      );
      await release(() => {
        if (owner.current === owned)
          downloadBadgeArtifact(
            file,
            "application/pdf",
            design === "event_badge" ? "attendee-badges.pdf" : "attendee-labels.pdf",
          );
      });
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : "Could not prepare the PDF.");
    } finally {
      archiveBuilding.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function downloadSvgArchive() {
    if (archiveBuilding.current || checking.current) return;
    const owned = badges;
    archiveBuilding.current = true;
    setBusy(true);
    setError("");
    try {
      const archive = await badgeSvgArchive(owned, layout.label.widthMm, layout.label.heightMm);
      if (!live.current || owner.current !== owned) return;
      await release(() => {
        if (owner.current === owned) downloadBadgeArtifact(archive, "application/zip", "attendee-badge-labels.zip");
      });
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : "Could not prepare QR downloads.");
    } finally {
      archiveBuilding.current = false;
      if (live.current) setBusy(false);
    }
  }
  const physicalWidth = (badgePrintPageDimensions(layout.page).widthMm * 96) / 25.4;
  const previewScale = availableWidth ? Math.min(1, Math.max(1, availableWidth - 22) / physicalWidth) : 1;
  const html = useMemo(() => badgePrintHtml(badges, layout, context, design), [badges, layout, context, design]);
  return (
    <div class="pk-stack" ref={element}>
      <Alert tone="info">
        {formatNumber(layout.copies * (layout.sides === "front_back" ? 2 : 1))}{" "}
        {design === "name_qr" ? "labels" : "badge faces"} per attendee. Keep downloaded print files private.
      </Alert>
      <TabList
        label="Badge print views"
        items={[
          { id: "preview", label: "Preview" },
          { id: "layout", label: "Print layout" },
        ]}
        activeId={tab}
        onSelect={(next) => {
          setReady(false);
          setTab(next);
        }}
      />
      {tab === "layout" ? (
        <div class="pk-stack">
          {(context.template || loadPrintingContext) && (
            <Button loading={busy} onClick={() => void applyFullBadge(false)}>
              Use full badge
            </Button>
          )}
          <BadgePrintLayoutEditor
            layout={{ ...layout, design }}
            template={context.template}
            onApply={(next) => {
              const { design: nextDesign, ...nextLayout } = next;
              setLayout(nextLayout);
              setDesign(nextDesign);
              setReady(false);
              setTab("preview");
            }}
          />
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      ) : (
        <>
          <div class="pk-cluster">
            <Button disabled={!ready || busy} onClick={() => void release(() => frame.current?.contentWindow?.print())}>
              {design === "name_qr" ? "Print labels" : "Print badges"}
            </Button>
            <DownloadAction
              label="Download reusable badge print file (HTML)"
              menuLabel="Download print files"
              busy={busy}
              options={[
                {
                  id: "html",
                  label: "Reusable HTML print file",
                  onDownload: () =>
                    release(() => downloadBadgeArtifact(html, "text/html;charset=utf-8", "attendee-badges.html")),
                },
                ...(context.template || loadPrintingContext
                  ? [{ id: "full-html", label: "Full badge (HTML)", onDownload: () => applyFullBadge(true) }]
                  : []),
                ...(csvAvailable
                  ? [
                      {
                        id: "csv",
                        label: "Printing CSV with QR codes",
                        onDownload: () =>
                          release(() =>
                            downloadBadgeArtifact(
                              badgePrintCsv(badges),
                              "text/csv;charset=utf-8",
                              "attendee-badges-print.csv",
                            ),
                          ),
                      },
                    ]
                  : []),
                ...(badges.length > 1
                  ? [{ id: "svg-zip", label: "Labels (SVG ZIP)", onDownload: () => downloadSvgArchive() }]
                  : []),
                ...(badges.length === 1
                  ? [
                      {
                        id: "svg",
                        label: "Label (SVG)",
                        onDownload: () =>
                          release(() =>
                            downloadBadgeArtifact(
                              badgeLabelSvg(
                                { ...badges[0], jobTitle: badges[0].jobTitle ?? null },
                                layout.label.widthMm,
                                layout.label.heightMm,
                              ),
                              "image/svg+xml",
                              "attendee-badge-label.svg",
                            ),
                          ),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
          <p>
            {design === "name_qr" && isBrotherDk1208Paper(badgePrintPageDimensions(layout.page))
              ? "Brother DK-1208: select 38 × 90 mm paper, portrait, 100% scale, and no margins. Turn off headers and footers."
              : "Print at 100% using the selected stock. Disable browser headers and footers."}{" "}
            {design === "name_qr"
              ? "Use Print layout to change label stock, copies, or switch to full badges."
              : "Use Print layout to change paper, copies, or switch to labels."}
          </p>
          {error && <Alert tone="danger">{error}</Alert>}
          <BadgeDocumentFrame
            frameRef={frame}
            className="pk-badge-print-preview"
            title="Attendee badge print preview"
            html={html}
            screenCss={`@media screen{body{zoom:${previewScale}}}`}
            onReady={() => {
              if (live.current) setReady(true);
            }}
            onError={(message) => {
              if (!live.current) return;
              setReady(false);
              setError(message);
            }}
          />
        </>
      )}
    </div>
  );
}
