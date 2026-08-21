/**
 * Maximum number of active passkey credentials retained for one account.
 *
 * This supports the normal set of phones, computers, and recovery keys while
 * bounding both WebAuthn's registration exclusion list and the account list
 * response. Revoked credentials do not count toward this active-credential
 * policy.
 */
export const MAX_PASSKEY_CREDENTIALS_PER_USER = 25;
