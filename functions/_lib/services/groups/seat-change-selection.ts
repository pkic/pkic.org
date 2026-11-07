/** The same affected seats used by publication and correction audit preimages. */
export function groupSeatChangeDefinitions(selection: { sql: string; definitions?: string }) {
  return `${selection.definitions ? `${selection.definitions},` : ""} selected AS MATERIALIZED (${selection.sql}),
      descendants(id,user_id) AS (
        SELECT child.id,root.user_id FROM selected root JOIN groups child ON child.parent_group_id=root.group_id
          WHERE root.closes=1 AND NOT EXISTS (SELECT 1 FROM group_memberships alternative
            WHERE alternative.group_id=root.group_id AND alternative.user_id=root.user_id AND alternative.left_at IS NULL
              AND alternative.id NOT IN (SELECT id FROM selected WHERE closes=1))
        UNION SELECT child.id,parent.user_id FROM descendants parent JOIN groups child ON child.parent_group_id=parent.id),
      affected AS (
        SELECT id,group_id,user_id,member_id,left_at,closes,membership_changed FROM selected
        UNION SELECT seat.id,seat.group_id,seat.user_id,seat.member_id,seat.left_at,1,1
          FROM descendants JOIN group_memberships seat ON seat.group_id=descendants.id AND seat.user_id=descendants.user_id
          WHERE seat.left_at IS NULL)`;
}
