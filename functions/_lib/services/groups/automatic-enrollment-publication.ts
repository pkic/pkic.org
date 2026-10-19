import type { DatabaseLike } from "../../types";
import { prepareSitePublicationRequest } from "../site-publication-requests";
import type { AutomaticEnrollmentScope } from "./automatic-enrollment-sql";
import { groupSeatAdditionPublicationCondition, groupSeatChangePublicationCondition } from "./seat-publication";

type Selection = { sql: string; bindings: unknown[] };
function publication(
  db: DatabaseLike,
  scope: AutomaticEnrollmentScope,
  at: string,
  phase: "add" | "end",
  condition: Selection,
) {
  return prepareSitePublicationRequest(
    db,
    {
      resourceType: scope.type === "group" ? "group_content" : "user_profile",
      resourceId: scope.id,
      revision: Date.parse(at),
      reasonCode: scope.type === "group" ? "group_content_changed" : "user_profile_changed",
      deduplicationKey: `automatic-enrollment:${scope.type}:${scope.id}:${phase}:${crypto.randomUUID()}`,
    },
    condition,
  );
}
export function prepareAutomaticEnrollmentWithdrawalPublication(
  db: DatabaseLike,
  scope: AutomaticEnrollmentScope,
  at: string,
  removal: Selection & { definitions: string; selectionSql: string },
) {
  return publication(
    db,
    scope,
    at,
    "end",
    groupSeatChangePublicationCondition(
      {
        definitions: `${removal.definitions}, enrollment_removed AS MATERIALIZED (${removal.selectionSql})`,
        sql: `SELECT membership.id,membership.group_id,membership.user_id,membership.member_id,membership.left_at,1 AS closes,1 AS membership_changed
          FROM group_memberships membership JOIN enrollment_removed removed ON removed.id=membership.id WHERE membership.left_at IS NULL`,
        bindings: removal.bindings,
      },
      true,
    ),
  );
}
export function prepareAutomaticEnrollmentAdditionPublication(
  db: DatabaseLike,
  scope: AutomaticEnrollmentScope,
  at: string,
  addition: Selection,
) {
  return publication(db, scope, at, "add", groupSeatAdditionPublicationCondition(addition));
}
