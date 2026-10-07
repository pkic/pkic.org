import { useEffect, useRef, useState } from "preact/hooks";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Select } from "../../ui/TextControl";
import { Menu } from "../../ui/Menu";
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
}: {
  badges: readonly PrintableBadgePrint[];
  /** Reprints recheck live metadata before releasing any private print file. */
  beforeRelease?: () => Promise<boolean>;
}) {
  const [layout, setLayout] = useState<BadgePrintLayout>("a6");
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
    if (checking.current) return;
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
  const html = badgePrintHtml(badges, layout);
  return (
    <div class="pk-stack">
      <Alert tone="info">
        Downloaded HTML can be reopened and printed again. Print files contain access codes: keep them private.
        Reprinting an active badge is available only while authorized; some older credentials require a saved file or
        replacement.
      </Alert>
      <div class="pk-cluster">
        <Field label="Paper layout">
          {(control) => (
            <Select
              {...control}
              value={layout}
              onChange={(event) => {
                setReady(false);
                setLayout(event.currentTarget.value === "label" ? "label" : "a6");
              }}
            >
              <option value="a6">A6 badge (105 × 148 mm)</option>
              <option value="label">Label (100 × 50 mm)</option>
            </Select>
          )}
        </Field>
        <Button disabled={!ready || busy} onClick={() => void release(() => frame.current?.contentWindow?.print())}>
          Print / save PDF
        </Button>
        <Menu
          label="Download print files"
          items={[
            {
              id: "html",
              label: "Reusable HTML print file",
              disabled: busy,
              onSelect: () =>
                void release(() => downloadBadgeArtifact(html, "text/html;charset=utf-8", "attendee-badges.html")),
            },
            ...(fresh.length === badges.length && fresh.length > 0
              ? [
                  {
                    id: "csv",
                    label: "Printing CSV with QR codes",
                    disabled: busy,
                    onSelect: () =>
                      void release(() =>
                        downloadBadgeArtifact(
                          badgePrintCsv(fresh),
                          "text/csv;charset=utf-8",
                          "attendee-badges-print.csv",
                        ),
                      ),
                  },
                ]
              : []),
            ...(badges.length === 1
              ? [
                  {
                    id: "svg",
                    label: "QR code (SVG)",
                    disabled: busy,
                    onSelect: () =>
                      void release(() =>
                        downloadBadgeArtifact(badges[0].svg, "image/svg+xml", "attendee-badge-qr.svg"),
                      ),
                  },
                ]
              : []),
          ]}
        />
      </div>
      <p>
        Use the selected paper size and 100% scale in your print dialog. Your browser can save the preview as PDF.
        Labels require a printer configured for 100 × 50 mm media.
      </p>
      {badges.length === 1 && (
        <img
          class="pk-badge-qr-preview"
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(badges[0].svg)}`}
          alt="Attendee badge QR code"
        />
      )}
      <iframe
        sandbox="allow-same-origin allow-modals"
        ref={frame}
        class="pk-badge-print-preview"
        title="Attendee badge print preview"
        srcDoc={html}
        onLoad={() => setReady(true)}
      />
    </div>
  );
}
