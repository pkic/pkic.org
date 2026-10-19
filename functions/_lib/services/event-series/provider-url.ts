import { httpsCapabilityUrlSchema } from "../../../../assets/shared/schemas/urls";
import { AppError } from "../../errors";

import { openValue, sealValue } from "../../utils/sealed-value";
function requireEncryptionSecret(secret: string) {
  if (secret.length < 32)
    throw new AppError(503, "MEETING_PROVIDER_KEY_UNAVAILABLE", "Meeting-provider encryption is not configured");
}

export async function sealProviderJoinUrl(url: string, secret: string): Promise<string> {
  const validatedUrl = httpsCapabilityUrlSchema.parse(url);
  requireEncryptionSecret(secret);
  return sealValue(validatedUrl, secret, "pkic-meeting-provider");
}

export async function openProviderJoinUrl(value: string, secret: string): Promise<string> {
  requireEncryptionSecret(secret);
  try {
    return httpsCapabilityUrlSchema.parse(await openValue(value, secret, "pkic-meeting-provider"));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(500, "MEETING_PROVIDER_URL_INVALID", "Stored meeting-provider URL cannot be decrypted");
  }
}
