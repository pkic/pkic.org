import type { Env } from "../../types";

export const GOOGLE_GROUPS_SYNC_ACTIONS = ["add_to_list", "remove_from_list"] as const;
export type GoogleGroupsSyncAction = (typeof GOOGLE_GROUPS_SYNC_ACTIONS)[number];

export const GOOGLE_GROUPS_SYNC_STATUSES = ["pending", "processing", "completed", "failed", "superseded"] as const;
export type GoogleGroupsSyncStatus = (typeof GOOGLE_GROUPS_SYNC_STATUSES)[number];

export interface GoogleGroupsSyncQueueRow {
  id: string;
  user_id: string;
  action: GoogleGroupsSyncAction;
  google_group_email: string;
  idempotency_key: string | null;
  generation: number;
  status: GoogleGroupsSyncStatus;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
  processed_at: string | null;
  processing_token: string | null;
  lease_expires_at: string | null;
}

export interface ClaimedGoogleGroupsSyncRow extends GoogleGroupsSyncQueueRow {
  status: "processing";
  processing_token: string;
  lease_expires_at: string;
}

export interface EnqueueGoogleGroupsSyncParams {
  userId: string;
  googleGroupEmail: string;
  action: GoogleGroupsSyncAction;
  idempotencyKey?: string | null;
}

export type GoogleServiceAccountEnv = Pick<
  Env,
  "GOOGLE_SERVICE_ACCOUNT_EMAIL" | "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY" | "GOOGLE_WORKSPACE_ADMIN_EMAIL"
>;

export type ConfiguredGoogleServiceAccountEnv = {
  [Key in keyof GoogleServiceAccountEnv]-?: string;
};

export interface GoogleGroupsDirectoryClient {
  applyMembership(params: {
    action: GoogleGroupsSyncAction;
    googleGroupEmail: string;
    memberEmail: string;
  }): Promise<void>;
  /**
   * The provider's actual membership for one group. `complete` is false when
   * pagination was truncated, in which case absence must not be treated as an
   * unsubscribe.
   */
  listMembers(googleGroupEmail: string, maxPages?: number): Promise<{ emails: string[]; complete: boolean }>;
}

export interface ProcessGoogleGroupsSyncResult {
  /** Queued adds retired because the member had unsubscribed at the provider. */
  suppressed?: number;
  processed: number;
  succeeded: number;
  failed: number;
  skippedUnconfigured: boolean;
  completedAddsByUser: Record<string, string[]>;
}
