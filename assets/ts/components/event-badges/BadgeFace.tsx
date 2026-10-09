import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { BadgePrintingContext } from "../../../shared/schemas/route-contracts-event-badges";
import { Alert } from "../../ui/Alert";
import { BadgeDocumentFrame } from "./BadgeDocumentFrame";
import { badgeFaceHtml, type PrintableBadgePrint } from "./badge-print-artifacts";
import "./BadgePrintPreview.css";

/** CSS pixels per millimeter: the unit the print document is laid out in. */
const PX_PER_MM = 96 / 25.4;

/** Width of the element, kept current as the layout changes. Null until it has been measured. */
function useMeasuredWidth() {
  const element = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    const measure = () => setWidth(target.clientWidth || null);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  return { element, width };
}

/**
 * One badge face exactly as it prints: the print renderer's document, at its
 * physical proportions. It shows at true size when the column is wide enough
 * and scales down uniformly to fit a narrower one, never stretching.
 */
export function BadgeFace({
  badge,
  printing,
  title,
  side = "front",
}: {
  badge: PrintableBadgePrint;
  printing: BadgePrintingContext;
  title: string;
  side?: "front" | "back";
}) {
  const { element, width: available } = useMeasuredWidth();
  const [error, setError] = useState("");
  // Compiling the template embeds its fonts; do it once per badge, not on every resize.
  const face = useMemo(() => badgeFaceHtml(badge, printing, side), [badge, printing, side]);
  const trueWidth = face.widthMm * PX_PER_MM;
  const scale = available ? Math.min(1, available / trueWidth) : 1;
  const screenCss = `html,body{margin:0;overflow:hidden;background:transparent}.badge-print-sheet{margin:0;box-shadow:none;transform-origin:0 0;transform:scale(${scale})}`;
  return (
    <div
      ref={element}
      class={`pk-badge-face pk-badge-face--${face.widthMm > face.heightMm ? "landscape" : "portrait"}`}
      data-badge-width-mm={face.widthMm}
      data-badge-height-mm={face.heightMm}
    >
      <BadgeDocumentFrame
        className="pk-badge-face__frame"
        title={title}
        html={face.html}
        width={Math.floor(trueWidth * scale)}
        height={Math.floor(face.heightMm * PX_PER_MM * scale)}
        screenCss={screenCss}
        onError={setError}
      />
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
