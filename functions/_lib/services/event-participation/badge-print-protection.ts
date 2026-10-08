import { z } from "zod";
import { badgeCredentialSchema } from "../../../../assets/shared/schemas/badge-credential";
import { AppError } from "../../errors";
import type { Env } from "../../types";
import { openValue, sealValue } from "../../utils/sealed-value";
import { hashBadgeCredential } from "./badge-hash";

export type BadgePrintEnvironment = Pick<Env, "BADGE_PRINT_ENCRYPTION_KEYS">;
const keyId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);
const keyringSchema = z
  .object({
    activeKeyId: keyId,
    keys: z.record(keyId, z.string().min(32).max(512)),
  })
  .strict();
const envelopeSchema = z.object({ keyId, sealed: z.string().min(1).max(24000) }).strict();
const purpose = "pkic-badge-print";
export interface BadgePrintBinding {
  eventId: string;
  id: string;
  userId: string;
  credentialHash: string;
}
const additionalData = (binding: BadgePrintBinding) =>
  JSON.stringify([binding.eventId, binding.id, binding.userId, binding.credentialHash]);
function unavailable(): never {
  throw new AppError(503, "BADGE_PRINT_UNAVAILABLE", "Badge printing encryption is unavailable.");
}
function keyring(environment: BadgePrintEnvironment) {
  try {
    const ring = keyringSchema.parse(JSON.parse(environment.BADGE_PRINT_ENCRYPTION_KEYS ?? ""));
    if (!Object.hasOwn(ring.keys, ring.activeKeyId)) return unavailable();
    return ring;
  } catch {
    return unavailable();
  }
}
export async function sealBadgeCredential(
  environment: BadgePrintEnvironment,
  binding: BadgePrintBinding,
  credential: string,
): Promise<string> {
  const ring = keyring(environment);
  const sealed = await sealValue(credential, ring.keys[ring.activeKeyId]!, purpose, additionalData(binding));
  return JSON.stringify(envelopeSchema.parse({ keyId: ring.activeKeyId, sealed }));
}
export async function recoverBadgeCredential(
  environment: BadgePrintEnvironment,
  binding: BadgePrintBinding,
  envelope: string,
): Promise<string> {
  const ring = keyring(environment);
  try {
    const stored = envelopeSchema.parse(JSON.parse(envelope));
    if (!Object.hasOwn(ring.keys, stored.keyId)) return unavailable();
    const credential = badgeCredentialSchema.parse(
      await openValue(stored.sealed, ring.keys[stored.keyId]!, purpose, additionalData(binding)),
    );
    if ((await hashBadgeCredential(credential)) !== binding.credentialHash) return unavailable();
    return credential;
  } catch {
    return unavailable();
  }
}
