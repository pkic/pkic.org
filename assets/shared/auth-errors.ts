export const PERMISSION_DENIED_MESSAGE = "You do not have permission to perform this action.";
export const PERMISSION_REFRESH_GUIDANCE = "If your permissions changed recently, sign out and sign in again.";
export const PERMISSION_DENIED_WITH_REFRESH_MESSAGE = `${PERMISSION_DENIED_MESSAGE} ${PERMISSION_REFRESH_GUIDANCE}`;

/** A change would leave the account with no passkey and no address that may sign in. */
export const LAST_SIGN_IN_METHOD = "LAST_SIGN_IN_METHOD";
export const LAST_SIGN_IN_METHOD_MESSAGE =
  "You would have no way left to sign in. Add a passkey or verify your primary address first.";
/** The same refusal for a passkey, which its owner may still revoke by confirming. */
export const LAST_PASSKEY_MESSAGE =
  "This passkey is your last way to sign in. Add another passkey or allow an email address to sign in first, or confirm that you want to remove it anyway.";
