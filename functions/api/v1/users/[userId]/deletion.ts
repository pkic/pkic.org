import type { ValidatedData } from "chanfana";
import {
  accountDeletionPreviewResponseSchema,
  accountDeletionPreviewRouteSchema,
  accountDeletionResponseSchema,
  accountDeletionRouteSchema,
} from "../../../../../assets/shared/schemas/account-deletion";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../../_lib/request";
import { deleteAccount } from "../../../../_lib/services/account-deletion/delete";
import { readAccountDeletion } from "../../../../_lib/services/account-deletion/preview";
import type { AdminContext } from "../../../../_lib/db/context";
import { requireUserStaffPermission } from "../authorization";

async function handleAccountDeletionPreview(
  c: AdminContext,
  data: ValidatedData<typeof accountDeletionPreviewRouteSchema>,
): Promise<Response> {
  const { db } = await requireUserStaffPermission(c, "users:delete");
  const { preview } = await readAccountDeletion(db, data.params.userId);
  return json(accountDeletionPreviewResponseSchema.parse({ deletion: preview }));
}

async function handleAccountDeletion(
  c: AdminContext,
  data: ValidatedData<typeof accountDeletionRouteSchema>,
): Promise<Response> {
  const { db, staff } = await requireUserStaffPermission(c, "users:delete");
  const secret = requireInternalSecret(c.env);
  const result = await deleteAccount(db, staff, data.params.userId, data.query.revision, secret);
  return json(accountDeletionResponseSchema.parse({ success: true, userId: result.userId }));
}

export const AccountDeletionGet = openApiRoute(accountDeletionPreviewRouteSchema, handleAccountDeletionPreview);
export const AccountDeletionDelete = openApiRoute(accountDeletionRouteSchema, handleAccountDeletion);
