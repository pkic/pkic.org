/**
 * What a reader may do to a user record, and the menu that offers it.
 *
 * A command here is something taken deliberately: editing the profile,
 * importing a portrait, copying the record's address, erasing or deleting the person.
 * None of them is a state the record arrives in (#47) and none of them is a
 * control standing open on the page (#46) — they are the entries behind the
 * record's own "…" menu, which is where the portal offers a record's actions
 * everywhere else.
 *
 * It lives beside the record rather than inside it so `UserDetail` stays the
 * record's composition: what the page is made of, not also every effect its
 * menu can start.
 */
import { useState } from "preact/hooks";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { deleteJson, getJson, postJson } from "../../../../shared/api-client";
import { userAnonymizeResponseSchema } from "../../../../../shared/schemas/user-management";
import {
  accountDeletionPreviewResponseSchema,
  accountDeletionResponseSchema,
} from "../../../../../shared/schemas/account-deletion";
import { accountDeletionBlockerLabel, accountDeletionRemovedLabel } from "../../../../../shared/account-deletion";
import { IMPORT_GRAVATAR_LABEL, importUserGravatar } from "../../../../shared/headshot/user-headshot";
import type { MenuItem } from "../../../../ui/Menu";
import { toast } from "../../ui";
import { copyText } from "../../../../shared/clipboard";
import type { UserDetail as UserRecord } from "./model";

export interface UserRecordCommandOptions {
  /** The loaded record; while it loads there is nothing to command. */
  user: UserRecord | null;
  /** Whether this reader may change the record at all. */
  editable: boolean;
  /** Whether the record's own subject is reading it and may change their own fields. */
  selfEditable: boolean;
  canWrite: boolean;
  canAnonymize: boolean;
  canDelete: boolean;
  /** Whether the fields are open right now, so the command that opens them is not offered twice. */
  editing: boolean;
  onEdit: () => void;
  /** Opens the person's professional profile, the page their public profile is rendered from. */
  onOpenProfile: () => void;
  /** Re-reads the record after a command changes it. */
  reload: () => Promise<void>;
  /** Leaves the record once it no longer exists. */
  onDeleted: () => void;
}

export function useUserRecordCommands(options: UserRecordCommandOptions): MenuItem[] {
  const {
    user: loaded,
    editable,
    selfEditable,
    canWrite,
    canAnonymize,
    canDelete,
    editing,
    onEdit,
    onOpenProfile,
    reload,
    onDeleted,
  } = options;
  const [anonymizing, setAnonymizing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [importingGravatar, setImportingGravatar] = useState(false);

  if (!loaded) return [];
  const user = loaded;

  async function copyRecordLink() {
    await copyText(window.location.href, {
      copied: "Record link copied",
      failed: "Your browser would not let the page copy the link",
      notify: toast,
    });
  }

  async function importGravatar() {
    setImportingGravatar(true);
    try {
      if (await importUserGravatar(user.id, toast)) await reload();
    } finally {
      setImportingGravatar(false);
    }
  }

  async function anonymize() {
    const confirmed = await confirmAction({
      title: `Anonymize ${user.email}?`,
      body: "This is permanent and cannot be undone.",
      consequences: [
        "Their name, email, biography, links, and headshot are permanently erased",
        "Their sign-in access is revoked immediately",
        "Their membership and event history records are kept, but no longer identify them",
      ],
      confirmLabel: "Anonymize user",
      typedConfirmation: user.email,
    });
    if (!confirmed) return;
    setAnonymizing(true);
    try {
      await postJson(`/api/v1/users/${encodeURIComponent(user.id)}/anonymize`, {}, userAnonymizeResponseSchema);
      toast("User anonymized", "success");
      await reload();
    } catch (cause) {
      toast((cause as Error).message, "error");
    } finally {
      setAnonymizing(false);
    }
  }

  /*
   * Deleting shows what goes with the account before anything happens, and
   * confirms that exact list: the server refuses a delete whose records
   * changed since. An account other records depend on is never deleted; the
   * reader learns why, and may anonymize it instead.
   */
  async function deleteAccount() {
    const path = `/api/v1/users/${encodeURIComponent(user.id)}`;
    setDeleting(true);
    try {
      const { deletion } = await getJson(`${path}/deletion`, accountDeletionPreviewResponseSchema);
      if (!deletion.deletable) {
        const anonymizeInstead = await confirmAction({
          title: `${user.email} can’t be deleted`,
          body: canAnonymize
            ? "Other records still depend on this account. Resolve them first, or anonymize the account instead."
            : "Other records still depend on this account. Resolve them first.",
          consequences: deletion.blockers.map(accountDeletionBlockerLabel),
          confirmLabel: canAnonymize ? "Anonymize instead…" : "Close",
          cancelLabel: canAnonymize ? "Close" : null,
          tone: canAnonymize ? "danger" : "primary",
        });
        if (anonymizeInstead && canAnonymize) await anonymize();
        return;
      }
      const confirmed = await confirmAction({
        title: `Delete ${user.email}?`,
        body: "This permanently deletes the account and everything listed. It cannot be undone.",
        consequences: deletion.removes.map(accountDeletionRemovedLabel),
        confirmLabel: "Delete account",
        typedConfirmation: user.email,
      });
      if (!confirmed) return;
      await deleteJson(`${path}?revision=${encodeURIComponent(deletion.revision)}`, accountDeletionResponseSchema);
      toast("Account deleted", "success");
      onDeleted();
    } catch (cause) {
      toast((cause as Error).message, "error");
    } finally {
      setDeleting(false);
    }
  }

  const commands: MenuItem[] = [];

  /*
   * Editing is one of the record's commands, so it is offered where the
   * record's other commands are — not as a band across the page whose whole
   * content is a button (#46).
   */
  if ((editable || selfEditable) && !editing) {
    commands.push({ id: "edit", label: "Edit profile", onSelect: onEdit });
  }

  commands.push({ id: "profile", label: "View public profile", onSelect: onOpenProfile });
  commands.push({ id: "copy", label: "Copy record link", onSelect: () => void copyRecordLink() });

  /*
   * Reaching an outside service on somebody's behalf: staff work, and a
   * command rather than a control standing open. It used to live in a "Photo"
   * panel alongside a second upload button; the portrait in the header is the
   * one place a photograph is set now (#28), so the import that is not an
   * upload is offered here with the record's other commands.
   */
  if (editable && canWrite) {
    commands.push({
      id: "gravatar",
      label: importingGravatar ? "Importing photo…" : IMPORT_GRAVATAR_LABEL,
      disabled: importingGravatar,
      onSelect: () => void importGravatar(),
    });
  }

  if (canAnonymize && !user.pii_redacted_at) {
    commands.push({
      id: "anonymize",
      label: anonymizing ? "Anonymizing…" : "Anonymize user…",
      danger: true,
      separatorBefore: true,
      disabled: anonymizing,
      onSelect: () => void anonymize(),
    });
  }

  if (canDelete && !user.pii_redacted_at) {
    commands.push({
      id: "delete",
      label: deleting ? "Checking account…" : "Delete account…",
      danger: true,
      separatorBefore: !(canAnonymize && !user.pii_redacted_at),
      disabled: deleting,
      onSelect: () => void deleteAccount(),
    });
  }

  return commands;
}
