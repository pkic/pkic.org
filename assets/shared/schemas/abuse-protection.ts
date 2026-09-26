import { z } from "zod";
import type { Permission } from "./permissions";

export const TURNSTILE_TOKEN_HEADER = "x-turnstile-token";
export const turnstileChallengeSchema = z.object({
  siteKey: z.string().min(1).max(100),
  action: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/),
});
export type TurnstileChallenge = z.infer<typeof turnstileChallengeSchema>;

/** Route opt-in; machine callers must hold this permission as well as a valid credential. */
export function protectsPublicAction(action: string, apiPermission: Permission) {
  return { "x-pkic-abuse-protection": { action, apiPermission, tokenHeader: TURNSTILE_TOKEN_HEADER } } as const;
}

export type PublicActionPolicy = ReturnType<typeof protectsPublicAction>["x-pkic-abuse-protection"];
