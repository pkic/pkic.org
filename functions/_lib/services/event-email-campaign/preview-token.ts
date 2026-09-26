import { signPreviewToken, verifyPreviewToken } from "../../auth/preview-token";

export async function signCampaignPreviewToken(payload: {
  secret: string;
  eventId: string;
  actorId: string;
  digest: string;
  ttlSeconds: number;
}): Promise<{ token: string; expiresAt: string }> {
  return signPreviewToken({ ...payload, type: "event_email_campaign_preview" });
}

export async function verifyCampaignPreviewToken(payload: {
  secret: string;
  token: string;
  eventId: string;
  actorId: string;
  digest: string;
}): Promise<{ ok: true } | { ok: false; reason: "invalid" | "expired" | "mismatch" }> {
  const validation = await verifyPreviewToken({ ...payload, type: "event_email_campaign_preview" });
  return validation.ok ? { ok: true } : validation;
}
