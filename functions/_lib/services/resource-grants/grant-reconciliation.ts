import type { DatabaseLike, StatementLike } from "../../types";
import { prepareReconcileMailingListStatement } from "../mailing-list-subscriptions/reconcile";
import type { ResourceGrantCapability, ResourceGrantKind } from "./definitions";

/** Provider reconciliation that must commit with the canonical grant mutation. */
export function prepareGrantReconciliationStatements<K extends ResourceGrantKind>(
  db: DatabaseLike,
  kind: K,
  resourceId: string,
  capability: ResourceGrantCapability<K>,
  at: string,
): StatementLike[] {
  if (kind === "mailingList" && capability === "subscribe") {
    return [prepareReconcileMailingListStatement(db, resourceId, at)];
  }
  return [];
}
