import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { deleteJson } from "../../../../shared/api-client";
import { toast } from "../../ui";

/** One correction command for current and former representation rows. */
export async function removeIncorrectRepresentation(
  identityId: string,
  onChanged: () => void | Promise<void>,
  onBusy: (busy: boolean) => void,
) {
  if (
    !(await confirmAction({
      title: "Remove incorrect representation?",
      body: "Remove this association from your profile, including your experience history. Access through it is removed too. Use End representation when you actually represented the organization.",
      confirmLabel: "Remove representation",
      tone: "danger",
    }))
  )
    return;
  onBusy(true);
  try {
    await deleteJson(`/api/v1/users/current/identities/${encodeURIComponent(identityId)}`, successResponseSchema);
    toast("Representation removed", "success");
    await onChanged();
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : "Could not remove the representation.", "error");
  } finally {
    onBusy(false);
  }
}
