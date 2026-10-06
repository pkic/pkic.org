import type { EmailPreviewDocumentMessage } from "../../shared/email-preview-document";
import "./Content.css";
import "./EmailHtmlPreview.css";
import { useEffect, useRef } from "preact/hooks";
import { EMAIL_PREVIEW_DOCUMENT_PATH } from "../../shared/site-security-policy";

type EmailHtmlPreviewProps = EmailPreviewDocumentMessage & { title?: string; height?: number };

/** A trusted renderer document contains the sandboxed email, with its own CSP. */
export function EmailHtmlPreview({ html, title = "Rendered email HTML preview", height = 360 }: EmailHtmlPreviewProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  function render() {
    frame.current?.contentWindow?.postMessage({ html }, window.location.origin);
  }
  useEffect(render, [html]);
  return (
    <iframe
      ref={frame}
      src={EMAIL_PREVIEW_DOCUMENT_PATH}
      title={title}
      class="pk-framed pk-email-preview"
      height={height}
      referrerPolicy="no-referrer"
      onLoad={render}
    />
  );
}
