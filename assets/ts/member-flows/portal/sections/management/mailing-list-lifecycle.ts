/**
 * What a manager may do to a mailing list, wherever the list is shown.
 *
 * The row's menu and the record's own header offer the same three commands,
 * so the confirmation wording, the endpoints, and the rule about which
 * command applies in which state live here once instead of drifting between
 * the two surfaces.
 */
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import {
  mailingListLifecycleTransitionSchema,
  mailingListResponseSchema,
  type MailingList,
  type MailingListLifecycleTransitionInput,
} from "../../../../../shared/schemas/mailing-lists";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { deleteJson, postValidated } from "../../../../shared/api-client";
import type { MenuItem } from "../../../../ui/Menu";

function listPath(groupId: string, listId: string): string {
  return `/api/v1/groups/${encodeURIComponent(groupId)}/mailing-lists/${encodeURIComponent(listId)}`;
}

export interface MailingListLifecycleHandlers {
  groupId: string;
  list: MailingList;
  /** Ran after a state change, so the surface showing the list can refresh it. */
  onChanged: () => void | Promise<void>;
  /** Ran after a deletion: the record is gone, so the caller usually leaves the page. */
  onDeleted: () => void | Promise<void>;
  onError: (error: Error) => void;
}

async function transition(
  handlers: MailingListLifecycleHandlers,
  transitionInput: MailingListLifecycleTransitionInput,
): Promise<void> {
  const { groupId, list } = handlers;
  const archiving = transitionInput.transition === "archive";
  const confirmed = await confirmAction(
    archiving
      ? {
          title: `Archive ${list.label}?`,
          body: "Archiving takes the list out of service without losing it.",
          consequences: [
            "Members stop sending to and receiving from this list",
            "Its configuration, its subscribers, and its history are kept",
            "It can be restored later, and everyone who was on it returns with it",
          ],
          confirmLabel: "Archive mailing list",
        }
      : {
          title: `Restore ${list.label}?`,
          body: "Restoring puts the list back into service.",
          consequences: [
            "Members can send to and receive from this list again",
            "Everyone eligible for it is subscribed again as its default and their own choice dictate",
          ],
          confirmLabel: "Restore mailing list",
          tone: "primary",
        },
  );
  if (!confirmed) return;
  try {
    await postValidated(
      `${listPath(groupId, list.id)}/transitions`,
      mailingListLifecycleTransitionSchema,
      transitionInput,
      mailingListResponseSchema,
    );
    await handlers.onChanged();
  } catch (cause) {
    handlers.onError(
      cause instanceof Error ? cause : new Error(`Could not ${archiving ? "archive" : "restore"} the mailing list`),
    );
  }
}

async function remove(handlers: MailingListLifecycleHandlers): Promise<void> {
  const { groupId, list } = handlers;
  const confirmed = await confirmAction({
    title: `Delete ${list.label}?`,
    body: "This is permanent and cannot be undone.",
    consequences: [
      "The list's configuration is erased",
      "Deleting is refused if anyone's subscription choice, a share with another group, or mail already delivered depends on it",
      "A list that has been used should be archived instead, which keeps all of that",
    ],
    confirmLabel: "Delete mailing list",
    // The address, not the label: deleting is irreversible, so the phrase to
    // type back is the one that identifies the list beyond doubt.
    typedConfirmation: list.email,
  });
  if (!confirmed) return;
  try {
    await deleteJson(listPath(groupId, list.id), successResponseSchema);
    await handlers.onDeleted();
  } catch (cause) {
    handlers.onError(cause instanceof Error ? cause : new Error("Could not delete the mailing list"));
  }
}

/**
 * Archive or restore — whichever the list's current state admits — and
 * delete. The command that does not apply is absent rather than shown
 * disabled: a list is either in service or out of it, so offering both at
 * once would state a choice that does not exist.
 */
export function mailingListLifecycleActions(handlers: MailingListLifecycleHandlers): MenuItem[] {
  const { list } = handlers;
  return [
    list.active
      ? { id: "archive", label: "Archive", onSelect: () => void transition(handlers, { transition: "archive" }) }
      : { id: "restore", label: "Restore", onSelect: () => void transition(handlers, { transition: "restore" }) },
    { id: "delete", label: "Delete", danger: true, separatorBefore: true, onSelect: () => void remove(handlers) },
  ];
}
