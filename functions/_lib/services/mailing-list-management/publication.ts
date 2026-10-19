import type { GroupMailingListUpdateInput } from "../../../../assets/shared/schemas/mailing-lists";
import type { DatabaseLike, StatementLike } from "../../types";
import { prepareSitePublicationRequestSelection } from "../site-publication-requests";

/** After creation/before deletion; updates compare the committing public address before mutation. */
export function prepareMailingListPublication(
  db: DatabaseLike,
  listId: string,
  at: string,
  update?: Pick<GroupMailingListUpdateInput, "email" | "active" | "primaryDiscussion">,
): StatementLike {
  const current = `CASE WHEN list.active=1 AND list.is_primary_discussion=1 THEN list.email END`;
  const condition =
    update === undefined
      ? "list.active=1 AND list.is_primary_discussion=1"
      : `(${current}) IS NOT (CASE WHEN COALESCE(?,list.active)=1 AND COALESCE(?,list.is_primary_discussion)=1
        THEN COALESCE(?,list.email) END)`;
  return prepareSitePublicationRequestSelection(
    db,
    {
      resourceType: "group_content",
      revision: Date.parse(at),
      reasonCode: "group_content_changed",
      deduplicationKey: `group-mailing-list:${listId}:${crypto.randomUUID()}`,
    },
    {
      sql: `SELECT list.group_id AS resource_id FROM mailing_lists list
      JOIN groups owner ON owner.id=list.group_id AND owner.active=1 AND owner.visibility='public'
      WHERE list.id=? AND (${condition})`,
      bindings: [
        listId,
        ...(update === undefined
          ? []
          : [
              update.active === undefined ? null : Number(update.active),
              update.primaryDiscussion === undefined ? null : Number(update.primaryDiscussion),
              update.email ?? null,
            ]),
      ],
    },
  );
}
