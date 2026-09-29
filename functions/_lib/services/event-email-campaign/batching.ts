import type { CampaignRecipient } from "./types";

export function chunkRecipients(recipients: CampaignRecipient[], batchSize: number): CampaignRecipient[][] {
  const size = Math.min(500, Math.max(1, Math.floor(batchSize)));
  const chunks: CampaignRecipient[][] = [];
  for (let i = 0; i < recipients.length; i += size) {
    chunks.push(recipients.slice(i, i + size));
  }
  return chunks;
}
