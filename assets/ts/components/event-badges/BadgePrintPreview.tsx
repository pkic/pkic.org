import { BadgeDocumentFrame } from "./BadgeDocumentFrame";
import type { BadgePrintingContext } from "../../../shared/schemas/route-contracts-event-badges";
import type { BadgePrintDesign } from "../../../shared/schemas/event-badge-template";
import { badgePrintPreset } from "../../../shared/badge-print-layout";
import { BadgePrintLayoutEditor } from "./BadgePrintLayoutEditor";
import { badgeSvgArchive } from "./badge-svg-archive";
import { TabList } from "../../ui/TabList";
import { useEffect, useRef, useState } from "preact/hooks";
import { Button } from "../../ui/Button";
import { DownloadAction } from "../../ui/DownloadAction";
import { Alert } from "../../ui/Alert";
import {
  badgePrintCsv,
  badgePrintHtml,
  downloadBadgeArtifact,
  type BadgePrintLayout,
  type FreshBadgePrint,
  type PrintableBadgePrint,
} from "./badge-print-artifacts";
import "./BadgePrintPreview.css";

export function BadgePrintPreview({
  badges,
  beforeRelease,
  printing,
}: {
  badges: readonly PrintableBadgePrint[];
  printing: BadgePrintingContext;
  /** Reprints recheck live metadata before releasing any private print file. */
  beforeRelease?: () => Promise<boolean>;
}) {
  const [layout, setLayout] = useState<BadgePrintLayout>(() =>
    badgePrintPreset(printing.template ? "a6" : "label_100_50"),
  );
  const [design, setDesign] = useState<BadgePrintDesign>(printing.template ? "event_badge" : "name_qr");
  const [tab, setTab] = useState("preview");
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
  const fresh = badges.filter(
    (badge): badge is FreshBadgePrint => "credential" in badge && typeof badge.credential === "string",
  );
  async function release(action: () => void) {
    if (checking.current || !live.current) return;
    if (!beforeRelease) {
      action();
      return;
    }
    checking.current = true;
    setBusy(true);
    try {
      if ((await beforeRelease()) && live.current) action();
    } finally {
      checking.current = false;
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
      const archive = await badgeSvgArchive(owned);
      if (!live.current || owner.current !== owned) return;
      await release(() => {
        if (owner.current === owned) downloadBadgeArtifact(archive, "application/zip", "attendee-badge-qr-codes.zip");
      });
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : "Could not prepare QR downloads.");
    } finally {
      archiveBuilding.current = false;
      if (live.current) setBusy(false);
    }
  }
  const html = badgePrintHtml(badges, layout, printing, design);
  return (
    <div class="pk-stack">
      <Alert tone="info">
        Downloaded HTML can be reopened and printed again. Print files contain access codes: keep them private.
        Reprinting an active badge is available only while authorized.
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
        <BadgePrintLayoutEditor
          layout={{ ...layout, design }}
          template={printing.template}
          onApply={(next) => {
            const { design: nextDesign, ...nextLayout } = next;
            setLayout(nextLayout);
            setDesign(nextDesign);
            setReady(false);
            setTab("preview");
          }}
        />
      ) : (
        <>
          <div class="pk-cluster">
            <Button disabled={!ready || busy} onClick={() => void release(() => frame.current?.contentWindow?.print())}>
              Print / save browser PDF
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
                ...(fresh.length === badges.length && fresh.length > 0
                  ? [
                      {
                        id: "csv",
                        label: "Printing CSV with QR codes",
                        onDownload: () =>
                          release(() =>
                            downloadBadgeArtifact(
                              badgePrintCsv(fresh),
                              "text/csv;charset=utf-8",
                              "attendee-badges-print.csv",
                            ),
                          ),
                      },
                    ]
                  : []),
                ...(badges.length > 1
                  ? [{ id: "svg-zip", label: "QR codes (SVG ZIP)", onDownload: () => downloadSvgArchive() }]
                  : []),
                ...(badges.length === 1
                  ? [
                      {
                        id: "svg",
                        label: "QR code (SVG)",
                        onDownload: () =>
                          release(() => downloadBadgeArtifact(badges[0].svg, "image/svg+xml", "attendee-badge-qr.svg")),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
          <p>
            Use the selected paper size and 100% scale in your print dialog. Your browser can save the preview as PDF.
            Use the matching label stock and printer margins; the layout is not automatically scaled. Disable browser
            headers and footers. For separate front/back sheets, check the printer duplex direction with one test badge
            first. If your print company requires outlined fonts, convert the saved PDF separately; browser PDF does not
            guarantee font outlines.
          </p>
          {badges.length === 1 && (
            <img
              class="pk-badge-qr-preview"
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(badges[0].svg)}`}
              alt="Attendee badge QR code"
            />
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          <BadgeDocumentFrame
            frameRef={frame}
            className="pk-badge-print-preview"
            title="Attendee badge print preview"
            html={html}
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
