import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ApiClientError, deleteJson } from "../../../../shared/api-client";
import { toast } from "../../ui";

/** One correction command for current and former representation rows. */
export async function removeIncorrectRepresentation(
  identityId: string,
  userId: string,
  onChanged: () => void | Promise<void>,
  onBusy: (busy: boolean) => void,
  onCorrect?: () => void,
) {
  if (
    !(await confirmAction({
      title: "Delete identity?",
      body: "Delete this identity and its profile details. The user account remains. Access through this identity is removed. If records are linked, choose their correct representation next. Use End representation for a real organization role that has ended.",
      confirmLabel: "Delete identity",
      tone: "danger",
    }))
  )
    return;
  onBusy(true);
  try {
    await deleteJson(
      `/api/v1/users/${encodeURIComponent(userId)}/identities/${encodeURIComponent(identityId)}`,
      successResponseSchema,
    );
    toast("Identity deleted", "success");
    await onChanged();
  } catch (cause) {
    if (cause instanceof ApiClientError && cause.code === "IDENTITY_HAS_PARTICIPATION" && onCorrect) {
      onCorrect();
      return;
    }
    toast(cause instanceof Error ? cause.message : "Could not remove the representation.", "error");
  } finally {
    onBusy(false);
  }
}
