import type { DatabaseLike } from "../../types";
import { prepareSitePublicationRequest } from "../site-publication-requests";
import type { AutomaticEnrollmentScope } from "./automatic-enrollment-sql";
import { groupSeatAdditionPublicationCondition, groupSeatWithdrawalPublicationConditions } from "./seat-publication";

type Selection = { sql: string; bindings: unknown[] };
function automaticEnrollmentDeduplicationKey(scope: AutomaticEnrollmentScope, phase: "add" | "end") {
  return `automatic-enrollment:${scope.type}:${scope.id}:${phase}:${crypto.randomUUID()}`;
}
function publication(
  db: DatabaseLike,
  scope: AutomaticEnrollmentScope,
  at: string,
  deduplicationKey: string,
  condition: Selection,
) {
  return prepareSitePublicationRequest(
    db,
    {
      resourceType: scope.type === "group" ? "group_content" : "user_profile",
      resourceId: scope.id,
      revision: Date.parse(at),
      reasonCode: scope.type === "group" ? "group_content_changed" : "user_profile_changed",
      deduplicationKey,
    },
    condition,
  );
}
/** One request at most: every statement carries the same deduplication key. */
export function prepareAutomaticEnrollmentWithdrawalPublication(
  db: DatabaseLike,
  scope: AutomaticEnrollmentScope,
  at: string,
  removal: Selection & { definitions: string; sourceSql: string },
) {
  const deduplicationKey = automaticEnrollmentDeduplicationKey(scope, "end");
  return groupSeatWithdrawalPublicationConditions({
    definitions: removal.definitions,
    sql: `SELECT membership.id,membership.group_id,membership.user_id,membership.member_id,membership.left_at,1 AS closes,1 AS membership_changed
      ${removal.sourceSql}`,
    bindings: removal.bindings,
  }).map((condition) => publication(db, scope, at, deduplicationKey, condition));
}
export function prepareAutomaticEnrollmentAdditionPublication(
  db: DatabaseLike,
  scope: AutomaticEnrollmentScope,
  at: string,
  addition: Selection,
) {
  return publication(
    db,
    scope,
    at,
    automaticEnrollmentDeduplicationKey(scope, "add"),
    groupSeatAdditionPublicationCondition(addition),
  );
}
