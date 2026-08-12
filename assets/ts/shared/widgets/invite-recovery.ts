import { ApiClientError, postJson } from "../api-client";
import { setStatus } from "../form/helpers";

const recoverableInviteCodes = new Set(["INVITE_INVALID", "INVITE_NOT_FOUND", "INVITE_EXPIRED"]);

export async function tryRecoverInvalidInvite(options: {
  error: unknown;
  email: string;
  apiBase: string;
  statusEl: HTMLElement;
  hasInviteToken: boolean;
}): Promise<boolean> {
  if (
    !options.hasInviteToken ||
    !(options.error instanceof ApiClientError) ||
    !recoverableInviteCodes.has(options.error.code)
  ) {
    return false;
  }

  try {
    await postJson(`${options.apiBase}/invites/resend-link`, { email: options.email });
    setStatus(
      options.statusEl,
      "This invitation link is invalid or expired. If the email matches a pending invitation, a fresh link is on its way.",
      true,
    );
    return true;
  } catch {
    return false;
  }
}
