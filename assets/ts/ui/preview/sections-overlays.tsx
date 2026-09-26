/**
 * Overlay specimens.
 *
 * A dialog cannot be shown statically — it is either open or it is not — so
 * these are driven by real state, which also makes the preview the place to
 * check focus return and the typed confirmation by hand.
 */

import { useState } from "preact/hooks";

import { Button } from "../Button";
import { Dialog } from "../Dialog";
import type { PreviewSection } from "./PreviewShell";

function DialogSpecimens() {
  const [plain, setPlain] = useState(false);
  const [destructive, setDestructive] = useState(false);

  return (
    <div class="pk-preview__shelf">
      <Button variant="secondary" onClick={() => setPlain(true)}>
        Open a confirmation
      </Button>
      <Button variant="danger-quiet" onClick={() => setDestructive(true)}>
        Open a destructive confirmation
      </Button>

      <Dialog
        open={plain}
        title="Publish the charter?"
        description="Members will see the new charter immediately."
        confirmLabel="Publish"
        onConfirm={() => setPlain(false)}
        onCancel={() => setPlain(false)}
      />

      <Dialog
        open={destructive}
        destructive
        title="Remove Tomas Riedel from this group?"
        description="This ends the membership capacity immediately."
        consequences={[
          "Access to group meetings and files stops",
          "Open ballots lose this vote",
          "Child group memberships end with it",
        ]}
        confirmPhrase="Post-Quantum Cryptography"
        confirmPrompt="Type the group name to confirm"
        confirmLabel="Remove member"
        onConfirm={() => setDestructive(false)}
        onCancel={() => setDestructive(false)}
      />
    </div>
  );
}

export const overlaySections: PreviewSection[] = [
  {
    id: "dialogs",
    title: "Dialogs",
    note: "Where the operator commits to something they cannot undo.",
    render: () => <DialogSpecimens />,
  },
];
