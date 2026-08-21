/**
 * Public Google Groups sync service boundary.
 *
 * Callers enqueue durable desired-state transitions here. Scheduled and
 * administrative workers process them through the lease-fenced queue without
 * depending on D1 persistence details or the Google Admin client directly.
 */
export type {
  ConfiguredGoogleServiceAccountEnv,
  EnqueueGoogleGroupsSyncParams,
  GoogleGroupsDirectoryClient,
  GoogleGroupsSyncAction,
  GoogleGroupsSyncQueueRow,
  GoogleGroupsSyncStatus,
  GoogleServiceAccountEnv,
  ProcessGoogleGroupsSyncResult,
} from "./google-groups/contracts";
export { GOOGLE_GROUPS_SYNC_ACTIONS, GOOGLE_GROUPS_SYNC_STATUSES } from "./google-groups/contracts";
export { isGoogleGroupsSyncConfigured } from "./google-groups/directory-client";
export { processGoogleGroupsSyncQueue } from "./google-groups/process-sync-queue";
export {
  buildEnqueueGoogleGroupsSyncStatement,
  claimPendingGoogleGroupsSyncRows,
  enqueueGoogleGroupsSync,
  GOOGLE_GROUPS_DUE_QUERY,
  listPendingGoogleGroupsSync,
  MAX_SYNC_ATTEMPTS,
} from "./google-groups/sync-queue";
