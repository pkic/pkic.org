import type { RefObject } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { applyBadgePrintPreviewStyles, badgePrintPreviewDocument } from "./badge-print-preview-document";

/**
 * The one on-screen presentation of a canonical badge print document. Organizer
 * previews and the holder's ticket both show the exact document that prints;
 * `screenCss` only adjusts how that document sits in the frame (scale, page
 * chrome), never the badge itself.
 */
export function BadgeDocumentFrame({
  html,
  title,
  className,
  frameRef,
  screenCss = "",
  width,
  height,
  onReady,
  onError,
}: {
  html: string;
  title: string;
  className: string;
  frameRef?: RefObject<HTMLIFrameElement>;
  screenCss?: string;
  width?: number;
  height?: number;
  onReady?: () => void;
  onError?: (message: string) => void;
}) {
  const ownFrame = useRef<HTMLIFrameElement>(null);
  const frame = frameRef ?? ownFrame;
  const document = useMemo(() => badgePrintPreviewDocument(html), [html]);
  const screenSheet = useRef<CSSStyleSheet | null>(null);
  const latestScreenCss = useRef(screenCss);
  latestScreenCss.current = screenCss;
  useEffect(() => {
    screenSheet.current?.replaceSync(screenCss);
  }, [screenCss]);
  return (
    <iframe
      sandbox="allow-same-origin allow-modals"
      ref={frame}
      class={className}
      title={title}
      srcDoc={document.html}
      width={width}
      height={height}
      onLoad={async (event) => {
        const target = event.currentTarget;
        screenSheet.current = null;
        try {
          if (!(await applyBadgePrintPreviewStyles(target, document.css))) return;
          const content = target.contentDocument;
          const realm = target.contentWindow as (Window & typeof globalThis) | null;
          if (!content || !realm) return;
          const sheet = new realm.CSSStyleSheet();
          sheet.replaceSync(latestScreenCss.current);
          content.adoptedStyleSheets = [...content.adoptedStyleSheets, sheet];
          screenSheet.current = sheet;
          onReady?.();
        } catch (cause) {
          onError?.(cause instanceof Error ? cause.message : "Could not display the badge.");
        }
      }}
    />
  );
}
