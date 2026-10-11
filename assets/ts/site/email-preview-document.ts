import { emailPreviewDocumentMessageSchema } from "../../shared/email-preview-document";

const frame = document.querySelector<HTMLIFrameElement>("iframe");
window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent || event.origin !== window.location.origin) return;
  const message = emailPreviewDocumentMessageSchema.safeParse(event.data);
  if (message.success && frame) frame.srcdoc = message.data.html;
});
