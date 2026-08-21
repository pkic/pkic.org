import { ApiClientError, postJson } from "../api-client";
import { setStatus } from "../form/helpers";
import { readField } from "../form/helpers";
import { handleSubmitError } from "../form/submit";

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

/**
 * Applies the common invitation recovery policy and delegates ordinary
 * submission failures to the caller's form-specific renderer.
 */
export async function handleInviteSubmitError(
  options: Parameters<typeof tryRecoverInvalidInvite>[0] & {
    onUnhandled: (error: unknown) => void;
  },
): Promise<void> {
  if (await tryRecoverInvalidInvite(options)) {
    return;
  }
  options.onUnhandled(options.error);
}

/** Common event-form adapter for invitation-aware submission errors. */
export function handleFormInviteSubmitError(options: {
  error: unknown;
  form: HTMLFormElement;
  apiBase: string;
  statusEl: HTMLElement;
  hasInviteToken: boolean;
}): Promise<void> {
  return handleInviteSubmitError({
    error: options.error,
    email: readField(options.form, "email"),
    apiBase: options.apiBase,
    statusEl: options.statusEl,
    hasInviteToken: options.hasInviteToken,
    onUnhandled: (error) => handleSubmitError(error, options.form, options.statusEl),
  });
}
