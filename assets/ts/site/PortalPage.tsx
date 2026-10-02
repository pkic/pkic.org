import { HeadshotDialogTemplates } from "./HeadshotDialogTemplates";
import { PORTAL_LOGIN_COPY_ID, type PortalLoginCopy } from "../../shared/schemas/portal-login-copy";

/** The portal owns the full space between the public header and footer. */
export function PortalPage({ copy }: { copy: PortalLoginCopy }) {
  return (
    <>
      <script
        type="application/json"
        id={PORTAL_LOGIN_COPY_ID}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(copy).replace(/</g, "\\u003c") }}
      />
      <div id="portal-app" data-module="member-flows/portal-page" />
      <div id="portal-toast-area" />
      <HeadshotDialogTemplates />
    </>
  );
}
