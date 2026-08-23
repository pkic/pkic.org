import { signAdminPreviewToken, verifyAdminPreviewToken } from "../../auth/admin-preview-token";

export async function signCampaignPreviewToken(payload: {
  secret: string;
  eventId: string;
  adminId: string;
  digest: string;
  ttlSeconds: number;
}): Promise<{ token: string; expiresAt: string }> {
  return signAdminPreviewToken({ ...payload, type: "admin_campaign_preview" });
}

export async function verifyCampaignPreviewToken(payload: {
  secret: string;
  token: string;
  eventId: string;
  adminId: string;
  digest: string;
}): Promise<{ ok: true } | { ok: false; reason: "invalid" | "expired" | "mismatch" }> {
  const validation = await verifyAdminPreviewToken({ ...payload, type: "admin_campaign_preview" });
  return validation.ok ? { ok: true } : validation;
}
