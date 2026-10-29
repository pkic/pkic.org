import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { deleteJson } from "../../../../shared/api-client";
import { toast } from "../../ui";

/** One correction command for current and former representation rows. */
export async function removeIncorrectRepresentation(
  identityId: string,
  userId: string,
  onChanged: () => void | Promise<void>,
  onBusy: (busy: boolean) => void,
) {
  if (
    !(await confirmAction({
      title: "Delete identity?",
      body: "Delete this incorrect organization association from the profile and experience history. Access through it is removed too. If this was a real role, use End representation to keep its history. Linked participation records must be corrected before deletion.",
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
    toast(cause instanceof Error ? cause.message : "Could not remove the representation.", "error");
  } finally {
    onBusy(false);
  }
}
