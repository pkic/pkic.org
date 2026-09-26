/**
 * Who sits on the Executive Council.
 *
 * The council is an ordinary governing-body group — its roster, its chair,
 * its mailing list all read `group_memberships` — and so does everything
 * that used to read a checkbox on the user record: the EC decision screen,
 * the reviewer picker, the eligibility guards. One roster, one answer (#104).
 */
export const EXECUTIVE_COUNCIL_GROUP_SLUG = "executive-council";

/**
 * A SQL predicate: the user named by `userIdExpression` holds a live seat on
 * the Executive Council. `userIdExpression` is trusted SQL — a column
 * reference or a bound parameter placeholder — never user input.
 */
export function executiveCouncilSeatSql(userIdExpression: string): string {
  return `EXISTS (
    SELECT 1
      FROM group_memberships ec_seat
      JOIN groups ec_group ON ec_group.id = ec_seat.group_id
     WHERE ec_group.slug = '${EXECUTIVE_COUNCIL_GROUP_SLUG}'
       AND ec_seat.user_id = ${userIdExpression}
       AND ec_seat.left_at IS NULL
  )`;
}
