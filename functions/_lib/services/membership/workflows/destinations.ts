import type { MailingListsListQuery } from "../../../../../assets/shared/schemas/mailing-lists";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import { permissionsAuthorizationEvidence } from "../../../auth/permissions";
import { queryPage } from "../../../db/pagination";
import { first } from "../../../db/queries";
import { AppError } from "../../../errors";
import type { AuthAdmin, DatabaseLike } from "../../../types";
import { buildMailingListsPageQuery } from "../../mailing-list-management/read-model";
import { MAILING_LIST_COLUMNS, toMailingList, type MailingListRow } from "../../mailing-list-record";
export async function listMembershipNoticeDestinations(
  db: DatabaseLike,
  actor: AuthAdmin,
  query: MailingListsListQuery,
) {
  const result = await queryPage<MailingListRow>(
    db,
    buildMailingListsPageQuery(
      { ...query, active: true },
      {
        requiredAuthorization: permissionsAuthorizationEvidence(actor, [{ permission: "membership:read" }]),
      },
    ),
  );
  return {
    mailingLists: result.rows.map(toMailingList),
    page: buildPageInfo(query.limit, query.offset, result.total, result.rows.length),
  };
}
export async function getMembershipNoticeDestination(db: DatabaseLike, id: string) {
  const row = await first<MailingListRow>(db, `SELECT ${MAILING_LIST_COLUMNS} FROM mailing_lists WHERE id = ?`, [id]);
  if (!row) throw new AppError(404, "MEMBERSHIP_DESTINATION_NOT_FOUND", "The notification list was not found");
  return { mailingList: toMailingList(row) };
}
