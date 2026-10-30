/**
 * What a person is told after asking for an address verification link: only
 * what the server reported. A link that did not go out stays queued and is
 * retried, so the person learns that instead of being told to check their mail.
 */
import type { ImmediateEmailDelivery } from "../../../shared/schemas/email-outbox";
import type { ToastType } from "../../shared/toast";

export function verificationLinkNotice(
  email: string,
  delivery: ImmediateEmailDelivery,
): { message: string; tone: ToastType } {
  return delivery === "sent"
    ? { message: `Verification link sent to ${email}`, tone: "success" }
    : {
        message: `We could not send the link to ${email} yet. We will keep trying for a few minutes. If it does not arrive, request a new link.`,
        tone: "error",
      };
}
