import {
  mailingListSyncResponseSchema,
  mailingListSyncRunSchema,
  mailingListSyncRunResponseSchema,
} from "../../../../../shared/schemas/mailing-list-sync";
import { getJson, postValidated } from "../../../../shared/api-client";

export function mailingListSyncPath(groupId: string, listId: string): string {
  return `/api/v1/groups/${encodeURIComponent(groupId)}/mailing-lists/${encodeURIComponent(listId)}/synchronization`;
}

/** Resolve settings only when a table action is used, rather than fetching every row's settings. */
export async function requestMailingListSync(endpoint: string, expectedRevision?: number): Promise<string> {
  if (expectedRevision === undefined) {
    const { synchronization } = await getJson(endpoint, mailingListSyncResponseSchema);
    if (!synchronization.enabled) {
      throw new Error("Synchronization is paused. Open this mailing list’s Settings and enable synchronization first.");
    }
    expectedRevision = synchronization.revision;
  }
  const result = await postValidated(
    `${endpoint}/runs`,
    mailingListSyncRunSchema,
    { expectedRevision },
    mailingListSyncRunResponseSchema,
  );
  return result.queued
    ? `${result.queued} subscription changes queued for Google Groups. Delivery status is available in Scheduled jobs.`
    : "No subscription changes need synchronization.";
}
