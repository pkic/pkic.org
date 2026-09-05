import { Dialog } from "pkic-org-events-backend";

/**
 * Ported from the repository's own overlay specimens
 * (assets/ts/ui/preview/sections-overlays.tsx), held open so each cell shows
 * the modal rather than the button that would summon it. The axis is how much
 * the dialog asks of the operator: a plain confirmation, consequences spelled
 * out, and the typed phrase that names *which* thing is being destroyed.
 */

const noop = () => {};

export function Confirmation() {
  return (
    <div class="pk">
      <Dialog
        open
        title="Publish the charter?"
        description="Members will see the Post-Quantum Cryptography charter immediately."
        confirmLabel="Publish"
        onConfirm={noop}
        onCancel={noop}
      />
    </div>
  );
}

export function DestructiveWithConsequences() {
  return (
    <div class="pk">
      <Dialog
        open
        destructive
        title="Remove Tomas Riedel from this group?"
        description="This ends the membership capacity immediately."
        consequences={[
          "Access to group meetings and files stops",
          "Open ballots lose this vote",
          "Child group memberships end with it",
        ]}
        confirmLabel="Remove member"
        cancelLabel="Keep membership"
        onConfirm={noop}
        onCancel={noop}
      />
    </div>
  );
}

export function TypedConfirmation() {
  return (
    <div class="pk">
      <Dialog
        open
        destructive
        title="Delete the Post-Quantum Cryptography group?"
        description="The group, its charter revisions, and its meeting minutes are removed."
        consequences={[
          "42 memberships end, including two chairs",
          "Eleven published documents stop resolving",
          "Two child groups are left without a parent",
        ]}
        confirmPhrase="Post-Quantum Cryptography"
        confirmPrompt="Type the group name to confirm"
        confirmLabel="Delete group"
        onConfirm={noop}
        onCancel={noop}
      />
    </div>
  );
}
